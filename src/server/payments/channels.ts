import { all, jsonParseObject, now, one, run } from "@/server/db";
import { AppError } from "@/server/http/api";
import { checkChannel, validateChannel, validateData, type CheckResult } from "@/server/payments/driver";
import { decryptSecret, encryptSecret } from "@/server/utils/crypto";
import { key, paymentById } from "@/shared/payments";
import type { Payment } from "@/shared/types/api";
import type { AppEnv } from "@/server/types/env";

export type PaymentChannel = Payment & {
  data: Record<string, string>;
};

type PaymentRow = Omit<Payment, "assets"> & {
  assets: string;
  credentials: string;
};

const columns = "id, driver, name, status, address, assets, credentials, created_at AS createdAt, updated_at AS updatedAt";

async function payment(env: AppEnv, row: PaymentRow): Promise<PaymentChannel> {
  return {
    address: row.address,
    assets: (JSON.parse(row.assets) as string[]).map(key).filter(Boolean),
    createdAt: row.createdAt,
    data: jsonParseObject<Record<string, string>>(await decryptSecret(env, row.credentials), {}),
    driver: row.driver,
    id: row.id,
    name: row.name,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

export async function listPayments(env: AppEnv) {
  return Promise.all((await all<PaymentRow>(env, `SELECT ${columns} FROM payments ORDER BY id DESC`)).map((row) => payment(env, row)));
}

export function publicPayment(payment: PaymentChannel): Payment {
  const { data: _data, ...out } = payment;
  return out;
}

async function getPayment(env: AppEnv, id: number) {
  const row = await one<PaymentRow>(env, `SELECT ${columns} FROM payments WHERE id = ?`, id);
  if (!row) throw new AppError(404, "errors.payment_not_found");
  return payment(env, row);
}

export async function savePayment(env: AppEnv, input: { address: string; assets: string[]; data?: Record<string, string>; driver: string; id?: number; name: string; status?: Payment["status"] }) {
  const address = String(input.address ?? "").trim();
  const assets = Array.from(new Set((input.assets ?? []).map(key).filter(Boolean)));
  const payment = validateChannel({ address, assets, driver: input.driver });
  const existing = input.id ? await getPayment(env, input.id) : null;
  const nextData = Object.fromEntries(Object.entries(input.data ?? {}).filter(([, value]) => String(value).trim()));
  const data = existing ? { ...existing.data, ...nextData } : nextData;
  if (payment.data?.some((field) => !String(data[field.id] ?? "").trim())) {
    throw new AppError(400, "errors.payment_credential_missing");
  }
  await validateData(payment.id, address, data);
  const time = now();
  const name = input.name.trim() || payment.id;
  const status = input.status === "disabled" ? "disabled" : "enabled";
  const fields = [input.driver, name, status, address, JSON.stringify(assets), await encryptSecret(env, JSON.stringify(data))] as const;
  if (input.id) {
    await run(env, "UPDATE payments SET driver = ?, name = ?, status = ?, address = ?, assets = ?, credentials = ?, updated_at = ? WHERE id = ?", ...fields, time, input.id);
    return getPayment(env, input.id);
  }
  const result = await run(env, "INSERT INTO payments(driver, name, status, address, assets, credentials, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)", ...fields, time, time);
  const id = Number(result.meta.last_row_id);
  return getPayment(env, id);
}

export async function deletePayment(env: AppEnv, id: number) {
  await run(env, "DELETE FROM payments WHERE id = ?", id);
}

export function paymentHealth(payment: PaymentChannel) {
  const network = paymentById(payment.driver)?.network ?? payment.driver;
  const summary = { driver: payment.driver, id: payment.id, name: payment.name, network };
  if (payment.status === "error") return { ...summary, details: "", status: "warn" };
  if (!payment.address.trim()) {
    return { ...summary, details: "errors.payment_field_missing", status: "warn" };
  }
  return { ...summary, details: "common.normal", status: "ok" };
}

export async function checkChannels(env: AppEnv, status?: Payment["status"]) {
  const channels = (await listPayments(env)).filter((channel) => channel.status !== "disabled" && (!status || channel.status === status));
  const errors: Record<number, string> = {};
  for (const channel of channels) {
    const result = await checkChannel(channel);
    await recordCheck(env, channel.id, result);
    if (result.status === "error") errors[channel.id] = result.error ?? "Payment check failed";
  }
  return errors;
}

export async function recordCheck(env: AppEnv, id: number, result: CheckResult) {
  const time = now();
  await run(
    env,
    "UPDATE payments SET status = CASE WHEN status = 'disabled' THEN 'disabled' WHEN ? THEN 'error' ELSE 'enabled' END, updated_at = ? WHERE id = ?",
    result.status === "error" ? 1 : 0,
    time,
    id,
  );
}

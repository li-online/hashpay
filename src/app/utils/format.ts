import Decimal from "decimal.js";

const amountLocale = "en-US";

function normalizeNegativeZero(value: number) {
  return Object.is(value, -0) ? 0 : value;
}

export function ceilDisplayAmount(amount: number) {
  return normalizeNegativeZero(new Decimal(amount).toDecimalPlaces(2, Decimal.ROUND_CEIL).toNumber());
}

export function formatDisplayAmount(value: unknown, options: Intl.NumberFormatOptions = { maximumFractionDigits: 2 }) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  return ceilDisplayAmount(amount).toLocaleString(amountLocale, options);
}

export function formatExactDisplayAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  return ceilDisplayAmount(Math.max(0, amount)).toLocaleString(amountLocale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

export function formatIntegerDisplayAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  return normalizeNegativeZero(Math.max(0, Math.trunc(amount))).toLocaleString(amountLocale, {
    maximumFractionDigits: 0,
  });
}

export function formatTime(value: unknown) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return "--";
  const date = new Date(ts * 1000);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

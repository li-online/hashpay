import { appT } from "@/app/i18n";
import {
  assetName as sharedAssetName,
  defaultPayment,
  evmPayments,
  key,
  normalizeAssetCsv,
  paymentAssetIcon,
  paymentById,
  paymentByNetwork,
  paymentExplorerUrl,
  payments,
  type Payment,
  type PaymentKind,
} from "@/shared/payments";
import type { PaymentSnapshot } from "@/shared/types/domain";

export type Kind = PaymentKind;
export type PaymentField = {
  help?: string;
  key: "address";
  label: string;
  pattern?: RegExp;
  required: true;
  type: "text";
};

export interface DriverChoice extends Payment {
  networkAssets?: Record<string, string[]>;
  networks?: string[];
}

export interface CheckoutOption {
  amount: number;
  asset: string;
  label: string;
  network: string;
  value: string;
}

export const evmId = "evm";
export const evmIconNetwork = "erc20";
export const evmSchemaDriver = evmPayments[0]!.id;
export const defaultDriver = defaultPayment;
export const kinds: Array<{ label: string; value: Kind }> = [
  { label: "payment.kind.chain", value: "chain" },
  { label: "payment.kind.exchange", value: "exchange" },
  { label: "payment.kind.wallet", value: "wallet" },
];

export function networkKey(value: unknown) {
  const raw = String(value).trim();
  return key(raw.includes("/") ? raw.split("/").pop() : raw);
}

export function assetKey(value: unknown) {
  return key(value);
}

export const drivers = payments;

export function isEvm(driver: Payment | DriverChoice | string | undefined) {
  return typeof driver === "string" ? driver === evmId : driver?.id === evmId || driver?.evm === true;
}

export function isEvmDriver(drivers: Payment[], driverId: string) {
  return drivers.find((driver) => driver.id === driverId)?.evm === true;
}

export function choices(drivers: Payment[], kind: Kind, editingDriverId = ""): DriverChoice[] {
  if (editingDriverId) return drivers.filter((driver) => driver.kind === kind && driver.id === editingDriverId);
  if (kind !== "chain") return drivers.filter((driver) => driver.kind === kind);

  const evm = drivers.filter((driver) => driver.evm);
  const out: DriverChoice[] = [];
  let evmInserted = false;

  for (const driver of drivers.filter((item) => item.kind === "chain")) {
    if (driver.evm) {
      if (!evmInserted) {
        out.push(evmChoiceFrom(evm));
        evmInserted = true;
      }
    } else {
      out.push(driver);
    }
  }

  return out;
}

export function evmDriver(drivers: Payment[], network: string) {
  return drivers.find((driver) => driver.evm && driver.network === network)!;
}

export function kindOf(drivers: Payment[], driverId: string): Kind {
  const driver = drivers.find((item) => item.id === driverId)!;
  return driver.evm ? "chain" : driver.kind;
}

export function assets(raw: unknown) {
  return normalizeAssetCsv(raw);
}

export const assetName = sharedAssetName;

export function assetIcon(asset: unknown) {
  return paymentAssetIcon(asset);
}

export function networkName(network: unknown) {
  const definition = paymentById(network) ?? paymentByNetwork(network);
  return definition ? appT(definition.nameKey) : String(network || "");
}

export function networkIcon(network: unknown) {
  return (paymentById(network) ?? paymentByNetwork(network))?.icon || "";
}

export function checkoutOptions(options: Array<{
  amount: number;
  asset: unknown;
  network: unknown;
}>): CheckoutOption[] {
  const seen = new Set<string>();
  return options.flatMap((option) => {
    const asset = assetKey(option.asset);
    const itemNetwork = networkKey(option.network);
    const key = `${asset}:${itemNetwork}`;
    if (!asset || !itemNetwork || seen.has(key)) return [];
    seen.add(key);
    const next = {
      amount: option.amount,
      asset,
      network: itemNetwork,
      value: key,
    };
    return [{ ...next, label: `${networkName(itemNetwork)} / ${assetName(asset)}` }];
  });
}

export function reviewNetworkOptions() {
  return payments.filter((payment) => payment.kind === "chain").map((payment) => appT(payment.nameKey));
}

export function reviewAssetOptions() {
  return Array.from(new Set(payments.filter((payment) => payment.kind === "chain").flatMap((payment) => payment.assets))).map((asset) => assetName(asset));
}

export function driverNetwork(driver: DriverChoice | Payment) {
  return isEvm(driver) && "networks" in driver ? driver.networks![0] : driver.network;
}

export function driverNetworks(driver: DriverChoice | Payment) {
  return "networks" in driver && driver.networks?.length ? driver.networks : [driver.network];
}

export function assetsFor(driver: DriverChoice | Payment, network: string) {
  if ("networkAssets" in driver && driver.networkAssets?.[network]) return driver.networkAssets[network];
  return driver.assets;
}

export function addressError(driver: Payment, address: string) {
  if (!driver.address.pattern || !address || driver.address.pattern.test(address)) return "";
  return appT("payment.validation.address_invalid", { field: appT(driver.address.nameKey) });
}

export function txUrl(payment: { driver?: string; tx?: { txid?: string } }) {
  const txid = String(payment?.tx?.txid || "").trim();
  return paymentExplorerUrl(payment?.driver, txid);
}

export function paymentInstruction(payment: Partial<PaymentSnapshot>) {
  if ((paymentById(payment.driver) ?? paymentByNetwork(payment.driver))?.kind === "exchange") {
    return appT("checkout.pay_with_exchange", {
      asset: assetName(payment.currency),
      platform: networkName(payment.driver),
    });
  }
  if (payment.url) {
    return appT("checkout.pay_with_platform", {
      asset: assetName(payment.currency),
      platform: networkName(payment.driver),
    });
  }
  return appT("checkout.pay_with_network", {
    asset: assetName(payment.currency),
    network: networkName(payment.driver),
  });
}

export function choiceNetwork(driver: DriverChoice) {
  return isEvm(driver) ? evmIconNetwork : driver.network;
}

export function fieldFor(driver: Payment): PaymentField {
  return {
    help: driver.address.helpKey ? appT(driver.address.helpKey) : undefined,
    key: "address",
    label: appT(driver.address.nameKey),
    pattern: driver.address.pattern,
    required: true,
    type: "text",
  };
}

function evmChoiceFrom(evm: Payment[]): DriverChoice {
  return {
    address: evm[0]!.address,
    assets: Array.from(new Set(evm.flatMap((driver) => driver.assets))),
    evm: true,
    explorer: evm.find((driver) => driver.explorer)?.explorer,
    icon: evm.find((driver) => driver.network === evmIconNetwork)?.icon ?? evm[0]?.icon ?? "",
    id: evmId,
    kind: "chain",
    nameKey: "network.evm",
    network: evmIconNetwork,
    networkAssets: Object.fromEntries(evm.map((driver) => [driver.network, driver.assets])),
    networks: evm.map((driver) => driver.network),
  };
}

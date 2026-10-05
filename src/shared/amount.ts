import Decimal from "decimal.js";

export function ceilAmount(amount: number | Decimal) {
  return new Decimal(amount).toDecimalPlaces(2, Decimal.ROUND_CEIL).toNumber();
}

export function sameAmount(a: number, b: number) {
  return new Decimal(a).minus(b).abs().lte(0.000001);
}

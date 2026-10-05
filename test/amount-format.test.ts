import { describe, expect, it } from "vitest";
import {
  ceilDisplayAmount,
  formatDisplayAmount,
  formatExactDisplayAmount,
  formatIntegerDisplayAmount,
} from "@/app/utils/format";

describe("amount formatting", () => {
  it("never exposes JavaScript negative zero", () => {
    expect(Object.is(ceilDisplayAmount(0), -0)).toBe(false);
    expect(Object.is(ceilDisplayAmount(-0), -0)).toBe(false);
    expect(formatDisplayAmount(-0.001)).toBe("0");
    expect(formatExactDisplayAmount(-0.001)).toBe("0.00");
    expect(formatIntegerDisplayAmount(-0.2)).toBe("0");
  });

  it("keeps normal amount formatting unchanged", () => {
    expect(formatDisplayAmount(4.9)).toBe("4.9");
    expect(formatExactDisplayAmount(4.9)).toBe("4.90");
    expect(formatDisplayAmount(20)).toBe("20");
    expect(formatDisplayAmount(20.123)).toBe("20.13");
    expect(formatExactDisplayAmount(20)).toBe("20.00");
    expect(formatIntegerDisplayAmount(20.8)).toBe("20");
  });
});

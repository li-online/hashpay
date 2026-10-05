import { describe, expect, it } from "vitest";
import { normalizeLocale, t } from "@/shared/i18n";

describe("shared i18n", () => {
  it("normalizes supported locales", () => {
    expect(normalizeLocale("en")).toBe("en-US");
    expect(normalizeLocale("en-GB")).toBe("en-US");
    expect(normalizeLocale("zh-Hant")).toBe("zh-CN");
    expect(normalizeLocale("")).toBe("zh-CN");
  });

  it("translates flat keys with interpolation", () => {
    expect(t("zh-CN", "orders.total", { count: 3 })).toBe("共 3 个订单");
    expect(t("en-US", "orders.total", { count: 3 })).toBe("3 orders total");
  });

  it("falls back to the key when missing", () => {
    expect(t("en-US", "missing.key")).toBe("missing.key");
  });
});

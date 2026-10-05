import { afterEach, describe, expect, it, vi } from "vitest";
import * as payment from "@/app/payments";
import { browserMatches, canProbeInBrowser } from "@/app/payments/browser";
import { setLocale } from "@/app/i18n";
import { trc20Assets } from "@/shared/payments";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("frontend payment module", () => {
  it("keeps asset display helpers frontend-only", () => {
    expect(payment.assetName("gram")).toBe("GRAM (ex TON)");
    expect(payment.assetIcon("gram")).toBe("icon-ton");
  });

  it("normalizes checkout options and removes duplicate asset-network pairs", () => {
    expect(payment.checkoutOptions([
      { amount: 10, asset: "USDT", network: "TRC20" },
      { amount: 11, asset: "usdt", network: "trc20" },
      { amount: 12, asset: "GRAM", network: "TON" },
    ])).toEqual([
      {
        amount: 10,
        asset: "usdt",
        label: "TRC20 (TRON) / USDT",
        network: "trc20",
        value: "usdt:trc20",
      },
      {
        amount: 12,
        asset: "gram",
        label: "TON / GRAM (ex TON)",
        network: "ton",
        value: "gram:ton",
      },
    ]);
  });

  it("exposes per-network frontend abilities", () => {
    expect(payment.txUrl({ driver: "trc20", tx: { txid: "abc" } })).toBe("https://tronscan.org/#/transaction/abc");
    expect(payment.txUrl({ driver: "ton", tx: { txid: "abc" } })).toBe("https://tonviewer.com/transaction/abc");
    expect(payment.txUrl({ driver: "aptos", tx: { txid: "123" } })).toBe("https://explorer.aptoslabs.com/txn/123?network=mainnet");
    expect(payment.txUrl({ driver: "solana", tx: { txid: "sig" } })).toBe("https://solscan.io/tx/sig");
    expect(payment.txUrl({ driver: "base", tx: { txid: "0xabc" } })).toBe("https://basescan.org/tx/0xabc");
  });

  it("uses exchange transfer wording for exchange drivers", () => {
    setLocale("zh-CN");
    expect(payment.networkName("binance")).toBe("Binance 币安 内部");
    expect(payment.networkName("okx")).toBe("OKX 欧易 内部");
    expect(payment.networkName("trc20")).toBe("TRC20 (TRON)");
    expect(payment.paymentInstruction({ currency: "usdt", driver: "binance" })).toBe("请通过 Binance 币安 内部转账 USDT");
  });

  it("probes browser-supported TRC20 payments before server checks", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        trc20Tx({ hash: "too-small", value: "9900000" }),
        trc20Tx({ hash: "paid", value: "10000000" }),
      ],
    })));
    vi.stubGlobal("fetch", fetchMock);

    const matches = await browserMatches(
      { address: tronAddress, amount: 10, currency: "usdt", driver: "trc20" },
      { createdAt: 100, expireAt: 200 },
      false,
    );

    expect(canProbeInBrowser({ address: tronAddress, driver: "trc20" })).toBe(true);
    expect(matches.map((item) => item.hash)).toEqual(["paid"]);
    expect(String((fetchMock.mock.calls[0] as unknown[] | undefined)?.[0])).toContain("https://api.trongrid.io/v1/accounts/");
  });

  it("does not probe unsupported browser payment drivers", async () => {
    expect(canProbeInBrowser({ address: "2itEPQiRbuLQZzdubQFgx2P9M9mpREoNdPKng3M7sf5o", driver: "solana" })).toBe(false);
    await expect(browserMatches(
      { address: "2itEPQiRbuLQZzdubQFgx2P9M9mpREoNdPKng3M7sf5o", amount: 1, currency: "usdt", driver: "solana" },
      { createdAt: 100, expireAt: 200 },
      false,
    )).resolves.toEqual([]);
  });
});

const tronAddress = "TY1ykSFu8N4mZgxsJABLGdhcs91h1N2qR2";

function trc20Tx(input: { hash: string; value: string }) {
  return {
    block_timestamp: 120_000,
    to: tronAddress,
    token_info: { address: trc20Assets.usdt.contract, decimals: 6, symbol: "USDT" },
    transaction_id: input.hash,
    value: input.value,
  };
}

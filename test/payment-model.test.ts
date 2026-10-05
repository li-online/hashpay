import { describe, expect, it } from "vitest";
import { assignPayment, paymentExplorerUrl, paymentOptions, payments, validateChannel } from "@/server/payments/driver";
import {
  assetName,
  networkLabel,
  key,
  paymentAssetTelegramEmojiId,
  paymentById,
  paymentNetworkTelegramEmojiId,
  solanaAssets,
} from "@/shared/payments";

describe("payment model", () => {
  it("keeps TON as network and gram as the payment asset", () => {
    expect(networkLabel("ton")).toBe("network.ton");
    expect(assetName("gram")).toBe("GRAM (ex TON)");
    expect(key("GRAM")).toBe("gram");
    expect(key("TON")).toBe("ton");
    expect(key("TRC20")).toBe("trc20");
    expect(key("BEP20")).toBe("bep20");
    expect(key("tron")).toBe("tron");
    expect(key("bnb")).toBe("bnb");
  });

  it("lists gram on the TON network without treating TON as an asset alias", () => {
    const options = paymentOptions({
      address: "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      assets: ["usdt", "gram", "ton"],
      createdAt: 1,
      data: {},
      driver: "ton",
      id: 7,
      name: "TON",
      status: "enabled",
      updatedAt: 1,
    });

    expect(options).toContainEqual({ asset: "gram", channelId: 7, network: "ton" });
    expect(options).toContainEqual({ asset: "usdt", channelId: 7, network: "ton" });
    expect(options).not.toContainEqual({ asset: "ton", channelId: 7, network: "ton" });
    expect(() => validateChannel({
      address: "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      assets: ["ton"],
      driver: "ton",
    })).toThrow("errors.payment_asset_invalid");
  });

  it("keeps EVM networks as real payment drivers with their own assets", () => {
    const options = paymentOptions({
      address: "0x0000000000000000000000000000000000000001",
      assets: ["usdt", "bnb", "eth"],
      createdAt: 1,
      data: {},
      driver: "bep20",
      id: 9,
      name: "BEP20",
      status: "enabled",
      updatedAt: 1,
    });

    expect(options).toContainEqual({ asset: "usdt", channelId: 9, network: "bep20" });
    expect(options).toContainEqual({ asset: "bnb", channelId: 9, network: "bep20" });
    expect(options).not.toContainEqual({ asset: "eth", channelId: 9, network: "bep20" });
    expect(() => validateChannel({
      address: "0x0000000000000000000000000000000000000001",
      assets: ["eth"],
      driver: "bep20",
    })).toThrow("errors.payment_asset_invalid");
  });

  it("uses server payment definitions as the payment source", () => {
    expect(payments.map((item) => item.id)).toContain("trc20");
    expect(paymentById("trc20")).toMatchObject({
      address: { nameKey: "payment.address.tron" },
      icon: "icon-tron",
    });
    expect(paymentExplorerUrl("trc20", "abc")).toBe("https://tronscan.org/#/transaction/abc");
  });

  it("keeps Telegram custom emoji IDs in payment definitions", () => {
    expect(paymentAssetTelegramEmojiId("USDT")).toBe("6222280715564752360");
    expect(paymentAssetTelegramEmojiId("USDC")).toBe("6222075845624734726");
    expect(paymentAssetTelegramEmojiId("ETH")).toBe("6221781623185088657");
    expect(paymentAssetTelegramEmojiId("bnb")).toBe("");
    expect(paymentNetworkTelegramEmojiId("trc20")).toBe("6221973857331323093");
    expect(paymentNetworkTelegramEmojiId("binance")).toBe("6222038930380823799");
    expect(paymentNetworkTelegramEmojiId("okx")).toBe("6224164522580516460");
    expect(paymentNetworkTelegramEmojiId("TON")).toBe("6222235515328928786");
    expect(paymentNetworkTelegramEmojiId("solana")).toBe("6221755831906475362");
    expect(paymentNetworkTelegramEmojiId("bep20")).toBe("6221954916525558708");
    expect(paymentNetworkTelegramEmojiId("base")).toBe("6221781623185088657");
    expect(paymentNetworkTelegramEmojiId("unknown")).toBe("6221781623185088657");
  });

  it("uses Binance ID as the address and keeps API details in data", () => {
    expect(paymentById("binance")).toMatchObject({
      address: { nameKey: "payment.binance.id" },
      assets: ["usdt", "usdc"],
      data: [
        { id: "apiKey", nameKey: "payment.binance.api_key" },
        { id: "secretKey", nameKey: "payment.binance.secret_key" },
      ],
    });
    expect(() => validateChannel({ address: "34355667", assets: ["usdt"], driver: "binance" })).not.toThrow();
    expect(() => validateChannel({ address: "abc", assets: ["usdt"], driver: "binance" })).toThrow("errors.payment_address_invalid");
    expect(assignPayment({
      address: "34355667",
      assets: ["usdt"],
      createdAt: 1,
      data: { apiKey: "api-key", secretKey: "secret-key" },
      driver: "binance",
      id: 12,
      name: "Binance",
      status: "enabled",
      updatedAt: 1,
    }, 12.5, "usdt")).toMatchObject({
      address: "34355667",
      amount: 12.5,
      currency: "usdt",
      driver: "binance",
    });
  });

  it("uses OKX UID as the address and keeps API details in data", () => {
    expect(paymentById("okx")).toMatchObject({
      address: { nameKey: "payment.okx.uid" },
      assets: ["usdt", "usdc"],
      data: [
        { id: "apiKey", nameKey: "payment.okx.api_key" },
        { id: "secretKey", nameKey: "payment.okx.secret_key" },
        { id: "passphrase", nameKey: "payment.okx.passphrase" },
      ],
    });
    expect(() => validateChannel({ address: "888777", assets: ["usdt"], driver: "okx" })).not.toThrow();
    expect(() => validateChannel({ address: "abc", assets: ["usdt"], driver: "okx" })).toThrow("errors.payment_address_invalid");
    expect(assignPayment({
      address: "888777",
      assets: ["usdt"],
      createdAt: 1,
      data: { apiKey: "api-key", passphrase: "passphrase", secretKey: "secret-key" },
      driver: "okx",
      id: 13,
      name: "OKX",
      status: "enabled",
      updatedAt: 1,
    }, 12.5, "usdt")).toMatchObject({
      address: "888777",
      amount: 12.5,
      currency: "usdt",
      driver: "okx",
    });
  });

  it("supports Aptos as a chain payment driver", () => {
    const address = "0x1111111111111111111111111111111111111111111111111111111111111111";
    expect(paymentById("aptos")).toMatchObject({
      address: { nameKey: "payment.address.aptos" },
      assets: ["usdt", "usdc"],
      icon: "icon-aptos",
    });
    expect(paymentOptions({
      address,
      assets: ["usdt", "usdc"],
      createdAt: 1,
      data: {},
      driver: "aptos",
      id: 10,
      name: "Aptos",
      status: "enabled",
      updatedAt: 1,
    })).toEqual([
      { asset: "usdt", channelId: 10, network: "aptos" },
      { asset: "usdc", channelId: 10, network: "aptos" },
    ]);
    expect(() => validateChannel({ address: "0x1", assets: ["usdt"], driver: "aptos" })).toThrow("errors.payment_address_invalid");
    expect(() => validateChannel({ address, assets: ["apt"], driver: "aptos" })).toThrow("errors.payment_asset_invalid");
  });

  it("supports Solana USDT and USDC payments", () => {
    const address = "9xQeWvG816bUx9EPfM4DRhWSYFxmM2GiwjL6jS6qQW2";
    expect(paymentById("solana")).toMatchObject({
      address: { nameKey: "payment.address.solana" },
      assets: ["usdt", "usdc"],
      icon: "icon-solana",
    });
    expect(paymentOptions({
      address,
      assets: ["usdt", "usdc", "sol"],
      createdAt: 1,
      data: {},
      driver: "solana",
      id: 12,
      name: "Solana",
      status: "enabled",
      updatedAt: 1,
    })).toEqual([
      { asset: "usdt", channelId: 12, network: "solana" },
      { asset: "usdc", channelId: 12, network: "solana" },
    ]);
    expect(() => validateChannel({ address: "0x1", assets: ["usdt"], driver: "solana" })).toThrow("errors.payment_address_invalid");
    expect(() => validateChannel({ address, assets: ["sol"], driver: "solana" })).toThrow("errors.payment_asset_invalid");
    expect(paymentExplorerUrl("solana", "sig")).toBe("https://solscan.io/tx/sig");
    expect(solanaAssets.usdc.contract).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(solanaAssets.usdt.contract).toBe("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
  });

  it("supports Base as an EVM payment driver", () => {
    const address = "0x0000000000000000000000000000000000000001";
    expect(paymentById("base")).toMatchObject({
      address: { nameKey: "payment.address.evm" },
      assets: ["usdt", "usdc", "eth"],
      icon: "icon-base",
    });
    expect(paymentOptions({
      address,
      assets: ["usdt", "usdc", "eth", "bnb"],
      createdAt: 1,
      data: {},
      driver: "base",
      id: 11,
      name: "Base",
      status: "enabled",
      updatedAt: 1,
    })).toEqual([
      { asset: "usdt", channelId: 11, network: "base" },
      { asset: "usdc", channelId: 11, network: "base" },
      { asset: "eth", channelId: 11, network: "base" },
    ]);
    expect(paymentExplorerUrl("base", "0xabc")).toBe("https://basescan.org/tx/0xabc");
  });
});

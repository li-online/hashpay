import { describe, expect, it } from "vitest";
import { generateRsaKeyPair, verifyRsaSha256 } from "@/server/utils/crypto";

function base64Lines(bytes: ArrayBuffer) {
  return Buffer.from(bytes).toString("base64").replace(/(.{64})/g, "$1\n").trim();
}

async function createKeyPair() {
  const pair = await crypto.subtle.generateKey(
    { hash: "SHA-256", modulusLength: 2048, name: "RSASSA-PKCS1-v1_5", publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("spki", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicKeyPem: `-----BEGIN PUBLIC KEY-----\n${base64Lines(publicKey)}\n-----END PUBLIC KEY-----`,
  };
}

function base64(bytes: ArrayBuffer) {
  return Buffer.from(bytes).toString("base64");
}

async function importPrivateKey(privateKeyPem: string) {
  const body = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  return crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(body, "base64"),
    { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
    false,
    ["sign"],
  );
}

describe("merchant RSA signature", () => {
  it("verifies request signing payload", async () => {
    const { privateKey, publicKeyPem } = await createKeyPair();
    const payload = ["POST", "/api/merchant/new", "1782000000", "{\"amount\":10}"].join("\n");
    const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, new TextEncoder().encode(payload));

    await expect(verifyRsaSha256(publicKeyPem, base64(signature), payload)).resolves.toBe(true);
    await expect(verifyRsaSha256(publicKeyPem, base64(signature), `${payload}x`)).resolves.toBe(false);
  });

  it("generates a usable merchant key pair", async () => {
    const pair = await generateRsaKeyPair();
    const privateKey = await importPrivateKey(pair.privateKeyPem);
    const payload = ["GET", "/api/order/demo", "1782000000", ""].join("\n");
    const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, new TextEncoder().encode(payload));

    expect(pair.privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
    expect(pair.publicKeyPem).toContain("-----BEGIN PUBLIC KEY-----");
    await expect(verifyRsaSha256(pair.publicKeyPem, base64(signature), payload)).resolves.toBe(true);
  });
});

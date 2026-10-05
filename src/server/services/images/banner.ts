import { getConfigBlob, setConfig } from "@/server/db";
import defaultBannerBase64 from "@/server/assets/default-banner.webp?base64";
import type { AppEnv } from "@/server/types/env";

export async function ensureDefaultBanner(env: AppEnv) {
  const existing = await getConfigBlob(env, "banner");
  if (existing && existing.byteLength > 0) return new Uint8Array(existing);
  const banner = defaultBannerBytes();
  await setConfig(env, "banner", "webp", banner);
  return new Uint8Array(banner);
}

export async function uploadBanner(env: AppEnv, banner: ArrayBuffer) {
  await setConfig(env, "banner", "webp", banner);
  return { url: "/banner.webp" };
}

export async function restoreDefaultBanner(env: AppEnv) {
  const banner = defaultBannerBytes();
  await setConfig(env, "banner", "webp", banner);
  return new Uint8Array(banner);
}

function defaultBannerBytes() {
  const binary = atob(defaultBannerBase64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return bytes.buffer;
}

import { AppError } from "@/server/http/api";

export function normalizeCallbackUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !host || isLocalHost(host) || isPrivateHost(host)) {
      throw new Error("invalid callback url");
    }
    url.hash = "";
    return url.toString();
  } catch {
    throw new AppError(400, "errors.callback_url_invalid");
  }
}

function isLocalHost(host: string) {
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local");
}

function isPrivateHost(host: string) {
  if (host.startsWith("[") || host.includes(":")) return true;
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || a >= 224;
}

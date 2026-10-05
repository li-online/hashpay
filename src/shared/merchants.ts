import type { Merchant } from "@/shared/types/api";

export type AuthMode = "md5" | "rsa";

export function authMode(type: Merchant["type"]): AuthMode {
  return type === "ezfp" ? "md5" : "rsa";
}

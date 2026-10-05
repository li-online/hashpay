import { appT } from "@/app/i18n";

export interface CopyMessage {
  success(text: string): unknown;
  warning(text: string): unknown;
}

export async function copyText(value: unknown, options: { message?: CopyMessage } = {}) {
  const text = String(value ?? "");
  if (!text || typeof window === "undefined" || typeof navigator === "undefined" || !window.isSecureContext || !navigator.clipboard?.writeText) {
    options.message?.warning(appT("common.copy_failed_manual"));
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    options.message?.success(appT("common.copied"));
    return true;
  } catch {
    options.message?.warning(appT("common.copy_failed_manual"));
    return false;
  }
}

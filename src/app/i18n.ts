import { computed, ref } from "vue";
import { normalizeLocale, t as translate, type I18nParams, type Locale, type MessageKey } from "@/shared/i18n";

const storageKey = "hashpay.locale";
const locale = ref<Locale>(initialLocale());

export const localeOptions = computed(() => [
  { label: translate(locale.value, "locale.zh"), value: "zh-CN" },
  { label: translate(locale.value, "locale.en"), value: "en-US" },
]);

export function useI18n() {
  return {
    locale,
    localeOptions,
    setLocale,
    t: appT,
  };
}

export function appT(key: MessageKey | string, params?: I18nParams) {
  return translate(locale.value, key, params);
}

export function setLocale(value: Locale | string) {
  locale.value = normalizeLocale(value);
  if (typeof localStorage !== "undefined") localStorage.setItem(storageKey, locale.value);
}

function initialLocale() {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(storageKey);
    if (saved) return normalizeLocale(saved);
  }
  const tgLocale = typeof window !== "undefined"
    ? (window.Telegram?.WebApp as { initDataUnsafe?: { user?: { language_code?: string } } } | undefined)?.initDataUnsafe?.user?.language_code
    : "";
  if (tgLocale) return normalizeLocale(tgLocale);
  return normalizeLocale(typeof navigator !== "undefined" ? navigator.language : "");
}

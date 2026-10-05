import type { Router } from "vue-router";

const telegram = window.Telegram?.WebApp;

export function initTelegram(router: Router) {
  if (!telegram?.initData) return;
  telegram.ready();
  telegram.expand();

  let target = "";
  telegram.BackButton.onClick(() => void router.push(target));

  router.afterEach((route) => {
    target = typeof route.meta.back === "string" ? route.meta.back : "";
    target ? telegram.BackButton.show() : telegram.BackButton.hide();
  });
}

export function ask(message: string) {
  if (!telegram?.initData) return Promise.resolve(window.confirm(message));
  return new Promise<boolean>((resolve) => telegram.showConfirm(message, (confirmed) => {
    if (confirmed) telegram.HapticFeedback.impactOccurred("light");
    resolve(confirmed);
  }));
}

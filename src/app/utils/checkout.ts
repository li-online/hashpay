import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { MessageApi } from "naive-ui";
import * as pay from "@/app/payments";
import { browserMatches, canProbeInBrowser } from "@/app/payments/browser";
import { api, type Checkout } from "@/app/api";
import { appT } from "@/app/i18n";

const paymentProbeIntervalMs = 3000;
const statusPollIntervalMs = 5000;

export function useCheckout(orderId: string, message: MessageApi) {
  const checkout = ref<Checkout | null>(null);
  const changingPayment = ref(false);
  const paidReturnDueAt = ref(0);
  const nowMs = ref(Date.now());
  let pollingStatus = false;
  let probingPayment = false;
  let clock: ReturnType<typeof setInterval> | undefined;
  let statusPoll: ReturnType<typeof setInterval> | undefined;
  let paymentProbePoll: ReturnType<typeof setInterval> | undefined;
  const checkedTx = new Set<string>();

  const paymentOptions = computed(() => pay.checkoutOptions(checkout.value?.options ?? []));
  const paidReturnSeconds = computed(() => {
    if (!paidReturnDueAt.value) return 5;
    return Math.max(0, Math.ceil((paidReturnDueAt.value - nowMs.value) / 1000));
  });

  async function load() {
    checkout.value = await api.checkout.order(orderId);
  }

  async function pollStatus() {
    const order = checkout.value?.order;
    if (!order || pollingStatus || ["paid", "invalid", "expired"].includes(String(order.status || ""))) return;
    pollingStatus = true;
    try {
      const latest = await api.silent.checkout.status(orderId);
      const previousStatus = order.status;
      checkout.value = {
        ...checkout.value!,
        order: {
          ...order,
          ...latest,
        },
      };
      if (previousStatus !== "paid" && latest.status === "paid") {
        message.success(appT("checkout.paid"));
      }
    } catch {
      // Polling should not interrupt the checkout flow.
    } finally {
      pollingStatus = false;
    }
  }

  async function probePayment() {
    const current = checkout.value;
    const order = current?.order;
    const payment = order?.payment ?? {};
    if (!order || order.status !== "pending" || isExpired(order, nowMs.value) || !canProbeInBrowser(payment) || probingPayment) return;
    probingPayment = true;
    try {
      const matches = (await browserMatches(payment, order, current.fastConfirm)).filter((item) => !checkedTx.has(item.hash));
      if (!matches.length) return;
      try {
        await api.silent.checkout.check(orderId);
        await pollStatus();
      } finally {
        for (const match of matches) checkedTx.add(match.hash);
      }
    } catch {
      // Browser-side probing depends on public API CORS and visitor network state.
    } finally {
      probingPayment = false;
    }
  }

  async function selectPayment(option: pay.CheckoutOption) {
    const current = checkout.value;
    const order = current?.order;
    if (!order || order.status !== "pending" || isExpired(order, nowMs.value)) return;
    const snapshot = await api.checkout.select(orderId, { asset: option.asset, network: option.network });
    checkout.value = {
      ...checkout.value!,
      order: {
        ...order,
        payment: snapshot,
      },
    };
    changingPayment.value = false;
    checkedTx.clear();
    message.success(appT("checkout.selected"));
    void probePayment();
  }

  function changePayment() {
    const order = checkout.value?.order;
    if (!order || isExpired(order, nowMs.value)) return;
    changingPayment.value = true;
  }

  function returnToMerchant() {
    const url = checkout.value?.order.returnUrl?.trim();
    if (!url) return;
    window.location.href = url;
  }

  onMounted(() => {
    void load().then(() => probePayment());
    clock = setInterval(() => {
      nowMs.value = Date.now();
    }, 1000);
    statusPoll = setInterval(() => {
      void pollStatus();
    }, statusPollIntervalMs);
    paymentProbePoll = setInterval(() => {
      void probePayment();
    }, paymentProbeIntervalMs);
  });

  watch(() => [checkout.value?.order?.status, checkout.value?.order?.returnUrl] as const, () => {
    const order = checkout.value?.order;
    paidReturnDueAt.value = order?.status === "paid" && order.returnUrl?.trim() ? Date.now() + 5000 : 0;
  }, { immediate: true });

  watch(nowMs, () => {
    const order = checkout.value?.order;
    if (order?.status !== "paid" || !order.returnUrl?.trim() || !paidReturnDueAt.value) return;
    if (nowMs.value < paidReturnDueAt.value) return;
    paidReturnDueAt.value = 0;
    returnToMerchant();
  });

  onBeforeUnmount(() => {
    if (clock) clearInterval(clock);
    if (statusPoll) clearInterval(statusPoll);
    if (paymentProbePoll) clearInterval(paymentProbePoll);
  });

  return {
    changePayment,
    changingPayment,
    checkout,
    load,
    nowMs,
    paidReturnSeconds,
    paymentOptions,
    returnToMerchant,
    selectPayment,
  };
}

function isExpired(order: { expireAt: number; status: string }, now = Date.now()) {
  return order.status === "expired" || Number(order.expireAt) * 1000 <= now;
}

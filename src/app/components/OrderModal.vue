<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMessage } from "naive-ui";
import { txUrl } from "@/app/payments";
import { api } from "@/app/api";
import { useI18n } from "@/app/i18n";
import { formatDisplayAmount as formatAmount, formatTime } from "@/app/utils/format";
import { copyText } from "@/app/utils/clipboard";
import { ask } from "@/app/utils/telegram";
import { assetName } from "@/shared/payments";
import type { OrderDetail, Order } from "@/shared/types/api";
import type { PaymentSnapshot } from "@/shared/types/domain";

const props = defineProps<{
  orderId?: string | null;
  show: boolean;
}>();

const emit = defineEmits<{
  changed: [];
  deleted: [id: string];
  "update:show": [show: boolean];
}>();

const message = useMessage();
const { t } = useI18n();
const detail = ref<OrderDetail | null>(null);
const action = ref("");
const loading = ref(false);

const visible = computed({
  get: () => props.show,
  set: (show) => emit("update:show", show),
});

const reviewImage = computed(() => detail.value?.review?.image || detail.value?.review?.imageUrl || "");

watch(
  () => [props.show, props.orderId] as const,
  ([show, id]) => {
    if (show && id) void load(id);
    if (!show) detail.value = null;
  },
  { immediate: true },
);

async function load(id = props.orderId) {
  if (!id) return;
  loading.value = true;
  try {
    detail.value = await api.orders.get(id);
  } finally {
    loading.value = false;
  }
}

async function run(name: string, fn: (id: string) => Promise<void>) {
  const id = detail.value?.order.id;
  if (!id) return;
  action.value = name;
  try {
    await fn(id);
  } catch {
    // API layer displays the error.
  } finally {
    action.value = "";
  }
}

async function checkPayment() {
  await run("check", async (id) => {
    await api.orders.check(id);
    message.success(t("order.check_done"));
    await load(id);
    emit("changed");
  });
}

async function confirmPayment() {
  if (!await ask(t("order.confirm_warning"))) return;
  await run("confirm", async (id) => {
    await api.orders.confirm(id);
    message.success(t("order.confirm_done"));
    await load(id);
    emit("changed");
  });
}

async function resendNotify() {
  await run("notify", async (id) => {
    await api.orders.resend(id);
    message.success(t("order.notify_resent"));
    await load(id);
  });
}

async function deleteOrder() {
  if (!await ask(t("order.delete_warning"))) return;
  await run("delete", async (id) => {
    await api.orders.remove(id);
    message.success(t("order.deleted"));
    emit("deleted", id);
    visible.value = false;
  });
}

function statusClass(status: Order["status"]) {
  return {
    expired: "is-muted",
    invalid: "is-error",
    paid: "is-success",
    pending: "is-warning",
  }[status];
}

function payAmount(payment: Partial<PaymentSnapshot>) {
  return payment.amount ? `${formatAmount(payment.amount)} ${assetName(payment.currency)}` : "--";
}

function rateText(value: OrderDetail) {
  const paid = Number(value.order.payment.amount);
  if (!paid) return t("order.not_selected");
  const rate = value.order.amount / paid;
  return `1 ${assetName(value.order.payment.currency)} = ${formatAmount(rate)} ${assetName(value.order.currency)}`;
}

</script>

<template>
  <n-modal v-model:show="visible">
    <n-card
      closable
      class="order-modal"
      role="dialog"
      aria-modal="true"
      @close="visible = false"
    >
      <template #header>
        <div class="order-modal-title">
          <span>{{ t('order.detail') }}</span>
          <n-tag v-if="detail" :class="statusClass(detail.order.status)" size="small">
            {{ t(`status.${detail.order.status}`) }}
          </n-tag>
        </div>
      </template>
      <n-spin :show="loading">
        <div v-if="detail" class="order-modal-body">
          <div class="order-modal-tools">
            <n-button
              v-if="detail.order.status === 'pending'"
              :loading="action === 'check'"
              secondary
              size="small"
              @click="checkPayment"
            >
              <span class="tool-button-content">
                <span class="tool-icon tool-icon-check"></span>
                <span>{{ t('orders.check_payment') }}</span>
              </span>
            </n-button>
            <n-button
              v-if="detail.order.status === 'pending' || detail.order.status === 'expired'"
              :loading="action === 'confirm'"
              secondary
              size="small"
              type="warning"
              @click="confirmPayment"
            >
              <span class="tool-button-content">
                <span class="tool-icon tool-icon-confirm"></span>
                <span>{{ t('order.confirm_payment') }}</span>
              </span>
            </n-button>
            <n-button
              v-if="detail.order.status === 'paid'"
              :loading="action === 'notify'"
              secondary
              size="small"
              @click="resendNotify"
            >
              <span class="tool-button-content">
                <span class="tool-icon tool-icon-notify"></span>
                <span>{{ t('order.resend_notify') }}</span>
              </span>
            </n-button>
            <n-button
              :loading="action === 'delete'"
              secondary
              size="small"
              type="error"
              @click="deleteOrder"
            >
              <span class="tool-button-content">
                <span class="tool-icon tool-icon-delete"></span>
                <span>{{ t('order.delete') }}</span>
              </span>
            </n-button>
          </div>

          <section class="order-modal-section">
            <div class="detail-grid">
              <div class="detail-item">
                <span>{{ t('order.id') }}</span>
                <div class="detail-copy-row">
                  <strong>{{ detail.order.id }}</strong>
                  <n-button size="small" secondary @click="copyText(detail.order.id, { message })">{{ t('common.copy') }}</n-button>
                </div>
              </div>
              <div class="detail-item">
                <span>{{ t('order.merchant') }}</span>
                <strong>{{ detail.merchantName || detail.order.merchantId || '--' }}</strong>
              </div>
              <div class="detail-item detail-item-wide">
                <span>{{ t('order.info') }}</span>
                <strong>{{ detail.order.description || '--' }}</strong>
              </div>
              <div class="detail-item">
                <span>{{ t('order.created_at') }}</span>
                <strong>{{ formatTime(detail.order.createdAt) }}</strong>
              </div>
              <div v-if="detail.order.merchantNo" class="detail-item">
                <span>{{ t('order.merchant_no') }}</span>
                <div class="detail-copy-row">
                  <strong>{{ detail.order.merchantNo }}</strong>
                  <n-button size="small" secondary @click="copyText(detail.order.merchantNo, { message })">{{ t('common.copy') }}</n-button>
                </div>
              </div>
            </div>
          </section>

          <section class="order-modal-section">
            <h3>{{ t('order.payment_info') }}</h3>
            <div class="detail-grid">
              <div class="detail-item">
                <span>{{ t('order.amount') }}</span>
                <strong>{{ formatAmount(detail.order.amount) }} {{ assetName(detail.order.currency) }}</strong>
              </div>
              <div class="detail-item">
                <span>{{ t('order.pay_amount') }}</span>
                <strong>{{ payAmount(detail.order.payment) }}</strong>
              </div>
              <div class="detail-item">
                <span>{{ t('order.rate') }}</span>
                <strong>{{ rateText(detail) }}</strong>
              </div>
              <div class="detail-item">
                <span>{{ t('order.channel') }}</span>
                <strong>{{ detail.order.payway?.name || t('payment.channel_not_selected') }}</strong>
              </div>
              <div class="detail-item detail-item-wide">
                <span>{{ t('order.address') }}</span>
                <strong>{{ detail.order.payment.address || '--' }}</strong>
              </div>
              <div v-if="detail.order.status === 'paid'" class="detail-item detail-item-wide">
                <span>{{ t('order.tx_hash') }}</span>
                <a
                  v-if="txUrl(detail.order.payment)"
                  class="detail-link"
                  :href="txUrl(detail.order.payment)"
                  rel="noreferrer"
                  target="_blank"
                >
                  {{ detail.order.payment.tx?.txid }}
                </a>
                <strong v-else>{{ detail.order.payment.tx?.txid || '--' }}</strong>
              </div>
              <div v-if="detail.order.status === 'paid'" class="detail-item">
                <span>{{ t('order.confirm_method') }}</span>
                <strong>{{ detail.order.payment.tx?.confirmedBy === 'admin' ? t('order.confirm_manual') : t('order.confirm_auto') }}</strong>
              </div>
              <div v-if="detail.order.status === 'paid'" class="detail-item">
                <span>{{ t('order.confirm_time') }}</span>
                <strong>{{ detail.order.paidAt ? formatTime(detail.order.paidAt) : '--' }}</strong>
              </div>
            </div>
          </section>

          <section v-if="detail.review" class="order-modal-section">
            <h3>{{ t('order.review') }}</h3>
            <div class="detail-grid">
              <div class="detail-item">
                <span>{{ t('common.status') }}</span>
                <strong>{{ reviewImage ? t('order.review_pending') : t('order.review_done') }}</strong>
              </div>
              <div class="detail-item detail-item-wide">
                <span>{{ t('order.payment_confirm') }}</span>
                <strong class="detail-review-answer">{{ detail.review.answer }}</strong>
              </div>
              <div v-if="reviewImage" class="detail-item detail-item-wide">
                <span>{{ t('order.payment_image') }}</span>
                <n-image class="detail-review-image" :src="reviewImage" :alt="t('order.payment_image')" object-fit="contain" />
              </div>
            </div>
          </section>

          <section class="order-modal-section">
            <h3>{{ t('order.notify') }}</h3>
            <n-empty v-if="!detail.notify.length" :description="t('order.notify_empty')" />
            <div v-else class="notify-list">
              <div v-for="item in detail.notify" :key="item.id" class="notify-item">
                <strong>{{ t(`notify.${item.status}`) }}</strong>
                <span>
                  {{ item.status === 'done'
                    ? t('order.notify_done', { attempts: item.attempts })
                    : t('order.notify_attempt', { attempts: item.attempts, time: formatTime(item.nextRunAt) }) }}
                </span>
                <small v-if="item.lastError">{{ item.lastError }}</small>
              </div>
            </div>
          </section>
        </div>
      </n-spin>
    </n-card>
  </n-modal>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRoute } from "vue-router";
import { useMessage } from "naive-ui";
import PaymentDetails from "@/app/components/PaymentDetails.vue";
import PaymentSelector from "@/app/components/PaymentSelector.vue";
import ReviewModal from "@/app/components/ReviewModal.vue";
import LocaleSwitch from "@/app/components/LocaleSwitch.vue";
import { useCheckout } from "@/app/utils/checkout";
import type { Order } from "@/app/api";
import * as pay from "@/app/payments";
import { formatDisplayAmount as formatAmount } from "@/app/utils/format";
import { copyText } from "@/app/utils/clipboard";
import { formatTime } from "@/app/utils/format";
import { useI18n } from "@/app/i18n";

const route = useRoute();
const message = useMessage();
const orderId = String(route.params.id);
const reviewVisible = ref(false);
const { t } = useI18n();
const {
  changePayment,
  changingPayment,
  checkout,
  load,
  nowMs,
  paidReturnSeconds,
  paymentOptions,
  returnToMerchant,
  selectPayment,
} = useCheckout(orderId, message);

function shortText(value: unknown, start = 10, end = 8) {
  const text = String(value || "");
  return text.length > start + end + 3 ? `${text.slice(0, start)}...${text.slice(-end)}` : text;
}

function expired(order: Order) {
  return order.status === "expired" || Number(order.expireAt) * 1000 <= nowMs.value;
}

function statusText(order: Order) {
  return order.status === "pending" && expired(order) ? t("status.expired") : t(`status.${order.status}`);
}

function statusType(order: Order) {
  if (order.status === "paid") return "success";
  if (expired(order)) return "warning";
  return order.status === "invalid" ? "error" : "default";
}

function remainingText(order: Order) {
  const seconds = Math.max(0, Math.floor((Number(order.expireAt) * 1000 - nowMs.value) / 1000));
  if (!seconds) return t("checkout.expired_title");
  return t("checkout.remaining_value", {
    minutes: Math.floor(seconds / 60),
    seconds: String(seconds % 60).padStart(2, "0"),
  });
}

function remainingPercentage(order: Order) {
  const createdAt = Number(order.createdAt) * 1000;
  const expireAt = Number(order.expireAt) * 1000;
  if (!createdAt || !expireAt || expireAt <= createdAt) return 0;
  return Math.ceil((Math.max(0, expireAt - nowMs.value) / (expireAt - createdAt)) * 100);
}

function showPaymentReview(order: Order) {
  if (order.status !== "pending" || expired(order) || !order.payment?.driver) return false;
  const createdAt = Number(order.createdAt) * 1000;
  const expireAt = Number(order.expireAt) * 1000;
  return Boolean(createdAt && expireAt > createdAt && nowMs.value - createdAt >= (expireAt - createdAt) / 2);
}

function hasReturnUrl(order: Order) {
  return Boolean(order.returnUrl?.trim());
}
</script>

<template>
  <n-layout class="checkout-shell">
    <n-layout-header class="checkout-topbar">
      <div class="checkout-topbar-inner">
        <div class="checkout-brand">
          <strong>{{ checkout?.title || t('app.name') }}</strong>
          <span>{{ t('checkout.cashier') }}</span>
        </div>
        <LocaleSwitch />
      </div>
    </n-layout-header>

    <n-layout-content v-if="checkout" class="checkout-content" content-class="checkout-page">
      <section class="checkout-receipt">
        <div class="checkout-receipt-head">
          <div>
            <span>{{ t('checkout.merchant') }}</span>
            <strong>{{ checkout.merchant.name || t('app.name') }}</strong>
          </div>
          <n-tag :type="statusType(checkout.order)">{{ statusText(checkout.order) }}</n-tag>
        </div>
        <div class="checkout-amount-block">
          <span>{{ t('checkout.order_amount') }}</span>
          <strong>{{ formatAmount(checkout.order.amount) }} {{ pay.assetName(checkout.order.currency) }}</strong>
        </div>
        <div v-if="checkout.order.status === 'pending' && !expired(checkout.order)" class="checkout-countdown">
          <n-progress
            type="circle"
            :percentage="remainingPercentage(checkout.order)"
            :stroke-width="6"
            color="#16a34a"
            rail-color="#e5e7eb"
          >
            <div class="checkout-countdown-content">
              <span>{{ t('checkout.remaining') }}</span>
              <strong>{{ remainingText(checkout.order) }}</strong>
            </div>
          </n-progress>
        </div>
        <dl class="checkout-receipt-meta">
          <div>
            <dt>{{ t('checkout.order_id') }}</dt>
            <dd>
              <code>{{ checkout.order.merchantNo || checkout.order.id }}</code>
              <n-button size="tiny" text type="primary" @click="copyText(checkout.order.merchantNo || checkout.order.id, { message })">{{ t('common.copy') }}</n-button>
            </dd>
          </div>
          <div>
            <dt>{{ t('checkout.order_info') }}</dt>
            <dd>{{ checkout.order.description || t('checkout.default_description') }}</dd>
          </div>
          <div>
            <dt>{{ t('checkout.deadline') }}</dt>
            <dd>{{ formatTime(checkout.order.expireAt) }}</dd>
          </div>
        </dl>
      </section>

      <section class="checkout-flow" :class="{ 'checkout-flow--paid': checkout.order.status === 'paid' }">
        <template v-if="checkout.order.status === 'paid'">
          <div class="checkout-paid-state">
            <div class="checkout-paid-mark">✓</div>
            <div>
              <strong>{{ t('checkout.thanks') }}</strong>
              <span>{{ t('checkout.paid_confirmed') }}</span>
            </div>
          </div>
          <dl class="checkout-paid-meta">
            <div>
              <dt>{{ t('orders.column.payment') }}</dt>
              <dd>{{ pay.networkName(checkout.order.payment.driver) }} / {{ pay.assetName(checkout.order.payment.currency) }}</dd>
            </div>
            <div>
              <dt>{{ t('checkout.amount_due') }}</dt>
              <dd>{{ formatAmount(checkout.order.payment.amount) }} {{ pay.assetName(checkout.order.payment.currency) }}</dd>
            </div>
            <div v-if="checkout.order.payment.tx?.txid">
              <dt>{{ t('order.tx_hash') }}</dt>
              <dd>
                <a v-if="pay.txUrl(checkout.order.payment)" :href="pay.txUrl(checkout.order.payment)" target="_blank" rel="noreferrer">{{ t('telegram.tx_link') }}</a>
                <span v-else>{{ shortText(checkout.order.payment.tx.txid, 10, 8) }}</span>
              </dd>
            </div>
          </dl>
          <div v-if="hasReturnUrl(checkout.order)" class="checkout-return-actions">
            <n-button block type="primary" @click="returnToMerchant">{{ t('checkout.return_merchant') }}</n-button>
            <span>{{ t('checkout.return_countdown', { seconds: paidReturnSeconds }) }}</span>
          </div>
          <p v-else class="checkout-return-hint">{{ t('checkout.return_hint') }}</p>
        </template>

        <template v-else-if="expired(checkout.order)">
          <div class="checkout-expired-state">
            <strong>{{ t('checkout.expired_title') }}</strong>
            <span>{{ t('checkout.expired_warning') }}</span>
            <span>{{ t('checkout.expired_return') }}</span>
          </div>
          <n-button v-if="hasReturnUrl(checkout.order)" block type="primary" @click="returnToMerchant">{{ t('checkout.return_merchant') }}</n-button>
          <n-button block secondary type="warning" @click="reviewVisible = true">{{ t('checkout.review_button') }}</n-button>
        </template>

        <template v-else-if="checkout.order.payment.driver && !changingPayment">
          <PaymentDetails
            :payment="checkout.order.payment"
            :show-review="showPaymentReview(checkout.order)"
            @change="changePayment"
            @review="reviewVisible = true"
          />
        </template>

        <template v-else>
          <PaymentSelector
            :disabled="expired(checkout.order)"
            :options="paymentOptions"
            @select="selectPayment"
          />
        </template>
      </section>
    </n-layout-content>

    <n-layout-content v-else class="checkout-content" content-class="checkout-page">
      <section class="checkout-receipt checkout-skeleton-card">
        <div class="checkout-skeleton-head">
          <div>
            <span class="skeleton-line skeleton-text"></span>
            <span class="skeleton-line skeleton-title"></span>
          </div>
          <span class="skeleton-line checkout-skeleton-tag"></span>
        </div>
        <div class="checkout-skeleton-amount">
          <span class="skeleton-line skeleton-text"></span>
          <span class="skeleton-line"></span>
        </div>
        <div class="checkout-skeleton-countdown">
          <span class="checkout-skeleton-circle"></span>
        </div>
        <div class="checkout-skeleton-meta">
          <span class="skeleton-line"></span>
          <span class="skeleton-line"></span>
        </div>
      </section>

      <section class="checkout-flow checkout-skeleton-card">
        <div class="checkout-flow-head">
          <span class="skeleton-line skeleton-text"></span>
          <span class="skeleton-line skeleton-title"></span>
        </div>
        <div class="checkout-skeleton-step-back">
          <span class="skeleton-line skeleton-text"></span>
          <span class="skeleton-line skeleton-title"></span>
        </div>
        <div class="checkout-skeleton-network-list">
          <div class="checkout-skeleton-network-option">
            <span class="checkout-skeleton-icon"></span>
            <span class="skeleton-line"></span>
          </div>
          <div class="checkout-skeleton-network-option">
            <span class="checkout-skeleton-icon"></span>
            <span class="skeleton-line"></span>
          </div>
          <div class="checkout-skeleton-network-option">
            <span class="checkout-skeleton-icon"></span>
            <span class="skeleton-line"></span>
          </div>
        </div>
      </section>
    </n-layout-content>

    <n-layout-footer class="checkout-footer">
      <span>{{ t('checkout.copyright') }}</span>
      <a href="https://github.com/tgdash/HashPay" target="_blank" rel="noreferrer">HashPay</a>
    </n-layout-footer>

    <ReviewModal
      v-model:show="reviewVisible"
      v-if="checkout"
      :order="checkout.order"
      :order-id="orderId"
      :payment="checkout.order.payment"
      @submitted="load"
    />
  </n-layout>
</template>

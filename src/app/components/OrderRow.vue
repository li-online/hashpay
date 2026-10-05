<script setup lang="ts">
import { formatDisplayAmount as formatAmount } from "@/app/utils/format";
import { appT } from "@/app/i18n";
import { formatTime } from "@/app/utils/format";
import { assetName } from "@/shared/payments";
import type { Order } from "@/shared/types/api";

const props = withDefaults(defineProps<{
  compact?: boolean;
  order: Order;
  selectable?: boolean;
  selected?: boolean;
}>(), {
  compact: false,
  selectable: false,
  selected: false,
});

const emit = defineEmits<{
  open: [id: string];
  select: [checked: boolean];
}>();

function shortAddress(value: unknown) {
  const text = String(value || "");
  return text.length > 19 ? `${text.slice(0, 10)}...${text.slice(-6)}` : text;
}

function orderStatusText(status: string) {
  const labels: Record<string, string> = {
    expired: appT("status.expired"),
    invalid: appT("status.invalid"),
    paid: appT("status.paid"),
    pending: appT("status.pending"),
  };
  return labels[status] ?? status;
}

function orderStatusClass(status: string) {
  const classes: Record<string, string> = {
    expired: "is-muted",
    invalid: "is-error",
    paid: "is-success",
    pending: "is-warning",
  };
  return classes[status] ?? "";
}

</script>

<template>
  <div class="order-row" :class="{ 'order-row--plain': !selectable, 'order-row--compact': compact }">
    <div v-if="selectable" class="order-select-cell">
      <n-checkbox :checked="selected" @update:checked="(checked: boolean) => emit('select', checked)" />
    </div>
    <div class="order-cell order-id-cell">
      <button class="order-id-button" type="button" :title="props.order.id" @click="emit('open', props.order.id)">
        {{ props.order.id }}
      </button>
      <span>{{ props.order.description || '-' }}</span>
    </div>
    <div class="order-cell">
      <span class="order-status" :class="orderStatusClass(props.order.status)">{{ orderStatusText(props.order.status) }}</span>
    </div>
    <div class="order-cell order-amount-cell">
      <strong>{{ formatAmount(props.order.amount) }} {{ assetName(props.order.currency) }}</strong>
      <span v-if="props.order.payment?.amount">{{ formatAmount(props.order.payment.amount) }} {{ assetName(props.order.payment.currency) }}</span>
    </div>
    <div class="order-cell order-payment-cell">
      <strong class="order-payway-title">
        <span v-if="props.order.payway" class="order-payway-id">#{{ props.order.payway.id }}</span>
        <span>{{ props.order.payway ? props.order.payway.name || appT('payment.channel_deleted') : appT('payment.channel_not_selected') }}</span>
      </strong>
      <span :title="props.order.payment?.address || ''">
        {{ shortAddress(props.order.payment?.address) || '-' }}
      </span>
    </div>
    <div class="order-cell order-time-cell">
      <span>{{ formatTime(props.order.createdAt) }}</span>
    </div>
  </div>
</template>

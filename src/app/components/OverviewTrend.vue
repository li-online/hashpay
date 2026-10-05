<script setup lang="ts">
import { computed, ref } from "vue";
import type { Dashboard } from "@/app/api";
import { useI18n } from "@/app/i18n";
import { formatDisplayAmount as formatAmount } from "@/app/utils/format";

type TrendField = "amount" | "orders";
type TrendRange = keyof Dashboard["trends"];

const props = defineProps<{
  currency?: string;
  pending: number;
  trends?: Partial<Dashboard["trends"]> | null;
}>();

const charts = [
  { field: "amount", label: "overview.paid_amount" },
  { field: "orders", label: "overview.order_count" },
] as const;

const { t } = useI18n();
const range = ref<TrendRange>("td");
const hover = ref<{ field: TrendField; index: number } | null>(null);

const points = computed(() => props.trends?.[range.value] ?? []);
const ranges = computed(() => [
  { label: t("overview.range.today"), value: "td" },
  { label: t("overview.range.yesterday"), value: "yd" },
  { label: t("overview.range.7d"), value: "7d" },
  { label: t("overview.range.15d"), value: "15d" },
  { label: t("overview.range.30d"), value: "30d" },
]);

const summary = computed(() =>
  points.value.reduce(
    (result, item) => ({
      amount: result.amount + item.amount,
      orders: result.orders + item.orders,
    }),
    { amount: 0, orders: 0 },
  ),
);

const rangeLabel = computed(() => {
  if (!points.value.length) return "";
  const start = points.value[0].label;
  const end = points.value[points.value.length - 1].label;
  return start === end ? start : `${start} - ${end}`;
});

const chartViews = computed(() =>
  charts.map((chart) => {
    const values = points.value.map((item) => Number(item[chart.field]));
    const series = values.length ? values : [0];
    const max = Math.max(...series, 1);
    const step = series.length > 1 ? 300 / (series.length - 1) : 0;
    const coords = series.map((value, index) => ({
      x: 10 + step * index,
      y: 106 - (value / max) * 86,
    }));
    const active = hover.value?.field === chart.field ? coords[hover.value.index] : null;
    const row = hover.value?.field === chart.field ? points.value[hover.value.index] : null;
    const value = row && chart.field === "amount"
      ? [formatAmount(row.amount), props.currency].filter(Boolean).join(" ")
      : t("overview.orders_value", { count: row?.orders ?? 0 });
    const line = coords.map((item) => `${item.x},${item.y}`).join(" ");

    return {
      ...chart,
      active,
      area: line ? `10,106 ${line} 310,106` : "",
      line,
      markerStyle: active ? { left: `${active.x / 3.2}%`, top: `${active.y}px` } : {},
      tooltip: row ? `${row.label} ${value}` : "",
    };
  }),
);

function setHover(event: MouseEvent, field: TrendField) {
  const count = Math.max(points.value.length, 1);
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  hover.value = { field, index: Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1)))) };
}

function clearHover() {
  hover.value = null;
}
</script>

<template>
  <div class="overview-data-panel">
    <div class="overview-data-head">
      <div class="overview-range-tabs">
        <n-segmented v-model:value="range" :options="ranges" />
      </div>
    </div>
    <div class="trend-summary">
      <div class="trend-summary-primary">
        <span class="muted">{{ t('overview.paid_amount') }}</span>
        <strong>{{ formatAmount(summary.amount) }} {{ currency }}</strong>
      </div>
      <div>
        <span class="muted">{{ t('overview.order_count') }}</span>
        <strong>{{ summary.orders }}</strong>
      </div>
      <div>
        <span class="muted">{{ t('overview.pending_orders') }}</span>
        <strong>{{ pending }}</strong>
      </div>
    </div>
    <div class="trend-charts">
      <div
        v-for="chart in chartViews"
        :key="chart.field"
        class="trend-chart"
        @mouseleave="clearHover"
        @mousemove="setHover($event, chart.field)"
      >
        <div class="trend-chart-head">
          <span>{{ t(chart.label) }}</span>
        </div>
        <div class="trend-plot">
          <svg viewBox="0 0 320 116" preserveAspectRatio="none" aria-hidden="true">
            <polygon :points="chart.area" class="trend-area" :class="`trend-area-${chart.field}`" />
            <polyline :points="chart.line" class="trend-line" :class="`trend-line-${chart.field}`" />
            <line
              v-if="chart.active"
              class="trend-marker-line"
              :x1="chart.active.x"
              :x2="chart.active.x"
              y1="10"
              y2="106"
            />
          </svg>
          <span
            v-if="chart.active"
            class="trend-marker"
            :class="`trend-marker-${chart.field}`"
            :style="chart.markerStyle"
          />
          <div v-if="chart.active" class="trend-tooltip" :style="{ left: `${chart.active.x / 3.2}%` }">
            {{ chart.tooltip }}
          </div>
        </div>
      </div>
    </div>
    <div class="trend-range-label">
      {{ rangeLabel }}
    </div>
  </div>
</template>

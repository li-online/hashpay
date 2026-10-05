<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useMessage } from "naive-ui";
import { useRouter } from "vue-router";
import OrderModal from "@/app/components/OrderModal.vue";
import OrderRow from "@/app/components/OrderRow.vue";
import OverviewTrend from "@/app/components/OverviewTrend.vue";
import { api, type Dashboard, type Settings } from "@/app/api";
import { useI18n } from "@/app/i18n";
import { formatTime } from "@/app/utils/format";

const router = useRouter();
const message = useMessage();
const { t } = useI18n();

const view = reactive<{
  checkingHealth: boolean;
  checking: string;
  order: string | null;
  settings: Settings | null;
  stats: Dashboard | null;
}>({
  checkingHealth: false,
  checking: "",
  order: null,
  settings: null,
  stats: null,
});
let autoLoad: ReturnType<typeof setInterval> | undefined;
let loading = false;
const healthState = ref<Dashboard["health"]>([]);
let healthKnown = false;

const hour = new Date().getHours();
const greeting = computed(() => hour < 12 ? t("overview.greeting.morning") : hour < 18 ? t("overview.greeting.afternoon") : t("overview.greeting.evening"));

const health = computed(() =>
  healthState.value
    .map((item) => ({
      details: t(item.details),
      label: `#${item.id} ${item.name}`,
    })),
);

const orderVisible = computed({
  get: () => Boolean(view.order),
  set: (show) => {
    if (!show) view.order = null;
  },
});

async function load() {
  if (loading) return;
  loading = true;
  try {
    const [nextStats, nextConfig] = await Promise.all([
      api.dashboard.get(),
      view.settings ? Promise.resolve(view.settings) : api.settings.get(),
    ]);
    view.stats = nextStats;
    view.settings = nextConfig;
    if (!healthKnown) {
      healthKnown = true;
      if (nextStats.health.length) void checkHealth(false);
    } else if (!sameHealthIds(nextStats.health, healthState.value)) {
      void checkHealth(false);
    }
  } finally {
    loading = false;
  }
}

function sameHealthIds(a: Dashboard["health"], b: Dashboard["health"]) {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((item) => item.id));
  return b.every((item) => ids.has(item.id));
}

async function checkHealth(showMessage = true) {
  if (view.checkingHealth) return;
  view.checkingHealth = true;
  try {
    const stats = await api.dashboard.check();
    healthState.value = stats.health;
    if (view.stats) view.stats = { ...view.stats, health: stats.health };
    if (showMessage) message.success(t("order.check_done"));
  } finally {
    view.checkingHealth = false;
  }
}

async function checkOrder(id: string) {
  view.checking = id;
  try {
    await api.orders.check(id);
    message.success(t("order.check_done"));
    await load();
  } catch {
    // API layer displays the error.
  } finally {
    view.checking = "";
  }
}

onMounted(() => {
  void load();
  autoLoad = setInterval(() => void load(), 3000);
});

onBeforeUnmount(() => {
  if (autoLoad) clearInterval(autoLoad);
});
</script>

<template>
  <div class="overview-page grid">
    <div class="section-title overview-title">
      <div>
        <h2>{{ greeting }}</h2>
        <p class="muted">{{ t('overview.welcome') }}</p>
      </div>
      <small class="muted">{{ t('overview.auto_refresh') }}</small>
    </div>

    <section class="overview-summary">
      <OverviewTrend
        :currency="view.settings?.currency"
        :pending="view.stats?.pending ?? 0"
        :trends="view.stats?.trends"
      />
    </section>

    <div class="overview-columns">
      <section class="panel overview-panel">
        <div class="section-title">
          <h2>{{ t('overview.action_required') }}</h2>
          <n-button v-if="view.stats?.actions?.length" text type="primary" @click="router.push('/admin/orders')">{{ t('overview.view_all') }}</n-button>
        </div>
        <n-empty v-if="!view.stats?.actions?.length" class="overview-empty" :description="t('overview.no_actions')" />
        <div v-else class="overview-action-list">
          <div
            v-for="order in view.stats.actions"
            :key="order.id"
            class="overview-action-item"
          >
            <button class="overview-action-order" type="button" @click="view.order = order.id">
              <strong>{{ order.id }}</strong>
              <small>{{ formatTime(order.createdAt) }}</small>
            </button>
            <n-button
              :loading="view.checking === order.id"
              secondary
              size="small"
              type="primary"
              @click="checkOrder(order.id)"
            >
              {{ t('common.check') }}
            </n-button>
          </div>
        </div>
      </section>

      <section class="panel overview-panel">
        <div class="section-title">
          <h2>{{ t('overview.system_health') }}</h2>
          <n-button v-if="health.length" :loading="view.checkingHealth" text type="primary" @click="checkHealth()">{{ t('setup.recheck') }}</n-button>
        </div>
        <n-empty v-if="!health.length" class="overview-empty" :description="t('overview.no_health')" />
        <div v-else class="overview-health-list">
          <div v-for="item in health" :key="item.label" class="overview-health-item">
            <div>
              <strong>{{ item.label }}</strong>
              <small>{{ item.details }}</small>
            </div>
            <span class="order-status is-warning">{{ t('overview.warning') }}</span>
          </div>
        </div>
      </section>
    </div>

    <div class="overview-single-column">
      <section class="panel overview-panel">
        <div class="section-title">
          <h2>{{ t('overview.recent_orders') }}</h2>
          <n-button text type="primary" @click="router.push('/admin/orders')">{{ t('overview.view_all') }}</n-button>
        </div>
        <n-empty v-if="!view.stats?.orders?.length" :description="t('overview.no_recent_orders')" />
        <div v-else class="orders-table overview-orders-table">
          <div class="orders-table-head order-row--plain">
            <span>{{ t('orders.column.order') }}</span>
            <span>{{ t('orders.column.status') }}</span>
            <span>{{ t('orders.column.amount') }}</span>
            <span>{{ t('orders.column.payment') }}</span>
            <span>{{ t('orders.column.created_at') }}</span>
          </div>
          <OrderRow
            v-for="order in view.stats.orders"
            :key="order.id"
            compact
            :order="order"
            @open="view.order = $event"
          />
        </div>
      </section>
    </div>
    <OrderModal
      v-model:show="orderVisible"
      :order-id="view.order"
      @changed="load"
      @deleted="load"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, watch } from "vue";
import { useMessage } from "naive-ui";
import OrderModal from "@/app/components/OrderModal.vue";
import OrderRow from "@/app/components/OrderRow.vue";
import { api } from "@/app/api";
import { useI18n } from "@/app/i18n";
import { ask } from "@/app/utils/telegram";

const message = useMessage();
const { t } = useI18n();

const view = reactive({
  detail: null as string | null,
  items: [] as any[],
  loading: false,
  page: 1,
  pageSize: 20,
  query: "",
  selected: [] as string[],
  status: "all",
  total: 0,
});

const statuses = computed(() => [
  { label: t("common.all"), value: "all" },
  { label: t("status.pending"), value: "pending" },
  { label: t("status.paid"), value: "paid" },
  { label: t("status.expired"), value: "expired" },
  { label: t("status.invalid"), value: "invalid" },
]);

const selection = computed(() => {
  const ids = view.items.map((order) => String(order.id));
  const visible = ids.filter((id) => view.selected.includes(id));
  const pending = new Set(view.items.filter((order) => order.status === "pending").map((order) => String(order.id)));

  return {
    ids,
    pending: view.selected.filter((id) => pending.has(id)),
    all: ids.length > 0 && visible.length === ids.length,
    some: visible.length > 0 && visible.length !== ids.length,
  };
});
const detailOpen = computed({
  get: () => Boolean(view.detail),
  set: (show) => {
    if (!show) view.detail = null;
  },
});

async function load(action?: () => Promise<void> | void) {
  view.loading = true;
  try {
    await action?.();

    const result = await api.orders.list({
      page: view.page,
      pageSize: view.pageSize,
      q: view.query,
      status: view.status,
    });
    view.items = result.items;
    view.page = result.page;
    view.pageSize = result.pageSize;
    view.total = result.total;
  } finally {
    view.loading = false;
  }
}

async function checkPayments() {
  const ids = selection.value.pending;
  if (!ids.length) return;

  await load(async () => {
    await Promise.all(ids.map((id) => api.silent.orders.check(id).catch(() => null)));
    message.success(t("orders.batch_checked"));
  });
}

async function deleteOrders() {
  const ids = [...view.selected];
  if (!ids.length) return;
  if (!await ask(t("orders.delete_selected_warning"))) return;

  await load(async () => {
    await Promise.all(ids.map((id) => api.silent.orders.remove(id).catch(() => null)));
    message.success(t("orders.batch_deleted"));
    view.selected = view.selected.filter((id) => !ids.includes(id));
  });
}

function select(target: string | string[], checked: boolean) {
  const ids = Array.isArray(target) ? target : [target];
  const selected = new Set(view.selected);

  for (const id of ids) {
    if (checked) selected.add(id);
    else selected.delete(id);
  }

  view.selected = Array.from(selected);
}

async function removeDeleted(id: string) {
  await load(() => {
    view.selected = view.selected.filter((item) => item !== id);
  });
}

watch(
  () => [view.query, view.status],
  (_value, _oldValue, onCleanup) => {
    if (view.page !== 1) {
      view.page = 1;
      return;
    }
    const timer = setTimeout(() => {
      void load();
    }, 250);
    onCleanup(() => clearTimeout(timer));
  },
);

watch(
  () => [view.page, view.pageSize],
  () => {
    void load();
  },
);

onMounted(load);
</script>

<template>
  <div class="orders-view grid">
    <div class="section-title">
      <h2>{{ t('orders.title') }}</h2>
      <div class="topbar-actions">
        <n-button :loading="view.loading" @click="load()">{{ t('common.refresh') }}</n-button>
      </div>
    </div>
    <section class="orders-workbench">
      <div class="orders-toolbar">
        <n-segmented v-model:value="view.status" :options="statuses" />
        <n-input v-model:value="view.query" clearable :placeholder="t('orders.search')" />
      </div>
      <div class="orders-bulkbar">
        <span>{{ view.selected.length ? t('orders.selected', { count: view.selected.length }) : t('orders.total', { count: view.total }) }}</span>
        <div v-if="view.selected.length" class="orders-bulk-actions">
          <n-button :disabled="!selection.pending.length" :loading="view.loading" size="small" @click="checkPayments">{{ t('orders.check_payment') }}</n-button>
          <n-button :loading="view.loading" size="small" tertiary type="error" @click="deleteOrders">{{ t('orders.delete_selected') }}</n-button>
          <n-button size="small" quaternary @click="view.selected = []">{{ t('orders.clear_selection') }}</n-button>
        </div>
      </div>

      <div class="orders-table">
        <div class="orders-table-head">
          <span>
            <n-checkbox
              :checked="selection.all"
              :disabled="!view.items.length"
              :indeterminate="selection.some"
              @update:checked="select(selection.ids, $event)"
            />
          </span>
          <span>{{ t('orders.column.order') }}</span>
          <span>{{ t('orders.column.status') }}</span>
          <span>{{ t('orders.column.amount') }}</span>
          <span>{{ t('orders.column.payment') }}</span>
          <span>{{ t('orders.column.created_at') }}</span>
        </div>
        <template v-if="view.loading">
          <div v-for="item in 6" :key="item" class="order-row order-row--skeleton" aria-hidden="true">
            <div class="order-select-cell">
              <n-skeleton circle style="height: 16px; width: 16px" />
            </div>
            <div class="order-cell order-id-cell">
              <n-skeleton text style="width: 78%" />
              <n-skeleton text style="width: 52%" />
            </div>
            <div class="order-cell">
              <n-skeleton text style="width: 54px" />
            </div>
            <div class="order-cell order-amount-cell">
              <n-skeleton text style="width: 86%" />
              <n-skeleton text style="width: 62%" />
            </div>
            <div class="order-cell order-payment-cell">
              <n-skeleton text style="width: 80%" />
              <n-skeleton text style="width: 58%" />
            </div>
            <div class="order-cell order-time-cell">
              <n-skeleton text style="width: 92%" />
            </div>
          </div>
        </template>
        <div v-else-if="!view.items.length" class="orders-table-empty">
          <n-empty :description="t('orders.empty')" />
        </div>
        <template v-else>
          <OrderRow
            v-for="order in view.items"
            :key="order.id"
            :order="order"
            selectable
            :selected="view.selected.includes(order.id)"
            @open="view.detail = $event"
            @select="select(order.id, $event)"
          />
        </template>
      </div>
      <div v-if="view.total" class="orders-pagination">
        <span>{{ t('orders.total', { count: view.total }) }}</span>
        <n-pagination
          v-model:page="view.page"
          v-model:page-size="view.pageSize"
          :item-count="view.total"
          :page-sizes="[10, 20, 50, 100]"
          show-size-picker
        />
      </div>
    </section>

    <OrderModal
      v-model:show="detailOpen"
      :order-id="view.detail"
      @changed="load()"
      @deleted="removeDeleted"
    />
  </div>
</template>

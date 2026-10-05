<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useMessage } from "naive-ui";
import AppIcon from "@/app/components/AppIcon.vue";
import NSegmented from "@/app/components/NSegmented.vue";
import { useI18n } from "@/app/i18n";
import * as payment from "@/app/payments";
import { api, type Payment } from "@/app/api";
import { ask } from "@/app/utils/telegram";

interface PaymentForm {
  address: string;
  assets: string[];
  data: Record<string, string>;
  driver: string;
  enabled: boolean;
  name: string;
}

const message = useMessage();
const { t } = useI18n();
const saving = ref(false);
const methods = ref<Payment[]>([]);
const dialog = reactive({
  method: null as Payment | null,
  mode: "" as "" | "edit" | "new",
});
const selection = reactive({
  evm: {} as Record<string, string[]>,
  kind: "chain" as payment.Kind,
});
const form = reactive<PaymentForm>(defaultForm());

const isEdit = computed(() => dialog.mode === "edit");
const dialogOpen = computed(() => dialog.mode !== "" && payment.drivers.length > 0);
const drivers = computed(() => payment.choices(payment.drivers, selection.kind, isEdit.value ? form.driver : ""));
const currentDriver = computed(() => drivers.value.find((driver) => driver.id === form.driver) ?? drivers.value[0]!);
const editableFields = computed(() => {
  const driver = payment.isEvm(currentDriver.value) ? payment.evmDriver(payment.drivers, payment.evmIconNetwork) : currentDriver.value;
  return [payment.fieldFor(driver)];
});
const dataFields = computed(() => currentDriver.value.data ?? []);
const selectedAssets = computed(() => form.assets);
const selectedNetwork = computed(() => payment.driverNetwork(currentDriver.value));
const availableAssets = computed(() => payment.assetsFor(currentDriver.value, selectedNetwork.value));
const selectedNetworks = computed(() => Object.keys(selection.evm));
const kindOptions = computed(() => payment.kinds.map((item) => ({ ...item, label: t(item.label) })));

async function load() {
  methods.value = await api.payments.list();
}

async function save() {
  if (!validate()) return;

  saving.value = true;
  try {
    if (!isEdit.value && payment.isEvm(currentDriver.value.id)) {
      await Promise.all(selectedNetworks.value.map((network) => api.payments.create(payload(payment.evmDriver(payment.drivers, network).id, network, selection.evm[network]))));
    } else if (isEdit.value) {
      await api.payments.update(dialog.method!.id, payload(currentDriver.value.id, selectedNetwork.value, selectedAssets.value));
    } else {
      await api.payments.create(payload(currentDriver.value.id, selectedNetwork.value, selectedAssets.value));
    }
    message.success(t(isEdit.value ? "payment.save_updated" : "payment.save_created"));
    await load();
    closeDialog();
  } finally {
    saving.value = false;
  }
}

function payload(driverId: string, network: string, assets: string[]) {
  return {
    address: form.address.trim(),
    assets,
    data: { ...form.data },
    driver: driverId,
    name: selectedNetworks.value.length > 1 && payment.isEvmDriver(payment.drivers, driverId) ? `${form.name.trim()} · ${networkName(network)}` : form.name.trim(),
    status: isEdit.value && !form.enabled ? "disabled" as const : "enabled" as const,
  };
}

async function remove(id: number) {
  if (!await ask(t("payment.delete_warning"))) return;
  await api.payments.remove(id);
  message.success(t("payment.deleted"));
  await load();
}

function validate() {
  if (!form.name.trim()) {
    message.error(t("payment.validation.name_required"));
    return false;
  }

  const missing = editableFields.value.find((field) => field.required && !form.address.trim());
  if (missing) {
    message.error(t("payment.validation.field_required", { field: missing.label }));
    return false;
  }

  const addressError = payment.addressError(currentDriver.value, form.address.trim());
  if (addressError) {
    message.error(addressError);
    return false;
  }

  const missingData = !isEdit.value ? dataFields.value.find((field) => !form.data[field.id]?.trim()) : null;
  if (missingData) {
    message.error(t("payment.validation.field_required", { field: t(missingData.nameKey) }));
    return false;
  }

  if (!isEdit.value && payment.isEvm(currentDriver.value.id)) {
    if (!selectedNetworks.value.length) {
      message.error(t("payment.validation.evm_network_required"));
      return false;
    }
    for (const network of selectedNetworks.value) {
      if (!selection.evm[network].length) {
        message.error(t("payment.validation.network_asset_required", { network: networkName(network) }));
        return false;
      }
    }
    return true;
  }

  if (!selectedAssets.value.length) {
    message.error(t("payment.validation.asset_required"));
    return false;
  }
  return true;
}

function resetForm() {
  selection.kind = "chain";
  selection.evm = {};
  Object.assign(form, defaultForm());
  const first = payment.drivers.find((driver) => driver.kind === selection.kind) ?? payment.drivers[0];
  if (first) setDriver(first.id);
}

function fillForm() {
  if (dialog.mode === "new") {
    resetForm();
    return;
  }

  const method = dialog.method!;
  selection.kind = payment.kindOf(payment.drivers, method.driver);
  selection.evm = payment.isEvmDriver(payment.drivers, method.driver) ? { [methodDriver(method)!.network]: method.assets } : {};
  Object.assign(form, {
    address: method.address,
    assets: [...method.assets],
    data: {},
    driver: method.driver,
    enabled: method.status !== "disabled",
    name: method.name,
  });
}

function closeDialog() {
  dialog.mode = "";
  dialog.method = null;
}

function add() {
  dialog.mode = "new";
  dialog.method = null;
  fillForm();
}

function edit(method: Payment) {
  dialog.mode = "edit";
  dialog.method = method;
  fillForm();
}

function setKind(kind: payment.Kind) {
  selection.kind = kind;
  const driver = payment.drivers.find((item) => item.kind === kind);
  if (driver) setDriver(driver.id);
}

function setKindValue(value: string | number | boolean) {
  setKind(value as payment.Kind);
}

function setDriver(driverId: string) {
  const driver = drivers.value.find((item) => item.id === driverId)!;
  const network = payment.driverNetwork(driver);
  form.driver = driver.id;
  form.address = "";
  form.assets = [...driver.assets];
  form.data = {};
  selection.evm = payment.isEvm(driver.id) ? { [network]: [...payment.assetsFor(driver, network)] } : {};
}

function toggleAsset(asset: string) {
  if (selectedAssets.value.includes(asset) && selectedAssets.value.length === 1) {
    message.warning(t("payment.validation.asset_required"));
    return;
  }
  form.assets = selectedAssets.value.includes(asset)
    ? selectedAssets.value.filter((item) => item !== asset)
    : [...selectedAssets.value, asset];
}

function toggleEvmNetwork(network: string) {
  const next = { ...selection.evm };
  if (next[network]) {
    if (Object.keys(next).length === 1) {
      message.warning(t("payment.validation.evm_network_required"));
      return;
    }
    delete next[network];
  } else {
    next[network] = [...payment.assetsFor(currentDriver.value, network)];
  }
  selection.evm = next;
}

function toggleEvmAsset(network: string, asset: string) {
  const selected = selection.evm[network];
  if (selected.includes(asset) && selected.length === 1) {
    message.warning(t("payment.validation.network_asset_required", { network: networkName(network) }));
    return;
  }
  selection.evm = {
    ...selection.evm,
    [network]: selected.includes(asset) ? selected.filter((item) => item !== asset) : [...selected, asset],
  };
}

function defaultForm(): PaymentForm {
  return {
    address: "",
    assets: [],
    data: {},
    driver: "",
    enabled: true,
    name: "",
  };
}

function driverByNetwork(network: string) {
  return payment.drivers.find((driver) => driver.network === network);
}

function methodDriver(method: Payment) {
  return payment.drivers.find((driver) => driver.id === method.driver);
}

function networkName(network: string) {
  return payment.networkName(network);
}

function networkIcon(network: string) {
  return driverByNetwork(network)?.icon ?? "";
}

function driverIcon(driver: payment.DriverChoice, network = payment.driverNetwork(driver)) {
  return payment.isEvm(driver) ? networkIcon(payment.evmIconNetwork) : driver.icon;
}

function driverIconLabel(driver: payment.DriverChoice, network = payment.driverNetwork(driver)) {
  return payment.isEvm(driver) ? networkName(payment.evmIconNetwork) : payment.networkName(network);
}

onMounted(load);
</script>

<template>
<div class="grid">
  <div class="section-title">
    <div>
      <h2>{{ t("payment.channel") }}</h2>
    </div>
    <n-button type="primary" :disabled="!payment.drivers.length" @click="add">{{ t("payment.channel_add") }}</n-button>
  </div>

  <section class="panel grid">
    <n-empty v-if="!methods.length" :description="t('payment.channel_empty')" />
    <div
      v-for="item in methods"
      :key="item.id"
      class="list-card pay-card"
    >
      <div class="pay-card-main">
        <span v-if="methodDriver(item)?.icon" class="pay-icon">
          <AppIcon :name="methodDriver(item)!.icon" :label="payment.networkName(methodDriver(item)!.network)" />
        </span>
        <div class="pay-info">
          <strong>{{ item.name }} <span class="muted">#{{ item.id }}</span></strong>
          <p>{{ methodDriver(item) ? payment.networkName(methodDriver(item)!.network) : item.driver }} / {{ item.status === 'disabled' ? t('common.disabled') : item.status === 'error' ? t('payment.channel_error') : t('common.enabled') }}</p>
          <div class="chip-row readonly">
            <span v-for="asset in item.assets" :key="`${item.id}-${asset}`">{{ payment.assetName(asset) }}</span>
          </div>
          <p class="pay-address">{{ item.address || '--' }}</p>
        </div>
      </div>
      <div class="form-actions">
        <n-button size="small" @click="edit(item)">{{ t("common.edit") }}</n-button>
        <n-button size="small" tertiary type="error" @click="remove(item.id)">{{ t("common.delete") }}</n-button>
      </div>
    </div>
  </section>

  <n-modal :show="dialogOpen" @update:show="!$event && closeDialog()">
    <n-card
      :title="t(isEdit ? 'payment.channel_edit' : 'payment.channel_new')"
      closable
      class="payment-modal-card"
      role="dialog"
      aria-modal="true"
      @close="closeDialog"
    >
      <div class="payment-modal-body grid">
        <div class="form-section grid">
          <h3>{{ t("payment.channel_name") }}</h3>
          <n-input v-model:value="form.name" :placeholder="t('payment.channel_name_placeholder')" />
          <div v-if="isEdit" class="switch-line">
            <span>{{ t("payment.channel_enabled") }}</span>
            <n-switch v-model:value="form.enabled" />
          </div>
        </div>

        <div v-if="isEdit" class="form-section">
          <h3>{{ t("payment.channel") }}</h3>
          <div class="readonly-channel">
            <span v-if="currentDriver.icon" class="pay-icon">
              <AppIcon :name="currentDriver.icon" :label="payment.networkName(selectedNetwork)" />
            </span>
            <div>
              <strong>{{ payment.networkName(selectedNetwork) }}</strong>
              <p>{{ t(payment.kinds.find((item) => item.value === selection.kind)!.label) }}</p>
            </div>
          </div>
        </div>

        <div v-if="!isEdit" class="form-section grid">
          <h3>{{ t("common.type") }}</h3>
          <NSegmented :value="selection.kind" :options="kindOptions" @update:value="setKindValue" />
        </div>

        <div v-if="!isEdit" class="form-section">
          <h3>{{ t("payment.channel_network") }}</h3>
          <n-empty v-if="!drivers.length" :description="t(selection.kind === 'wallet' ? 'payment.network_empty_wallet' : 'payment.network_empty_kind')" />
          <div v-else class="network-choice-grid">
            <button
              v-for="driver in drivers"
              :key="driver.id"
              :class="{ 'is-active': form.driver === driver.id }"
              type="button"
              @click="setDriver(driver.id)"
            >
              <span class="choice-driver-title">
                <AppIcon
                  v-if="driverIcon(driver, payment.choiceNetwork(driver))"
                  class="choice-driver-icon"
                  :name="driverIcon(driver, payment.choiceNetwork(driver))"
                  :label="driverIconLabel(driver, payment.choiceNetwork(driver))"
                />
                <strong>{{ payment.networkName(payment.driverNetwork(driver)) }}</strong>
              </span>
            </button>
          </div>
          <div v-if="payment.isEvm(currentDriver)" class="grid">
            <div class="chip-row">
              <button
                v-for="item in payment.driverNetworks(currentDriver)"
                :key="item"
                :class="{ 'is-active': selectedNetworks.includes(item) }"
                type="button"
                @click="toggleEvmNetwork(item)"
              >
                <AppIcon v-if="networkIcon(item)" class="chip-icon" :name="networkIcon(item)" :label="networkName(item)" />
                {{ networkName(item) }}
              </button>
            </div>
            <p class="muted">{{ t("payment.evm_hint") }}</p>
          </div>
        </div>

        <div class="form-section grid">
          <h3>{{ t("payment.currency") }}</h3>
          <template v-if="!isEdit && payment.isEvm(currentDriver)">
            <div v-for="item in selectedNetworks" :key="item" class="form-field-block">
              <strong>{{ networkName(item) }} {{ t("payment.currency") }}</strong>
              <div class="chip-row">
                <button
                  v-for="asset in payment.assetsFor(currentDriver, item)"
                  :key="`${item}-${asset}`"
                  :class="{ 'is-active': selection.evm[item].includes(asset) }"
                  type="button"
                  @click="toggleEvmAsset(item, asset)"
                >
                  {{ payment.assetName(asset) }}
                </button>
              </div>
            </div>
          </template>
          <div v-else class="chip-row">
            <button v-for="asset in availableAssets" :key="asset" :class="{ 'is-active': selectedAssets.includes(asset) }" type="button" @click="toggleAsset(asset)">
              {{ payment.assetName(asset) }}
            </button>
          </div>
        </div>

        <div class="form-section grid">
          <h3>{{ t("payment.channel_info") }}</h3>
          <template v-for="field in editableFields" :key="field.key">
            <div class="form-field-block">
              <n-form-item :show-label="false" class="field-form-item">
                <n-input v-model:value="form.address" :placeholder="field.label" />
              </n-form-item>
              <small v-if="field.help" class="field-help">{{ field.help }}</small>
            </div>
          </template>
          <div v-for="field in dataFields" :key="field.id" class="form-field-block">
            <n-form-item :show-label="false" class="field-form-item">
              <n-input
                v-model:value="form.data[field.id]"
                type="password"
                show-password-on="click"
                :placeholder="t(field.nameKey)"
              />
            </n-form-item>
            <small v-if="field.helpKey" class="field-help" v-html="t(field.helpKey)"></small>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="modal-actions">
          <n-button secondary @click="closeDialog">{{ t("common.cancel") }}</n-button>
          <n-button type="primary" :loading="saving" @click="save">{{ t(isEdit ? "common.save" : "common.add") }}</n-button>
        </div>
      </template>
    </n-card>
  </n-modal>
</div>
</template>

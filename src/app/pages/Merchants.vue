<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useMessage } from "naive-ui";
import { useRoute, useRouter } from "vue-router";
import { api, type Merchant } from "@/app/api";
import { useI18n } from "@/app/i18n";
import { copyText } from "@/app/utils/clipboard";
import { formatTime } from "@/app/utils/format";
import { authMode, type AuthMode } from "@/shared/merchants";
import { ask } from "@/app/utils/telegram";

interface MerchantForm {
  callback: string;
  name: string;
  status: Merchant["status"];
  type: Merchant["type"];
}

const route = useRoute();
const router = useRouter();
const message = useMessage();
const { t } = useI18n();
const merchants = ref<Merchant[]>([]);
const credential = ref<{ key: string; merchantId: string; mode: AuthMode } | null>(null);
const loading = ref(false);
const form = reactive<MerchantForm>({ callback: "", name: "", status: "enabled", type: "website" });

const typeOptions = computed<Array<{ description: string; label: string; value: Merchant["type"] }>>(() => [
  {
    description: t("merchant.type.website_desc"),
    label: t("merchant.type.website"),
    value: "website",
  },
  {
    description: t("merchant.type.telegram_desc"),
    label: t("merchant.type.telegram"),
    value: "telegram",
  },
  {
    description: t("merchant.type.ezfp_desc"),
    label: t("merchant.type.ezfp"),
    value: "ezfp",
  },
]);
const typeLabels = computed<Record<string, string>>(() => Object.fromEntries(typeOptions.value.map((item) => [item.value, item.label])));

const mode = computed<"" | "edit" | "new">(() => {
  if (route.path.endsWith("/new")) return "new";
  return route.params.id ? "edit" : "";
});
const editingId = computed(() => (mode.value === "edit" ? String(route.params.id) : ""));
const current = computed(() => merchants.value.find((item) => item.id === editingId.value) ?? null);
const isEdit = computed(() => mode.value === "edit");
const currentMode = computed(() => authMode(current.value?.type ?? form.type));
const typeDescription = computed(() => typeOptions.value.find((item) => item.value === form.type)?.description ?? "");
const formOpen = computed({
  get: () => mode.value !== "",
  set: (show) => {
    if (!show) closeForm();
  },
});
const credentialOpen = computed({
  get: () => Boolean(credential.value),
  set: (show) => {
    if (!show) credential.value = null;
  },
});

async function run(action: () => Promise<void>) {
  loading.value = true;
  try {
    await action();
  } finally {
    loading.value = false;
  }
}

async function load() {
  merchants.value = await api.merchants.list();
  syncForm();
}

async function save() {
  const name = form.name.trim();
  const callback = form.callback.trim();
  if (!name) {
    message.error(t("merchant.validation.name_required"));
    return;
  }
  if (callback && !callback.startsWith("https://")) {
    message.error(t("merchant.validation.callback_https"));
    return;
  }

  const creating = mode.value === "new";
  const input = { callback, name, status: form.status, type: form.type };

  await run(async () => {
    const result = editingId.value
      ? await api.merchants.update(editingId.value, input)
      : await api.merchants.create(input);
    message.success(creating ? t("merchant.created") : t("merchant.saved"));
    await load();
    closeForm();
    if (result.credential) {
      credential.value = {
        key: result.credential,
        merchantId: result.merchant.id,
        mode: authMode(result.merchant.type),
      };
    }
  });
}

async function remove(id: string) {
  if (!await ask(t("merchant.delete_warning"))) return;
  await run(async () => {
    await api.merchants.remove(id);
    message.success(t("merchant.deleted"));
    closeForm();
    await load();
  });
}

async function setStatus(item: Merchant, status: string) {
  const next = status === "enabled" ? "enabled" : "disabled";
  const previous = item.status;
  item.status = next;
  try {
    await run(async () => {
      const result = await api.merchants.update(item.id, {
        callback: item.callback ?? "",
        name: item.name,
        status: next,
        type: item.type,
      });
      merchants.value = merchants.value.map((merchant) => (merchant.id === result.merchant.id ? result.merchant : merchant));
      message.success(next === "enabled" ? t("merchant.enabled") : t("merchant.disabled"));
    });
  } catch {
    item.status = previous;
  }
}

async function resetCredential() {
  if (!editingId.value) return;
  if (!await ask(t("merchant.reset_key_warning"))) return;
  await run(async () => {
    const result = await api.merchants.rotateCredential(editingId.value);
    message.success(t("merchant.key_reset"));
    await load();
    closeForm();
    credential.value = {
      key: result.credential,
      merchantId: result.merchant.id,
      mode: authMode(result.merchant.type),
    };
  });
}

function closeForm() {
  Object.assign(form, { callback: "", name: "", status: "enabled", type: "website" });
  void router.push("/admin/merchants");
}

function syncForm() {
  if (mode.value === "new") {
    Object.assign(form, { callback: "", name: "", status: "enabled", type: "website" });
    return;
  }
  if (!current.value) return;
  Object.assign(form, {
    callback: current.value.callback ?? "",
    name: current.value.name,
    status: current.value.status,
    type: current.value.type,
  });
}

watch(
  () => [mode.value, editingId.value, current.value] as const,
  syncForm,
  { immediate: true },
);

onMounted(() => run(load));
</script>

<template>
  <div class="grid">
    <div class="section-title">
      <div>
        <h2>{{ t('merchant.list') }}</h2>
      </div>
      <n-button type="primary" @click="router.push('/admin/merchants/new')">{{ t('merchant.add') }}</n-button>
    </div>

    <section class="panel grid">
      <n-empty v-if="!merchants.length" :description="t('merchant.empty')" />
      <div
        v-for="item in merchants"
        :key="item.id"
        class="list-card merchant-card is-clickable"
        @click="router.push(`/admin/merchants/${item.id}/edit`)"
      >
        <div class="merchant-card-main">
          <div class="merchant-card-title">
            <strong>{{ item.name }}</strong>
            <n-tag size="small">{{ typeLabels[item.type] || item.type }}</n-tag>
          </div>
          <p>{{ t('merchant.created_at') }}：{{ formatTime(item.createdAt) }}</p>
          <p>{{ t('merchant.callback_url') }}：{{ item.callback || t('merchant.not_configured') }}</p>
        </div>
        <div class="merchant-card-actions" @click.stop>
          <n-button size="small" quaternary @click="router.push(`/admin/merchants/${item.id}/edit`)">{{ t('common.edit') }}</n-button>
          <div class="merchant-status-control">
            <span>{{ item.status === 'enabled' ? t('common.enabled_short') : t('common.disabled_short') }}</span>
            <n-switch
              :disabled="loading"
              :value="item.status"
              checked-value="enabled"
              unchecked-value="disabled"
              @update:value="setStatus(item, $event)"
            />
          </div>
        </div>
      </div>
    </section>

    <n-modal v-model:show="formOpen">
      <n-card
        :title="isEdit ? t('merchant.edit') : t('merchant.new')"
        closable
        class="payment-modal-card"
        role="dialog"
        aria-modal="true"
        @close="formOpen = false"
      >
        <div class="payment-modal-body grid">
          <div class="form-section grid">
            <h3>{{ t('merchant.name') }}</h3>
            <n-input v-model:value="form.name" :placeholder="t('merchant.name_placeholder')" />
            <div v-if="isEdit" class="switch-line">
              <span>{{ t('payment.channel_enabled') }}</span>
              <n-switch v-model:value="form.status" checked-value="enabled" unchecked-value="disabled" />
            </div>
          </div>

          <div class="form-section grid">
            <h3>{{ t('merchant.type') }}</h3>
            <n-radio-group v-model:value="form.type" size="small">
              <n-radio-button
                v-for="item in typeOptions"
                :key="item.value"
                :value="item.value"
              >
                {{ item.label }}
              </n-radio-button>
            </n-radio-group>
            <p class="muted">{{ typeDescription }}</p>
          </div>

          <div class="form-section grid">
            <h3>{{ t('merchant.callback') }}</h3>
            <n-input v-model:value="form.callback" placeholder="https://merchant.example.com/callback" />
            <p class="muted merchant-doc-help">
              <span>{{ t('merchant.callback_help') }}</span>
              <a class="text-link" href="/docs/merchant-api" target="_blank" rel="noreferrer">{{ t('merchant.docs') }}</a>
            </p>
          </div>

          <div v-if="isEdit" class="form-section grid">
            <div class="credential-title-row">
              <h3>{{ t('merchant.credentials') }}</h3>
              <n-button :loading="loading" secondary size="small" type="warning" @click="resetCredential">{{ t('common.reset') }}</n-button>
            </div>
            <div class="credential-grid credential-grid-single">
              <div v-if="current" class="credential-field">
                <span>{{ t('merchant.id') }}</span>
                <div class="detail-copy-row">
                  <strong>{{ current.id }}</strong>
                  <n-button secondary size="small" @click="copyText(current.id, { message })">{{ t('common.copy') }}</n-button>
                </div>
              </div>
              <div v-if="current" class="form-field-block">
                <span class="field-label">
                  {{ currentMode === 'rsa' ? t('merchant.public_key') : t('merchant.secret_key') }}
                </span>
                <n-input
                  :value="current.authKey || ''"
                  :input-props="{ style: { overflowWrap: 'normal', whiteSpace: 'pre' }, wrap: 'off' }"
                  readonly
                  :type="currentMode === 'rsa' ? 'textarea' : 'text'"
                  :autosize="currentMode === 'rsa' ? { minRows: 5, maxRows: 10 } : undefined"
                />
              </div>
            </div>
          </div>
        </div>

        <template #footer>
          <div class="modal-actions">
            <n-button v-if="isEdit && current" secondary type="error" @click="remove(current.id)">{{ t('merchant.delete') }}</n-button>
            <span class="modal-actions-spacer"></span>
            <n-button secondary @click="formOpen = false">{{ t('common.cancel') }}</n-button>
            <n-button :loading="loading" type="primary" @click="save">{{ isEdit ? t('common.save') : t('common.add') }}</n-button>
          </div>
        </template>
      </n-card>
    </n-modal>

    <n-modal v-model:show="credentialOpen">
      <n-card
        :title="t('merchant.credentials')"
        closable
        class="payment-modal-card"
        role="dialog"
        aria-modal="true"
        @close="credentialOpen = false"
      >
        <div class="payment-modal-body grid">
          <div class="credential-field">
            <span>{{ t('merchant.id') }}</span>
            <strong>{{ credential?.merchantId }}</strong>
          </div>
          <div class="form-field-block">
            <div class="credential-title-row">
              <span class="field-label">
                {{ credential?.mode === 'rsa' ? t('merchant.private_key') : t('merchant.secret_key') }}
              </span>
            </div>
            <n-input
              :value="credential?.key || ''"
              readonly
              :type="credential?.mode === 'rsa' ? 'textarea' : 'text'"
              :autosize="credential?.mode === 'rsa' ? { minRows: 8, maxRows: 14 } : undefined"
            />
          </div>
        </div>

        <template #footer>
          <div class="modal-actions">
            <n-button secondary @click="credentialOpen = false">{{ t('common.close') }}</n-button>
            <n-button type="primary" @click="copyText(credential?.key || '', { message })">
              {{ t('common.copy') }}
            </n-button>
          </div>
        </template>
      </n-card>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useMessage } from "naive-ui";
import DomainInput from "@/app/components/DomainInput.vue";
import { api, type Settings } from "@/app/api";
import { useI18n } from "@/app/i18n";
import { title } from "@/app/site";
import { isDomain, toDomain, toSiteUrl } from "@/shared/domain";
import { formatTime } from "@/app/utils/format";

const message = useMessage();
const { t } = useI18n();
const currencies = computed(() => [
  { label: t("currency.cny"), value: "CNY" },
  { label: t("currency.usd"), value: "USD" },
  { label: t("currency.eur"), value: "EUR" },
  { label: t("currency.gbp"), value: "GBP" },
  { label: t("currency.twd"), value: "TWD" },
]);

const bannerRules = {
  maxBytes: 10 * 1024 * 1024,
  maxDimensionSum: 10000,
  maxRatio: 20,
  minHeight: 300,
  minWidth: 600,
};

const settings = ref<Settings>({} as Settings);
const bannerUploading = ref(false);
const bannerRestoring = ref(false);
const bannerVersion = ref(Date.now());
const botModalOpen = ref(false);
const botRebinding = ref(false);

const bannerSrc = computed(() => `/banner.webp?v=${bannerVersion.value}`);
const domainError = computed(() => settings.value.domain && !isDomain(settings.value.domain) ? t("setup.domain_invalid") : "");
const siteUrl = computed(() => settings.value.domain ? toSiteUrl(settings.value.domain) : "");
const usdtRate = computed(() => {
  const marketRate = marketUSDT(settings.value.currency || "CNY");
  return {
    effectiveRate: marketRate ? marketRate * (1 + Number(settings.value.rateAdjust || 0) / 100) : 0,
    marketRate,
  };
});

async function load() {
  settings.value = await api.settings.get();
  settings.value.domain = toDomain(settings.value.domain);
  title.value = settings.value.title;
  bannerVersion.value = Date.now();
}

async function save() {
  if (!isDomain(settings.value.domain)) {
    message.error(t("setup.domain_invalid"));
    return;
  }
  const saved = await api.settings.save({
    currency: settings.value.currency,
    domain: siteUrl.value,
    fastConfirm: settings.value.fastConfirm,
    rateAdjust: settings.value.rateAdjust,
    title: settings.value.title,
    timeout: settings.value.timeout,
  });
  settings.value = saved;
  settings.value.domain = toDomain(settings.value.domain);
  title.value = saved.title;
  message.success(t("settings.saved"));
}

async function rebindBot() {
  botRebinding.value = true;
  try {
    const bot = await api.settings.rebindBot();
    settings.value.botUsername = bot.username;
    botModalOpen.value = false;
    message.success(t("settings.bot_rebound"));
  } finally {
    botRebinding.value = false;
  }
}

function rateText(value?: number) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "--";
  if (amount >= 1000) return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (amount >= 1) return amount.toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 });
  return amount.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 4 });
}

function marketUSDT(currency: string) {
  const code = currency.trim().toUpperCase();
  if (code === "USD") return 1;
  return settings.value.marketRates?.fiatPerUSD?.[code] || 0;
}

async function uploadBanner(options: { file: { file?: File | null }; onError?: () => void; onFinish?: () => void }) {
  const file = options.file.file;
  if (!file) return;
  let image: Blob;
  try {
    image = await toWebp(file);
  } catch (error) {
    message.error(error instanceof Error ? error.message : t("settings.banner_upload_failed"));
    options.onError?.();
    return;
  }

  bannerUploading.value = true;
  try {
    await api.banner.upload(await image.arrayBuffer());
    message.success(t("settings.banner_saved"));
    bannerVersion.value = Date.now();
    options.onFinish?.();
  } catch {
    options.onError?.();
  } finally {
    bannerUploading.value = false;
  }
}

async function restoreBanner() {
  bannerRestoring.value = true;
  try {
    await api.banner.restore();
    bannerVersion.value = Date.now();
    message.success(t("settings.banner_restored"));
  } finally {
    bannerRestoring.value = false;
  }
}

async function toWebp(file: File) {
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  const ratio = Math.max(width / height, height / width);
  if (width < bannerRules.minWidth || height < bannerRules.minHeight) {
    bitmap.close();
    throw new Error(t("settings.banner_min_size", { height: bannerRules.minHeight, width: bannerRules.minWidth }));
  }
  if (width + height > bannerRules.maxDimensionSum || ratio > bannerRules.maxRatio) {
    bitmap.close();
    throw new Error(t("settings.banner_invalid_size"));
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("settings.banner_process_failed"));
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error(t("settings.banner_convert_failed"));
  if (blob.size > bannerRules.maxBytes) throw new Error(t("settings.banner_too_large"));
  return blob;
}

onMounted(load);
</script>

<template>
  <div class="grid">
    <div class="section-title">
      <h2>{{ t('settings.title') }}</h2>
      <n-button type="primary" @click="save">{{ t('settings.save') }}</n-button>
    </div>
    <div class="panel grid">
      <div class="section-title"><h2>{{ t('settings.site') }}</h2></div>
      <div class="form-grid two">
        <label class="field-stack">
          <span>{{ t('settings.site_title') }}</span>
          <n-input v-model:value="settings.title" />
        </label>
        <label class="field-stack">
          <span>{{ t('settings.domain') }}</span>
          <DomainInput v-model="settings.domain" />
          <small v-if="domainError" class="muted is-error">{{ domainError }}</small>
        </label>
        <div class="field-stack">
          <span>{{ t('settings.bot') }}</span>
          <n-input :value="settings.botUsername ? `@${settings.botUsername}` : ''" readonly>
            <template #suffix>
              <n-button size="small" text type="primary" @click="botModalOpen = true">{{ t('settings.bot_update') }}</n-button>
            </template>
          </n-input>
        </div>
      </div>
    </div>
    <div class="panel grid">
      <div class="section-title"><h2>{{ t('settings.currency') }}</h2></div>
      <div class="form-grid two">
        <label class="field-stack">
          <span>{{ t('settings.base_currency') }}</span>
          <n-select v-model:value="settings.currency" :options="currencies" />
          <small>{{ t('settings.base_currency_help') }}</small>
        </label>
        <label class="field-stack">
          <span>{{ t('settings.rate_adjust') }}</span>
          <n-input-number v-model:value="settings.rateAdjust" :max="200" :min="-99" :placeholder="t('settings.rate_adjust_placeholder')" :step="0.1">
            <template #suffix>%</template>
          </n-input-number>
          <small>{{ t('settings.rate_adjust_help') }}</small>
        </label>
      </div>
      <div class="rate-preview-box">
        <div>
          <span class="muted">{{ t('settings.rate_preview') }}</span>
          <strong>{{ rateText(usdtRate?.effectiveRate) }} {{ settings.currency || 'CNY' }} ≈ 1 USDT</strong>
        </div>
        <p v-if="Number(settings.rateAdjust)" class="muted">
          {{ t('settings.original_rate', { rate: rateText(usdtRate?.marketRate), currency: settings.currency || 'CNY' }) }}
        </p>
        <p class="muted">
          {{ t('settings.rate_updated_at', { time: formatTime(settings.marketRates?.syncedAt) }) }}
        </p>
        <p v-if="settings.marketRates?.messageKey" class="muted">{{ t(settings.marketRates.messageKey) }}</p>
      </div>
    </div>
    <div class="panel grid">
      <div class="section-title"><h2>{{ t('settings.monitor') }}</h2></div>
      <n-form class="settings-form" label-placement="top" :model="settings" :show-require-mark="false">
        <n-grid cols="1 m:2" responsive="screen" :x-gap="12" :y-gap="12">
          <n-form-item-gi :label="t('settings.timeout')" path="timeout" :show-feedback="false">
            <div class="setting-form-control">
              <n-input-number v-model:value="settings.timeout" :max="30" :min="1" placeholder="5">
                <template #suffix>{{ t('settings.minutes') }}</template>
              </n-input-number>
              <small>{{ t('settings.timeout_help') }}</small>
            </div>
          </n-form-item-gi>
          <n-form-item-gi :label="t('settings.fast_confirm')" path="fastConfirm" :show-feedback="false">
            <div class="setting-form-control">
              <div class="setting-switch-control">
                <n-switch v-model:value="settings.fastConfirm" />
              </div>
              <small>{{ t('settings.fast_confirm_help') }}</small>
            </div>
          </n-form-item-gi>
        </n-grid>
      </n-form>
    </div>
    <div class="panel grid">
      <div class="section-title"><h2>Banner</h2></div>
      <n-upload accept="image/*" :custom-request="uploadBanner" :max="1" :show-file-list="false">
        <div class="banner-upload-frame">
          <img class="banner-preview" :src="bannerSrc" alt="HashPay banner" />
          <div class="banner-upload-overlay">
            <n-button :loading="bannerUploading" type="primary">{{ bannerUploading ? t('settings.banner_uploading') : t('common.upload') }}</n-button>
            <span>{{ t('settings.banner_drop') }}</span>
          </div>
        </div>
      </n-upload>
      <p class="banner-guideline">{{ t('settings.banner_guideline') }}</p>
      <div class="form-actions">
        <n-button :loading="bannerRestoring" secondary @click="restoreBanner">{{ t('settings.banner_restore') }}</n-button>
      </div>
    </div>

    <n-modal v-model:show="botModalOpen">
      <n-card
        :bordered="false"
        :title="t('settings.bot_rebind_title')"
        class="payment-modal-card"
        role="dialog"
        aria-modal="true"
      >
        <div class="payment-modal-body grid">
          <p class="muted">{{ t('settings.bot_rebind_help') }}</p>
          <p class="muted">{{ t('settings.bot_rebind_after') }}</p>
          <p class="muted">{{ t('settings.bot_rebind_when') }}</p>
          <div class="modal-actions">
            <n-button @click="botModalOpen = false">{{ t('common.cancel') }}</n-button>
            <span class="modal-actions-spacer"></span>
            <n-button :loading="botRebinding" type="primary" @click="rebindBot">{{ t('settings.bot_rebind') }}</n-button>
          </div>
        </div>
      </n-card>
    </n-modal>
  </div>
</template>

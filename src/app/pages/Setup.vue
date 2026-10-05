<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import AppIcon from "@/app/components/AppIcon.vue";
import DomainInput from "@/app/components/DomainInput.vue";
import LocaleSwitch from "@/app/components/LocaleSwitch.vue";
import { api, type AppState } from "@/app/api";
import { useI18n } from "@/app/i18n";
import { isDomain, toDomain } from "@/shared/domain";

type Loading = "" | "status" | "setup";

const router = useRouter();
const { t } = useI18n();
const status = ref<Partial<AppState> | null>(null);
const domain = ref("");
const submittedDomain = ref("");
const loading = ref<Loading>("");
const polling = ref(false);
const complete = ref(false);
let pollTimer: ReturnType<typeof setInterval> | undefined;

const loaded = computed(() => Boolean(status.value));
const botReady = computed(() => ["admin", "domain", "ready"].includes(String(status.value?.bot)));
const canSetup = computed(() => botReady.value && !status.value?.db && !status.value?.queue);
const setupUrl = computed(() => domain.value ? `https://${domain.value}` : "");
const domainError = computed(() => domain.value && !isDomain(domain.value) ? t("setup.domain_invalid") : "");
const setupStarted = computed(() => Boolean(submittedDomain.value && submittedDomain.value === domain.value));
const botLink = computed(() => status.value?.username ? `https://t.me/${status.value.username}?start=start` : "");
const checks = computed(() => [
  {
    detail: botDetail(),
    label: "Telegram Bot Token",
    ready: botReady.value,
  },
  {
    detail: status.value?.db || t("setup.database_ready"),
    label: t("setup.database"),
    ready: !status.value?.db,
  },
  {
    detail: status.value?.queue || t("setup.queue_ready"),
    label: t("setup.queue"),
    ready: !status.value?.queue,
  },
]);

function botDetail() {
  if (botReady.value) return t("setup.bot_ready", { bot: status.value?.username || "" });
  if (status.value?.bot === "invalid") return t("setup.bot_invalid");
  return t("setup.bot_missing");
}

async function load() {
  loading.value = "status";
  try {
    const next = await api.silent.state.get();
    if (next.ready) {
      status.value = next;
      domain.value = toDomain(next.domain || location.hostname);
      complete.value = true;
      return;
    }
    status.value = next;
    domain.value = toDomain(next.domain || location.hostname);
    if (next.domain) {
      submittedDomain.value = domain.value;
      startPolling();
    }
  } catch (error) {
    status.value = {
      bot: "invalid",
      db: error instanceof Error ? error.message : t("setup.check_failed"),
      domain: null,
      queue: t("setup.queue_unavailable"),
      ready: false,
      username: "",
    };
  } finally {
    loading.value = "";
  }
}

async function submitSetup() {
  if (complete.value || !canSetup.value || loading.value === "setup" || !isDomain(domain.value) || setupStarted.value) return;
  loading.value = "setup";
  try {
    await api.setup.submit(setupUrl.value);
    submittedDomain.value = domain.value;
    startPolling();
  } catch {
    // API layer displays the error.
  } finally {
    loading.value = "";
  }
}

function updateDomain(value: string) {
  domain.value = toDomain(value);
  submittedDomain.value = "";
  complete.value = false;
  stopPolling();
}

function startPolling() {
  if (pollTimer) return;
  polling.value = true;
  void checkReady();
  pollTimer = setInterval(checkReady, 2500);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = undefined;
  polling.value = false;
}

async function checkReady() {
  try {
    const next = await api.silent.state.get();
    status.value = next;
    if (!next.ready) return;
    complete.value = true;
    stopPolling();
  } catch {
    stopPolling();
  }
}

onMounted(load);
watch([domain, canSetup], () => { void submitSetup(); });
onBeforeUnmount(() => {
  stopPolling();
});
</script>

<template>
  <main class="setup-shell">
    <section class="setup-panel">
      <div class="setup-logo">
        <AppIcon name="icon-hashpay" />
      </div>
      <div class="section-title">
        <h1>{{ complete ? t('setup.done') : t('setup.welcome') }}</h1>
      </div>
      <div v-if="complete" class="grid">
        <div class="setup-done">
          <p>{{ t('setup.done_intro') }}</p>
          <ul class="setup-done__ways">
            <li>
              <span class="setup-done__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M21.5 3.5 2.5 11l8 3 3 8 8-18.5Z" />
                  <path d="m10.5 14 4-4" />
                </svg>
              </span>
              <span>{{ t('setup.done_bot', { bot: status?.username || '' }) }}</span>
            </li>
            <li>
              <span class="setup-done__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M3 9h18" />
                  <path d="M7 7h.01" />
                  <path d="M10 7h.01" />
                </svg>
              </span>
              <span>{{ t('setup.done_browser') }}</span>
            </li>
          </ul>
          <p>{{ t('setup.done_channel') }}</p>
        </div>
        <n-button type="primary" @click="router.push('/admin/overview')">{{ t('setup.enter_admin') }}</n-button>
      </div>
      <div v-else class="grid">
        <div v-if="!loaded" class="setup-checks">
          <div v-for="item in 3" :key="item" class="setup-check setup-check--skeleton">
            <span class="setup-check__dot"></span>
            <div>
              <span class="skeleton-line skeleton-title"></span>
              <span class="skeleton-line skeleton-text"></span>
            </div>
          </div>
        </div>
        <div v-else-if="!canSetup" class="setup-checks">
          <div v-for="check in checks" :key="check.label" class="setup-check" :class="{ 'is-ready': check.ready }">
            <span class="setup-check__dot"></span>
            <div>
              <strong>{{ check.label }}</strong>
              <p>{{ check.detail }}</p>
            </div>
          </div>
        </div>
        <n-button v-if="loaded && !canSetup" :loading="loading === 'status'" type="primary" @click="load">{{ t('setup.recheck') }}</n-button>
        <template v-if="canSetup">
          <div class="setup-steps">
            <div class="setup-step">
              <span class="setup-step__index">1</span>
              <div>
                <strong>{{ t('setup.bind_bot', { bot: status?.username || '' }) }}</strong>
              </div>
            </div>
            <div class="setup-step">
              <span class="setup-step__index">2</span>
              <div>
                <strong>{{ t('setup.domain') }}</strong>
                <DomainInput :model-value="domain" :disabled="loading === 'setup'" @update:model-value="updateDomain" />
                <p v-if="domainError" class="muted is-error">{{ domainError }}</p>
                <p v-else-if="loading === 'setup'" class="muted">{{ t('setup.domain_configuring') }}</p>
              </div>
            </div>
            <div class="setup-step">
              <span class="setup-step__index">3</span>
              <div>
                <strong>{{ t('setup.admin') }}</strong>
                <p v-if="!setupStarted" class="muted">{{ t('setup.admin_need_domain') }}</p>
                <template v-else>
                  <a :href="botLink" target="_blank" rel="noreferrer">
                    <n-button type="primary">{{ t('setup.open_bot') }}</n-button>
                  </a>
                  <p class="muted">{{ polling ? t('setup.admin_send', { bot: status?.username || '' }) : t('setup.admin_waiting') }}</p>
                </template>
              </div>
            </div>
          </div>
        </template>
      </div>
      <div class="setup-locale">
        <LocaleSwitch />
      </div>
    </section>
  </main>
</template>

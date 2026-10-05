<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { MenuOption } from "naive-ui";
import { useRoute, useRouter } from "vue-router";
import LocaleSwitch from "@/app/components/LocaleSwitch.vue";
import LoginPanel from "@/app/components/LoginPanel.vue";
import PageSkeleton from "@/app/components/PageSkeleton.vue";
import Help from "@/app/pages/Help.vue";
import Merchants from "@/app/pages/Merchants.vue";
import Orders from "@/app/pages/Orders.vue";
import Overview from "@/app/pages/Overview.vue";
import Payments from "@/app/pages/Payments.vue";
import Settings from "@/app/pages/Settings.vue";
import { api, type AppState, type TelegramUser } from "@/app/api";
import { useI18n } from "@/app/i18n";
import { title } from "@/app/site";
import { isTelegramMiniApp, loginWithTelegram, logoutSession, readSession } from "@/app/utils/session-login";

const route = useRoute();
const router = useRouter();
const version = __GIT_SHORT_HASH__;
const miniApp = isTelegramMiniApp();
const { t } = useI18n();

const pages = [
  { component: Overview, key: "overview", label: "nav.overview" },
  { component: Orders, key: "orders", label: "nav.orders" },
  { component: Payments, key: "payments", label: "nav.payment" },
  { component: Merchants, key: "merchants", label: "nav.merchants" },
  { component: Help, key: "help", label: "nav.help" },
  { component: Settings, key: "settings", label: "nav.settings" },
] as const;

type PageKey = (typeof pages)[number]["key"];

const menu = computed(() => pages.map(({ key, label }) => ({ key, label: t(label) })) satisfies MenuOption[]);
const pageKey = computed(() => route.path.split("/")[2] as PageKey);
const page = computed(() => pages.find((item) => item.key === pageKey.value)!.component);

const loading = ref(true);
const navOpen = ref(false);
const status = ref<AppState | null>(null);
const user = ref<TelegramUser | null>(null);
const username = computed(() => status.value?.username || "");
const pageProps = computed(() => pageKey.value === "help" ? { username: username.value } : {});

async function init() {
  loading.value = true;
  status.value = await api.state.get();
  title.value = status.value.title;
  if (!status.value.ready) {
    await router.replace("/setup");
    return;
  }

  user.value = (await readSession()) ?? (await loginWithTelegram());
  loading.value = false;
}

async function signOut() {
  await logoutSession();
  await init();
}

function openPage(key: string | number) {
  navOpen.value = false;
  void router.push(`/admin/${String(key)}`);
}

onMounted(init);
</script>

<template>
  <n-layout class="shell">
    <n-layout-header class="topbar">
      <div class="topbar-brand">
        <n-button v-if="user" circle quaternary size="small" class="mobile-menu-button" :title="t('nav.open_menu')" @click="navOpen = true">
          <template #icon>
            <span class="hamburger-icon" aria-hidden="true"></span>
          </template>
        </n-button>
        <div class="brand">{{ title }}</div>
      </div>
      <div v-if="user && !miniApp" class="topbar-actions">
        <LocaleSwitch />
        <n-button size="small" secondary @click="signOut">{{ t('nav.logout') }}</n-button>
      </div>
    </n-layout-header>
    <n-layout-content v-if="loading" class="page-layout" content-class="page">
      <PageSkeleton :sections="3" :rows="3" />
    </n-layout-content>
    <n-layout-content v-else-if="!user" class="page-layout" content-class="page">
      <LoginPanel :username="username" @authenticated="init" />
    </n-layout-content>
    <n-layout-content v-else class="workspace-layout" content-class="workspace-page">
      <n-drawer v-model:show="navOpen" placement="left" :width="260">
        <n-drawer-content closable :title="title">
          <div class="workspace-nav workspace-nav--drawer">
            <n-menu :options="menu" :value="pageKey" @update:value="openPage" />
            <div class="workspace-release">
              <span>Version {{ version }}</span>
              <span>Made with ❤️ by TGDash Team</span>
            </div>
          </div>
        </n-drawer-content>
      </n-drawer>
      <n-layout has-sider class="workspace-frame">
        <n-layout-sider bordered :width="210">
          <div class="workspace-nav">
            <n-menu :options="menu" :value="pageKey" @update:value="openPage" />
            <div class="workspace-release">
              <span>Version {{ version }}</span>
              <span>Made with ❤️ by TGDash Team</span>
            </div>
          </div>
        </n-layout-sider>
        <n-layout-content class="workspace-content">
          <component :is="page" v-bind="pageProps" />
        </n-layout-content>
      </n-layout>
    </n-layout-content>
  </n-layout>
</template>

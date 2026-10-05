<script setup lang="ts">
import { computed } from "vue";
import { useMessage } from "naive-ui";
import { useI18n } from "@/app/i18n";
import { useSessionLogin } from "@/app/utils/session-login";

const props = defineProps<{
  username: string;
}>();

const emit = defineEmits<{
  authenticated: [];
}>();

const message = useMessage();
const { t } = useI18n();
const botUrl = computed(() => `https://t.me/${props.username}?start=hashpay`);
const { command, copyCommand, status } = useSessionLogin({
  message,
  onAuthenticated: () => emit("authenticated"),
});
</script>

<template>
  <section class="panel grid login-panel">
    <div class="section-title"><h2>{{ t('login.title') }}</h2></div>
    <div class="grid">
      <p class="muted">
        {{ t('login.in_bot') }}
        <a class="text-link" :href="botUrl" target="_blank" rel="noreferrer">@{{ username }}</a>
        {{ t('login.send_command') }}
      </p>
      <div ref="commandWrap">
        <n-input-group>
          <n-input v-model:value="command" readonly />
          <n-button :disabled="!command" type="primary" @click="copyCommand">{{ t('common.copy') }}</n-button>
        </n-input-group>
      </div>
      <p class="muted">{{ status }}</p>
      <div class="login-divider"><span>{{ t('login.or') }}</span></div>
      <div class="grid">
        <p class="muted">{{ t('login.use_admin') }}</p>
        <a :href="botUrl" target="_blank" rel="noreferrer">
          <n-button block secondary type="primary">{{ t('login.open_miniapp') }}</n-button>
        </a>
      </div>
    </div>
  </section>
</template>

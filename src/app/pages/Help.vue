<script setup lang="ts">
import { computed } from "vue";
import { useMessage } from "naive-ui";
import { useRoute } from "vue-router";
import { useI18n } from "@/app/i18n";
import { copyText } from "@/app/utils/clipboard";

const props = defineProps<{
  username: string;
}>();

const message = useMessage();
const { t } = useI18n();
const route = useRoute();
const telegram = computed(() => route.params.topic === "telegram");
const bot = computed(() => `@${props.username}`);
</script>

<template>
  <div class="grid">
    <div class="section-title">
      <h2>{{ t('help.title') }}</h2>
    </div>

    <n-list v-if="!telegram" bordered class="help-list">
      <n-list-item>
        <router-link to="/admin/help/telegram">
          <n-thing :title="t('help.telegram.title')" :description="t('help.telegram.summary')" />
        </router-link>
      </n-list-item>
    </n-list>

    <article v-else class="help-article grid">
      <header>
        <h2>{{ t('help.telegram.title') }}</h2>
        <p>{{ t('help.telegram.summary') }}</p>
      </header>

      <section class="help-section grid">
        <h3>{{ t('help.telegram.inline_title') }}</h3>
        <p>{{ t('help.telegram.inline_intro', { bot }) }}</p>
        <div class="bot-chat">
          <a class="bot-chat-name" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>
          <button class="bot-bubble" type="button" @click="copyText('/setinline', { message })"><code>/setinline</code></button>
          <p>{{ t('help.telegram.choose_bot', { bot }) }}</p>
          <div class="bot-bubble bot-reply">{{ t('help.telegram.inline_reply', { bot }) }}</div>
          <p>{{ t('help.telegram.placeholder_intro') }}</p>
          <button class="bot-bubble" type="button" @click="copyText('1', { message })">1</button>
          <div class="bot-bubble bot-reply">{{ t('help.telegram.inline_success') }}</div>
        </div>
      </section>

      <section class="help-section grid">
        <h3>{{ t('help.telegram.feedback_title') }}</h3>
        <p>{{ t('help.telegram.feedback_intro', { bot }) }}</p>
        <div class="bot-chat">
          <a class="bot-chat-name" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>
          <button class="bot-bubble" type="button" @click="copyText('/setinlinefeedback', { message })"><code>/setinlinefeedback</code></button>
          <p>{{ t('help.telegram.choose_bot', { bot }) }}</p>
          <div class="bot-bubble bot-reply">{{ t('help.telegram.feedback_reply', { bot }) }}</div>
          <p>{{ t('help.telegram.feedback_enable') }}</p>
          <button class="bot-bubble" type="button" @click="copyText('Enable', { message })">Enable</button>
          <div class="bot-bubble bot-reply">{{ t('help.telegram.feedback_success') }}</div>
        </div>
      </section>

      <section class="help-section grid">
        <h3>{{ t('help.telegram.use_title') }}</h3>
        <p>{{ t('help.telegram.use_intro') }}</p>
        <n-input :value="`${bot} 10`" readonly />
      </section>
    </article>
  </div>
</template>

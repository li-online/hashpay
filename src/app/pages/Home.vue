<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import PageSkeleton from "@/app/components/PageSkeleton.vue";
import { api } from "@/app/api";

const router = useRouter();

onMounted(async () => {
  const state = await api.silent.state.get().catch(() => ({ ready: false }));
  await router.replace(state.ready ? "/admin/overview" : "/setup");
});
</script>

<template>
  <div class="page">
    <PageSkeleton :sections="2" :rows="3" />
  </div>
</template>

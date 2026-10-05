<script setup lang="ts">
withDefaults(defineProps<{
  rows?: number;
  sections?: number;
}>(), {
  rows: 3,
  sections: 2,
});
</script>

<template>
  <section class="panel page-skeleton" aria-busy="true" aria-label="Loading">
    <n-space vertical :size="20">
      <div v-for="section in sections" :key="section" class="page-skeleton__section">
        <n-skeleton text :style="{ width: section % 2 ? '34%' : '26%' }" />
        <n-space vertical :size="10">
          <n-skeleton
            v-for="row in rows"
            :key="row"
            text
            :style="{ width: ['82%', '64%', '74%', '48%'][(section + row - 2) % 4] }"
          />
        </n-space>
      </div>
    </n-space>
  </section>
</template>

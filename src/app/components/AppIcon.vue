<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  label?: string;
  name: string;
}>(), {
  label: "",
});

const href = computed(() => `/icons.svg#${props.name}`);
</script>

<template>
  <svg :aria-hidden="label ? undefined : 'true'" :aria-label="label || undefined" role="img">
    <use :href="href" />
  </svg>
</template>

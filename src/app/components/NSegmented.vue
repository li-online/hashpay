<script setup lang="ts">
type SegmentedValue = string | number | boolean;

defineOptions({
  name: "NSegmented",
});

defineProps<{
  options: ReadonlyArray<{
    label: string;
    value: SegmentedValue;
  }>;
  size?: "small" | "medium" | "large";
  value: SegmentedValue;
}>();

defineEmits<{
  "update:value": [value: SegmentedValue];
}>();
</script>

<template>
  <n-radio-group
    class="n-segmented"
    :value="value"
    :size="size ?? 'medium'"
    @update:value="$emit('update:value', $event)"
  >
    <n-radio-button
      v-for="item in options"
      :key="String(item.value)"
      :value="item.value"
    >
      {{ item.label }}
    </n-radio-button>
  </n-radio-group>
</template>

<style scoped>
.n-segmented {
  --segmented-radius: 0.5rem;
  --segmented-divider-color: #e5e7eb;
  --segmented-divider-color-active: var(--n-button-border-color-active);
  --n-button-border-radius: var(--segmented-radius);

  align-items: center;
  display: flex;
  flex-wrap: wrap;
  max-width: 100%;
  min-width: 0;
  row-gap: 0.375rem;
}

.n-segmented.n-radio-group--button-group {
  height: auto !important;
  line-height: normal !important;
  white-space: normal !important;
}

.n-segmented :deep(.n-radio-group__splitor) {
  background: var(--segmented-divider-color);
  height: var(--n-height) !important;
  margin: 0;
}

.n-segmented :deep(.n-radio-button--checked + .n-radio-group__splitor),
.n-segmented :deep(.n-radio-group__splitor:has(+ .n-radio-button--checked)) {
  background: var(--segmented-divider-color-active);
}

.n-segmented :deep(.n-radio-button:first-child),
.n-segmented :deep(.n-radio-button:first-child .n-radio-button__state-border) {
  border-bottom-left-radius: var(--segmented-radius) !important;
  border-top-left-radius: var(--segmented-radius) !important;
}

.n-segmented :deep(.n-radio-button:last-child),
.n-segmented :deep(.n-radio-button:last-child .n-radio-button__state-border) {
  border-bottom-right-radius: var(--segmented-radius) !important;
  border-top-right-radius: var(--segmented-radius) !important;
}
</style>

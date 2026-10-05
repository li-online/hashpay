<script setup lang="ts">
import { computed } from "vue";
import { toDomain } from "@/shared/domain";

const props = defineProps<{
  disabled?: boolean;
  modelValue?: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const value = computed(() => toDomain(props.modelValue));

function update(value: string) {
  emit("update:modelValue", toDomain(value));
}
</script>

<template>
  <n-input-group>
    <n-input-group-label>https://</n-input-group-label>
    <n-input :disabled="disabled" :placeholder="placeholder || 'hashpay.example.com'" :value="value" @update:value="update" />
  </n-input-group>
</template>

<template>
  <label class="forge-number" :class="{ 'forge-number--suffixed': !!suffix }" :style="{ width }">
    <input
      type="number"
      inputmode="numeric"
      class="forge-field forge-number__input"
      :value="shown"
      :placeholder="placeholder"
      :min="min"
      :max="max"
      :disabled="disabled"
      :aria-label="ariaLabel"
      @change="commit"
    />
    <span v-if="suffix" class="forge-number__suffix" aria-hidden="true">{{ suffix }}</span>
  </label>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: number;
  min?: number;
  max?: number;
  width?: string;
  disabled?: boolean;
  /**
   * Zero means "not set" for this setting: show the field empty, with the
   * placeholder, rather than a bare 0 that reads as a real value.
   */
  emptyWhenZero?: boolean;
  placeholder?: string;
  /** A unit shown inside the field's right edge, e.g. "days", "ms". */
  suffix?: string;
  ariaLabel?: string;
}>(), {
  width: '96px',
  emptyWhenZero: false,
  placeholder: 'Default',
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

const shown = computed(() =>
  props.emptyWhenZero && (!props.modelValue || Number.isNaN(props.modelValue)) ? '' : props.modelValue,
);

function commit(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim();
  let value = raw === '' ? 0 : Number(raw);
  if (Number.isNaN(value)) value = 0;
  if (props.min !== undefined && value !== 0 && value < props.min) value = props.min;
  if (props.max !== undefined && value > props.max) value = props.max;
  emit('update:modelValue', value);
}
</script>

<style scoped>
.forge-number {
  display: inline-flex;
  position: relative;
}

.forge-number__input {
  font-variant-numeric: tabular-nums;
  text-align: right;
  width: 100%;
  -moz-appearance: textfield;
  appearance: textfield;
}

.forge-number--suffixed .forge-number__input {
  padding-right: 42px;
}

.forge-number__input::-webkit-outer-spin-button,
.forge-number__input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  appearance: none;
  margin: 0;
}

.forge-number__suffix {
  color: var(--forge-field-placeholder);
  font-size: 11px;
  pointer-events: none;
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
}
</style>

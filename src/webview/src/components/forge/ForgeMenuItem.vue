<template>
  <!--
    A Claude Code menu row: leading icon, label over description, trailing check.
    The check occupies its cell whether or not the row is selected, so selecting
    a different row never shifts the column.
  -->
  <button
    type="button"
    role="menuitemradio"
    :aria-checked="selected"
    class="fg-menu__menuItemV2"
    :class="{ 'fg-menu__menuItemSelected': selected }"
    @click="$emit('select')"
  >
    <span v-if="$slots.icon" class="fg-menu__menuItemIcon"><slot name="icon" /></span>
    <span class="fg-menu__menuItemText">
      <span class="fg-menu__menuItemLabel">{{ label }}</span>
      <span v-if="description" class="fg-menu__menuItemDescription">{{ description }}</span>
    </span>
    <span class="fg-menu__menuItemCheckRight">
      <svg v-if="selected" viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
        <path
          d="M3.5 8.5l3 3 6-7"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  </button>
</template>

<script setup lang="ts">
interface Props {
  label: string;
  description?: string;
  selected?: boolean;
}

withDefaults(defineProps<Props>(), { selected: false });
defineEmits<{ (e: 'select'): void }>();
</script>

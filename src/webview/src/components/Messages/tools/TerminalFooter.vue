<template>
  <!-- The terminal footer: status badges, line count, expand / collapse, open in an editor tab. -->
  <div class="fterm-footer">
    <slot />
    <span>{{ lineCount }} line{{ lineCount === 1 ? '' : 's' }}</span>
    <span class="fterm-spacer" />
    <button v-if="canCollapse" type="button" class="fterm-action" :aria-expanded="expanded" @click="$emit('toggle')">
      {{ toggleLabel }}
    </button>
    <button
      v-if="openable"
      type="button"
      class="fterm-action"
      :title="openLabel"
      :aria-label="openLabel"
      @click="$emit('open')"
    >
      <span class="codicon codicon-go-to-file" aria-hidden="true" />
    </button>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    lineCount: number;
    canCollapse?: boolean;
    expanded?: boolean;
    toggleLabel?: string;
    openable?: boolean;
    openLabel?: string;
  }>(),
  { canCollapse: false, expanded: false, toggleLabel: '', openable: false, openLabel: 'Open in an editor tab' }
);

defineEmits<{ toggle: []; open: [] }>();
</script>

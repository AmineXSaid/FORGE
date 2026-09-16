<template>
  <!-- The official on/off switch (reference `Xj`, module 0c4GDA). Display only: the row it sits in is the button. -->
  <div class="fg-toggle__toggle">
    <span v-if="label" class="fg-toggle__label">{{ label }}</span>
    <div class="fg-toggle__track" :class="{ 'fg-toggle__trackOn': isOn }">
      <div class="fg-toggle__thumb" :class="{ 'fg-toggle__thumbOn': isOn }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ isOn: boolean; label?: string }>();
</script>

<template>
  <SwitchRoot
    v-bind="forwarded"
    class="solid-switch"
    :class="{ 'solid-switch-small': small }"
    :title="title"
  >
    <SwitchThumb
      class="solid-switch-toggle"
      :class="{ 'solid-switch-toggle-small': small }"
    />
  </SwitchRoot>
</template>

<script setup lang="ts">
import { SwitchRoot, SwitchThumb, useForwardPropsEmits } from 'reka-ui';
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  title?: string
  small?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const forwarded = useForwardPropsEmits(computed(() => ({
  modelValue: props.modelValue,
})), emit)
</script>

<style scoped>
.solid-switch {
    align-items: center;
    box-sizing: border-box;
    display: inline-flex;
    flex-shrink: 0;
    height: 18px;
    position: relative;
    width: 30px;
    cursor: pointer;
    border: none;
    padding: 0;
    background: transparent;
    user-select: none;
}

.solid-switch-small {
    height: 14px;
    width: 24px;
}

.solid-switch-toggle {
    background-color: var(--cursor-bg-primary);
    border-radius: 9px;
    bottom: 0;
    box-sizing: border-box;
    cursor: pointer;
    flex-shrink: 0;
    left: 0;
    position: absolute;
    right: 0;
    top: 0;
    transition: background-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
    display: block;
    width: 100%;
    height: 100%;
}

.solid-switch-toggle-small {
    border-radius: 7px;
}

/*
 * On is the accent, as it is on every other toggle in Forge (the "/" menu's,
 * the effort slider's fill). It used to be the success green, which read as
 * "passed" rather than "enabled" and matched nothing else in the product.
 */
.solid-switch[data-state="checked"] .solid-switch-toggle {
    background-color: var(--forge-accent);
    box-shadow: 0 0 0 1px var(--vscode-contrastBorder);
}

.solid-switch:focus-visible {
    outline: 2px solid var(--forge-focus-ring);
    outline-offset: 2px;
    border-radius: 10px;
}

.solid-switch.solid-switch-on-blue[data-state="checked"] .solid-switch-toggle {
    background-color: var(--vscode-terminal-ansiBlue);
}

.solid-switch-toggle:before {
    background-color: var(--forge-on-accent);
    border-radius: 50%;
    bottom: 2px;
    content: "";
    height: 14px;
    left: 2px;
    position: absolute;
    transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
    width: 14px;
    box-shadow: 0 1px 2px color-mix(in srgb, var(--forge-cube-dark) 30%, transparent);
}

@media (prefers-reduced-motion: reduce) {
    .solid-switch-toggle,
    .solid-switch-toggle:before {
        transition: none;
    }
}

.solid-switch-toggle-small:before {
    bottom: 2px;
    height: 10px;
    left: 2px;
    width: 10px;
}

.solid-switch[data-state="checked"] .solid-switch-toggle:before {
    transform: translateX(12px);
}

.solid-switch[data-state="checked"] .solid-switch-toggle-small:before {
    transform: translateX(10px);
}
</style>

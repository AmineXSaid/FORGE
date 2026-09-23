<template>
  <button
    class="cursor-button"
    :class="[
      `cursor-button-${variant}`,
      size === 'small' ? 'cursor-button-small' : '',
      clickable && !disabled ? `cursor-button-${variant}-clickable` : 'cursor-button-not-clickable',
      { disabled }
    ]"
    :disabled="disabled"
    @click="handleClick"
  >
    <slot name="icon"></slot>
    <slot></slot>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger'
  size?: 'small' | 'medium'
  disabled?: boolean
  clickable?: boolean
}>(), {
  variant: 'primary',
  size: 'medium',
  clickable: true
})

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const handleClick = (event: MouseEvent) => {
  emit('click', event)
}
</script>

<style>
/*
 * Settings buttons. One geometry for every variant -- 28px tall, 6px corners,
 * 12px text at weight 500, 12px of side padding -- so a row of mixed buttons
 * lines up, and one set of states: a colour step on hover, a small give on
 * press, a ring for the keyboard. Primary is the brand fill Forge's composer
 * uses for send; the rest step down from it.
 */
.cursor-button {
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--corner-radius-medium);
    color: var(--vscode-foreground);
    cursor: pointer;
    display: inline-flex;
    flex: none;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    gap: 6px;
    justify-content: center;
    line-height: 16px;
    min-height: 28px;
    padding: 0 12px;
    background: transparent;
    white-space: nowrap;
    transition:
        background-color 140ms cubic-bezier(0.22, 1, 0.36, 1),
        border-color 140ms cubic-bezier(0.22, 1, 0.36, 1),
        box-shadow 140ms cubic-bezier(0.22, 1, 0.36, 1),
        transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
}

.cursor-button .codicon {
    font-size: 14px;
}

.cursor-button-small {
    font-size: 12px;
    min-height: 24px;
    padding: 0 9px;
}

.cursor-button:focus-visible {
    outline: 2px solid var(--forge-focus-ring);
    outline-offset: 2px;
}

.cursor-button:not(.disabled):not(.cursor-button-not-clickable):active {
    transform: scale(0.97);
}

/* Primary: the brand fill, with a hairline of light on its top edge. */
.cursor-button-primary {
    background-color: var(--forge-brand-strong);
    box-shadow:
        inset 0 1px 0 color-mix(in srgb, var(--forge-on-brand) 16%, transparent),
        0 4px 12px -8px var(--forge-brand-strong);
}

.cursor-button-primary, .cursor-button-primary .codicon {
    color: var(--forge-on-brand);
}

.cursor-button-primary-clickable:not(.disabled):hover {
    background-color: color-mix(in srgb, var(--forge-brand-strong) 86%, var(--forge-on-brand));
}

/* Secondary: a quiet surface that still reads as a button. */
.cursor-button-secondary {
    background-color: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
    border-color: var(--app-transparent-inner-border);
    color: var(--cursor-text-primary);
}

.cursor-button-secondary-clickable:not(.disabled):hover {
    background-color: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
}

/* Tertiary: outline only. */
.cursor-button-tertiary {
    border-color: var(--cursor-stroke-primary);
    color: var(--cursor-text-primary);
}

.cursor-button-tertiary-clickable:not(.disabled):hover {
    background-color: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
    border-color: color-mix(in srgb, var(--forge-brand) 45%, var(--cursor-stroke-primary));
}

.cursor-button-danger {
    background-color: var(--forge-danger);
}

.cursor-button-danger, .cursor-button-danger .codicon {
    color: var(--forge-on-brand);
}

.cursor-button-danger-clickable:not(.disabled):hover {
    background-color: color-mix(in srgb, var(--forge-danger) 86%, var(--forge-on-brand));
}

.cursor-button.disabled,
.cursor-button:disabled {
    cursor: not-allowed !important;
    opacity: .5;
}

.cursor-button-not-clickable {
    cursor: default!important
}

.cursor-button-not-clickable:hover {
    background-color: transparent!important
}

.cursor-button.tab-focusable:focus-visible {
    outline: 2px solid var(--forge-focus-ring);
    outline-offset: 2px
}

@media (prefers-reduced-motion: reduce) {
    .cursor-button {
        transition: none;
    }

    .cursor-button:not(.disabled):not(.cursor-button-not-clickable):active {
        transform: none;
    }
}
</style>

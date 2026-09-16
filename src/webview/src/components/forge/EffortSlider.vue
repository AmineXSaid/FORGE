<template>
  <!--
    The official effort slider (reference `ko`, module P1HaRA): a track with a
    fill, one notch per level and a thumb, positioned with the same calc()
    expressions the official computes. Click or drag to pick a level. Without an
    onSelect handler the official renders it as a static <div>.

    The last level, ultracode, takes the official ultracode notch and fill
    colour; while it is selected the fill carries a travelling sheen and the
    thumb pulses a halo.
  -->
  <button
    v-if="interactive"
    type="button"
    class="fg-effortslider__toggle"
    :class="toneClass"
    title="Click or drag to set effort level"
    @mousedown.prevent
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
    @lostpointercapture="onPointerEnd"
    @click.stop
  >
    <div :class="fillClass" :style="{ width: fillWidth }"></div>
    <div
      v-for="(_, i) in count"
      :key="i"
      :class="notchClass(i)"
      :style="{ left: notchLeft(i) }"
    ></div>
    <div class="fg-effortslider__thumb" :style="{ left: thumbLeft }"></div>
  </button>
  <div v-else class="fg-effortslider__toggle" :class="toneClass">
    <div :class="fillClass" :style="{ width: fillWidth }"></div>
    <div v-for="(_, i) in count" :key="i" :class="notchClass(i)" :style="{ left: notchLeft(i) }"></div>
    <div class="fg-effortslider__thumb" :style="{ left: thumbLeft }"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ULTRACODE } from './effort';

interface Props {
  level?: string;
  levels: readonly string[];
  interactive?: boolean;
}
const props = withDefaults(defineProps<Props>(), { interactive: true });
const emit = defineEmits<{ (e: 'select', level: string): void }>();

const count = computed(() => props.levels.length);
const index = computed(() => Math.max(0, props.level ? props.levels.indexOf(props.level) : 0));
const ratio = computed(() => (count.value > 1 ? index.value / (count.value - 1) : 0));
const SPAN = '(100% - var(--thumb-size) - 2 * var(--thumb-inset))';
const thumbLeft = computed(() => `calc(var(--thumb-inset) + ${ratio.value} * ${SPAN})`);
const fillWidth = computed(
  () => `calc(var(--thumb-inset) + ${ratio.value} * ${SPAN} + var(--thumb-size) + var(--thumb-inset))`
);
const ultracodeSelected = computed(() => props.level === ULTRACODE);
/** Heat tint for the track: orange at Extra high, red at Max, ultracode's lightning past it. */
const toneClass = computed(() =>
  props.level === 'xhigh' || props.level === 'max' || props.level === ULTRACODE
    ? `fg-effortslider--${props.level}`
    : undefined
);
const fillClass = computed(() =>
  ultracodeSelected.value ? 'fg-effortslider__fill fg-effortslider__fillUltracode' : 'fg-effortslider__fill'
);
const notchClass = (i: number) =>
  props.levels[i] === ULTRACODE ? 'fg-effortslider__notch fg-effortslider__notchUltracode' : 'fg-effortslider__notch';
const notchLeft = (i: number) =>
  `calc(var(--thumb-inset) + ${count.value > 1 ? i / (count.value - 1) : 0} * ${SPAN} + var(--thumb-size) / 2)`;

let dragging: number | undefined;
function indexAt(event: PointerEvent): number {
  if (count.value <= 1) return 0;
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
  return Math.round(x * (count.value - 1));
}
function pick(i: number): void {
  const level = props.levels[i];
  if (level) emit('select', level);
}
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragging = indexAt(event);
  pick(dragging);
}
function onPointerMove(event: PointerEvent): void {
  if (dragging === undefined) return;
  const i = indexAt(event);
  if (i === dragging) return;
  dragging = i;
  pick(i);
}
function onPointerEnd(): void {
  dragging = undefined;
}
</script>

<style scoped>
/* Effort heat. The keyframes live with the other brand motion in forge-theme.css. */
.fg-effortslider--xhigh .fg-effortslider__fill {
  background: var(--forge-warning);
}

.fg-effortslider--max .fg-effortslider__fill {
  background: var(--forge-danger);
}

/* Ultracode: violet running into pink, a sheen sweeping along it... */
.fg-effortslider--ultracode .fg-effortslider__fillUltracode {
  background-image:
    linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--forge-cube-light) 45%, transparent) 50%, transparent 70%),
    linear-gradient(90deg, var(--app-ultracode-color), var(--forge-ultracode-pink));
  background-size: 250% 100%, 100% 100%;
  animation: fg-ultracode-sheen 1.8s linear infinite;
}

/* ...with pink lightning running along it in long horizontal waves: a bright
   wave travelling forward and a fainter, quicker one against it, both flickering
   the way arcing current does. */
.fg-effortslider--ultracode .fg-effortslider__fillUltracode::before,
.fg-effortslider--ultracode .fg-effortslider__fillUltracode::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: var(--forge-ultracode-bolt);
  -webkit-mask-repeat: repeat-x;
  mask-repeat: repeat-x;
}

.fg-effortslider--ultracode .fg-effortslider__fillUltracode::after {
  -webkit-mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='52' height='18' viewBox='0 0 52 18'><path d='M0 9 C 8 2.5, 18 2.5, 26 9 S 44 15.5, 52 9' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round'/></svg>");
  mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='52' height='18' viewBox='0 0 52 18'><path d='M0 9 C 8 2.5, 18 2.5, 26 9 S 44 15.5, 52 9' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round'/></svg>");
  -webkit-mask-size: 52px 100%;
  mask-size: 52px 100%;
  animation:
    fg-ultracode-wave 1.4s linear infinite,
    fg-ultracode-flicker 2.2s steps(1, end) infinite;
}

.fg-effortslider--ultracode .fg-effortslider__fillUltracode::before {
  -webkit-mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='34' height='18' viewBox='0 0 34 18'><path d='M0 9 C 5 5, 12 5, 17 9 S 29 13, 34 9' fill='none' stroke='currentColor' stroke-width='1' stroke-linecap='round'/></svg>");
  mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='34' height='18' viewBox='0 0 34 18'><path d='M0 9 C 5 5, 12 5, 17 9 S 29 13, 34 9' fill='none' stroke='currentColor' stroke-width='1' stroke-linecap='round'/></svg>");
  -webkit-mask-size: 34px 100%;
  mask-size: 34px 100%;
  opacity: 0.55;
  animation:
    fg-ultracode-wave-back 0.9s linear infinite,
    fg-ultracode-flicker 1.7s steps(1, end) infinite reverse;
}

.fg-effortslider--ultracode .fg-effortslider__thumb {
  animation: fg-ultracode-halo 1.8s ease-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .fg-effortslider--ultracode .fg-effortslider__fillUltracode,
  .fg-effortslider--ultracode .fg-effortslider__thumb {
    animation: none;
  }

  .fg-effortslider--ultracode .fg-effortslider__fillUltracode::before,
  .fg-effortslider--ultracode .fg-effortslider__fillUltracode::after {
    animation: none;
  }
}
</style>

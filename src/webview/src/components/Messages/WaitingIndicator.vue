<template>
  <!--
    The official working indicator: an animated mark, then a verb that types
    itself in. The mark is Forge's cube; the markup and styles are the official
    spinner's (styles/official/spinner.css), permission-mode tint included.
  -->
  <div class="fg-spinner__container" :data-permission-mode="permissionMode">
    <span aria-hidden="true" class="fg-spinner__icon" :style="{ fontSize: `${size}px` }">
      <!-- The cube fills the whole 1.5em glyph box, so its voxels read at a glance. -->
      <ForgeCube :size="size * 1.5" />
    </span>
    <!--
      While the CLI is retrying, the verb gives way to what is actually
      happening. A whimsical word typing itself out is the right register for
      "this is taking a moment" and the wrong one for "your endpoint is not
      answering" -- and the second is what the user was looking at, for minutes,
      with no way to tell the difference. Not animated: it is a fact, not a mood.
    -->
    <span v-if="statusText" class="fg-spinner__text fg-spinner__text--status">{{ statusText }}</span>
    <span v-else aria-hidden="true" class="fg-spinner__text">{{ animatedText }}</span>
    <span class="fg-vh__visuallyHidden">{{ statusText || 'Forge is working' }}</span>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
  import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
  import ForgeCube from '../forge/ForgeCube.vue';
  import { retryStatusText, type ApiRetryState } from '../../core/retryStatus';

  interface Props {
    size?: number;
    permissionMode?: PermissionMode;
    /** The SDK's `system`/`api_retry`, while one is in flight. */
    retry?: ApiRetryState;
  }

  const props = withDefaults(defineProps<Props>(), {
    size: 16,
    permissionMode: undefined,
    retry: undefined,
  });

  /** What to say instead of the verb while the endpoint is not answering. */
  const statusText = computed(() => retryStatusText(props.retry));

  const VERBS = [
    'Accomplishing', 'Actioning', 'Actualizing', 'Baking', 'Booping', 'Brewing',
    'Calculating', 'Cerebrating', 'Channelling', 'Churning', 'Coalescing',
    'Cogitating', 'Computing', 'Combobulating', 'Concocting', 'Considering', 'Contemplating',
    'Cooking', 'Crafting', 'Creating', 'Crunching', 'Deciphering', 'Deliberating',
    'Determining', 'Discombobulating', 'Doing', 'Effecting', 'Elucidating', 'Enchanting',
    'Envisioning', 'Finagling', 'Flibbertigibbeting', 'Forging', 'Forming', 'Frolicking',
    'Generating', 'Germinating', 'Hammering', 'Hatching', 'Herding', 'Honking', 'Ideating',
    'Imagining', 'Incubating', 'Inferring', 'Manifesting', 'Marinating', 'Meandering',
    'Moseying', 'Mulling', 'Mustering', 'Musing', 'Noodling', 'Percolating',
    'Perusing', 'Philosophising', 'Pontificating', 'Pondering', 'Processing', 'Puttering',
    'Puzzling', 'Reticulating', 'Ruminating', 'Scheming', 'Schlepping', 'Shimmying',
    'Simmering', 'Smooshing', 'Spelunking', 'Spinning', 'Stewing', 'Sussing',
    'Synthesizing', 'Thinking', 'Tinkering', 'Transmuting', 'Unfurling', 'Unravelling',
    'Vibing', 'Wandering', 'Whirring', 'Wibbling', 'Working', 'Wrangling'
  ];
  const MAX_VERB_LENGTH = Math.max(...VERBS.map(v => v.length));

  const verb = ref(randomVerb());

  let verbTimer: ReturnType<typeof setTimeout> | undefined;
  let rafId: number | null = null;

  // Text animation state
  const animatedText = ref(' '.repeat(MAX_VERB_LENGTH + 3));
  const animIndex = ref(0);
  const animTarget = ref(
    padTargetText(verb.value + '...', MAX_VERB_LENGTH + 3)
  );
  let lastTick = 0;
  const stepMs = 40;

  onMounted(() => {
    // Change verb after 2s, 3s, 5s, then every 5s -- the official cadence.
    const intervals = [2000, 3000, 5000];
    let count = 0;
    const schedule = () => {
      verb.value = randomVerb();
      const next = count < intervals.length ? intervals[count++] : 5000;
      verbTimer = setTimeout(schedule, next);
    };
    verbTimer = setTimeout(schedule, intervals[0]);

    startTextAnimation(verb.value + '...');
  });

  onBeforeUnmount(() => {
    if (verbTimer) clearTimeout(verbTimer);
    stopTextAnimation();
  });

  function randomVerb(): string {
    return VERBS[Math.floor(Math.random() * VERBS.length)];
  }

  // Restart the text animation whenever the verb changes
  watch(verb, v => {
    startTextAnimation(v + '...');
  });

  function padTargetText(text: string, width: number): string {
    return text.length >= width ? text : text + ' '.repeat(width - text.length);
  }

  function replaceAt(s: string, index: number, ch: string): string {
    if (index < 0 || index >= s.length) return s;
    return s.slice(0, index) + ch + s.slice(index + 1);
  }

  function randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function transformChar(
    currentChar: string,
    targetChar: string,
    phase: number
  ): string {
    if (targetChar === ' ') return ' ';
    switch (phase) {
      case 3:
        return targetChar;
      case 2:
        return randomChoice(['.', '_', targetChar]);
      case 1:
        return randomChoice(['.', '_', targetChar]);
      case 0:
        return '▌';
      default:
        return currentChar;
    }
  }

  function startTextAnimation(text: string) {
    stopTextAnimation();
    animIndex.value = 0;
    lastTick = 0;
    const width = MAX_VERB_LENGTH + 3;
    animTarget.value = padTargetText(text, width);
    if (animatedText.value.length !== width) {
      animatedText.value = ' '.repeat(width);
    }

    const step = (ts: number) => {
      if (!lastTick) lastTick = ts;
      if (ts - lastTick < stepMs) {
        rafId = requestAnimationFrame(step);
        return;
      }
      lastTick = ts;

      const d = animIndex.value;
      // Done once the sweep is three phases past the end of the target
      if (d - 3 >= animTarget.value.length) {
        rafId = null;
        return;
      }

      animIndex.value++;
      const prev = animatedText.value;
      let nextStr = prev;
      for (let f = 0; f <= 3; f++) {
        const p = d - f;
        if (p >= 0 && p < animTarget.value.length) {
          nextStr = replaceAt(
            nextStr,
            p,
            transformChar(prev[p], animTarget.value[p], f)
          );
        }
      }
      animatedText.value = nextStr;

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
  }

  function stopTextAnimation() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  const permissionMode = computed(() => props.permissionMode);
  const size = computed(() => props.size);
</script>

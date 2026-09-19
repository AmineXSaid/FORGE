<template>
  <!--
    The official `JW0`, the glyph beside "Loading sessions…" (step 23):

      var q95=16,U95=1000;
      function JW0(){ let[$,J]=l(0);
        return e(()=>{ let Z=performance.now(),
          Y=setInterval(()=>{ let X=performance.now()-Z; J(X/U95*360) },q95);
          return()=>clearInterval(Y) },[]),
        F("div",{className:H5.reconnectSpinner,style:{transform:`rotate(${$}deg)`}}) }

    Not an icon: a bordered div with its top border transparent
    (`.fg-sessions__reconnectSpinner`, already in the ported sessions module),
    rotated from JS rather than by a CSS animation -- one full turn per second,
    stepped every 16ms. `extract-icons.mjs` finds nothing here, which is why the
    step file's "extract JW0 with extract-icons.mjs" does not apply.
  -->
  <div class="fg-sessions__reconnectSpinner" :style="{ transform: `rotate(${angle}deg)` }"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

/** `q95`: the step, in ms. */
const STEP_MS = 16;
/** `U95`: one full turn, in ms. */
const TURN_MS = 1000;

const angle = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  const start = performance.now();
  timer = setInterval(() => {
    angle.value = ((performance.now() - start) / TURN_MS) * 360;
  }, STEP_MS);
});

onUnmounted(() => {
  if (timer !== undefined) clearInterval(timer);
});
</script>

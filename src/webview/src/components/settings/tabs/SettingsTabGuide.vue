<template>
  <!--
    The Guide: Forge's help, local. It is what "View help docs" and the sidebar's
    Guide open; nothing on it leaves the machine.

    It opens light on purpose: a header, a map of the five questions, and the
    questions themselves, all closed. An answer is built the first time its
    question is opened (`v-if` on `seen`), and its diagrams render then, so
    mermaid is only loaded once someone asks for a diagram. After that the
    answer is kept and only hidden, so reopening it does not redraw anything.

    A Forge surface (forge-style): flat cards, hairlines, sans hierarchy. The
    action buttons are outlined; the page has no one decisive action.
  -->
  <SettingsTab title="Guide">
    <div class="fg-guide">
      <header class="fg-guide__intro">
        <p class="fg-guide__lead">
          How Forge works and how to extend it, in five questions. Everything here is on your machine; open a
          question to see its answer.
        </p>
        <nav class="fg-guide__map" aria-label="Questions">
          <button
            v-for="(topic, i) in topics"
            :key="topic.id"
            type="button"
            class="fg-guide__mapItem"
            :class="{ 'fg-guide__mapItem--open': open.has(topic.id) }"
            @click="reveal(topic.id)"
          >
            <span class="fg-guide__mapNumber">{{ i + 1 }}</span>
            <span class="codicon" :class="`codicon-${topic.icon}`" aria-hidden="true"></span>
            {{ topic.short }}
          </button>
        </nav>
      </header>

      <section
        v-for="(topic, i) in topics"
        :id="`fg-guide-${topic.id}`"
        :key="topic.id"
        class="fg-guide__item"
        :class="{ 'fg-guide__item--open': open.has(topic.id) }"
      >
        <h3 class="fg-guide__heading">
          <button
            :id="`fg-guide-q-${topic.id}`"
            type="button"
            class="fg-guide__question"
            :aria-expanded="open.has(topic.id)"
            :aria-controls="`fg-guide-a-${topic.id}`"
            @click="toggle(topic.id)"
          >
            <span class="fg-guide__number" aria-hidden="true">{{ i + 1 }}</span>
            <span class="fg-guide__questionText">
              <span class="fg-guide__questionTitle">{{ topic.question }}</span>
              <span class="fg-guide__summary">{{ topic.summary }}</span>
            </span>
            <span class="codicon codicon-chevron-right fg-guide__chevron" aria-hidden="true"></span>
          </button>
        </h3>

        <div
          v-if="seen.has(topic.id)"
          v-show="open.has(topic.id)"
          :id="`fg-guide-a-${topic.id}`"
          class="fg-guide__answer"
          role="region"
          :aria-labelledby="`fg-guide-q-${topic.id}`"
        >
          <template v-for="(block, b) in topic.blocks" :key="b">
            <p v-if="block.kind === 'text'" class="fg-guide__text">
              <GuideInline :text="block.text" />
            </p>

            <ol v-else-if="block.kind === 'steps'" class="fg-guide__steps">
              <li v-for="(step, s) in block.items" :key="s" class="fg-guide__step">
                <span class="fg-guide__stepNumber" aria-hidden="true">{{ s + 1 }}</span>
                <span class="fg-guide__stepText"><GuideInline :text="step" /></span>
              </li>
            </ol>

            <figure v-else-if="block.kind === 'diagram'" class="fg-guide__figure">
              <GuideDiagram :source="block.source" />
              <figcaption class="fg-guide__caption"><GuideInline :text="block.caption" /></figcaption>
            </figure>

            <div v-else-if="block.kind === 'code'" class="fg-guide__code">
              <div class="fg-guide__codeHeader">
                <span class="fg-guide__codeTitle">{{ block.title }}</span>
                <button type="button" class="fg-guide__copy" @click="copy(block.code, `${topic.id}-${b}`)">
                  <span
                    class="codicon"
                    :class="copied === `${topic.id}-${b}` ? 'codicon-check' : 'codicon-copy'"
                    aria-hidden="true"
                  ></span>
                  {{ copied === `${topic.id}-${b}` ? 'Copied' : 'Copy' }}
                </button>
              </div>
              <pre class="fg-guide__pre"><code>{{ block.code }}</code></pre>
            </div>

            <div v-else-if="block.kind === 'table'" class="fg-guide__tableWrap">
              <table class="fg-guide__table">
                <thead>
                  <tr>
                    <th v-for="(h, c) in block.head" :key="c" scope="col">{{ h }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, r) in block.rows" :key="r">
                    <td v-for="(cell, c) in row" :key="c"><GuideInline :text="cell" /></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p v-else-if="block.kind === 'note'" class="fg-guide__note">
              <span class="codicon codicon-info fg-guide__noteIcon" aria-hidden="true"></span>
              <span><GuideInline :text="block.text" /></span>
            </p>

            <div v-else-if="block.kind === 'actions'" class="fg-guide__actions">
              <Button v-for="action in block.items" :key="action.label" variant="secondary" @click="act(action)">
                <template #icon>
                  <span class="codicon" :class="`codicon-${action.icon}`" aria-hidden="true"></span>
                </template>
                {{ action.label }}
              </Button>
            </div>
          </template>
        </div>
      </section>
    </div>
  </SettingsTab>
</template>

<script setup lang="ts">
import { nextTick, reactive, ref } from 'vue';
import SettingsTab from '../SettingsTab.vue';
import Button from '../../Common/Button.vue';
import GuideDiagram from '../guide/GuideDiagram.vue';
import GuideInline from '../guide/GuideInline.vue';
import { GUIDE_TOPICS, type GuideAction } from '../guide/guideTopics';
import { runHostAction, transport } from '../../../core/runtimeTransport';
import type { ForgeSettingsTab } from '../../../../../shared/messages';

const emit = defineEmits<{
  /** Another Settings tab, for "Open Skills" and its kin: switched in place. */
  (e: 'select-tab', tab: ForgeSettingsTab): void;
}>();

const topics = GUIDE_TOPICS;
/** Open now. */
const open = reactive(new Set<string>());
/** Opened at least once, so built; closing only hides it. */
const seen = reactive(new Set<string>());
const copied = ref<string | null>(null);

function toggle(id: string): void {
  if (open.has(id)) {
    open.delete(id);
    return;
  }
  seen.add(id);
  open.add(id);
}

/** From the map: open the question and bring it into view. */
async function reveal(id: string): Promise<void> {
  seen.add(id);
  open.add(id);
  await nextTick();
  document.getElementById(`fg-guide-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  document.getElementById(`fg-guide-q-${id}`)?.focus({ preventScroll: true });
}

function act(item: GuideAction): void {
  if ('tab' in item) {
    emit('select-tab', item.tab);
    return;
  }
  runHostAction(item.label.toLowerCase().replace(/…$/, ''), () => transport.runForgeAction(item.action));
}

async function copy(text: string, key: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = key;
    setTimeout(() => {
      if (copied.value === key) copied.value = null;
    }, 1600);
  } catch {
    copied.value = null;
  }
}
</script>

<style scoped>
.fg-guide {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 8px;
}

.fg-guide__intro {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 8px;
}

.fg-guide__lead {
  margin: 0;
  max-width: 62ch;
  color: var(--forge-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.fg-guide__map {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.fg-guide__mapItem {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px 0 4px;
  border: 1px solid var(--forge-hairline);
  border-radius: 8px;
  background: var(--forge-surface);
  color: var(--forge-text);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.12s ease-out, background-color 0.12s ease-out;
}

.fg-guide__mapItem:hover {
  border-color: var(--forge-outline);
  background: var(--forge-surface-hover);
}

.fg-guide__mapItem--open {
  border-color: var(--forge-outline);
}

.fg-guide__mapItem .codicon {
  font-size: 14px;
  color: var(--forge-text-muted);
}

.fg-guide__mapNumber {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--forge-surface-deep);
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 600;
}

/* One question: a flat card, a hairline, no shadow. */
.fg-guide__item {
  border: 1px solid var(--forge-hairline);
  border-radius: 12px;
  background: var(--forge-surface);
  overflow: hidden;
  scroll-margin-top: 16px;
}

.fg-guide__item--open {
  border-color: var(--forge-outline);
}

.fg-guide__heading {
  margin: 0;
  font: inherit;
}

.fg-guide__question {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  border: 0;
  background: transparent;
  color: var(--forge-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fg-guide__question:hover {
  background: var(--forge-surface-hover);
}

.fg-guide__question:focus-visible,
.fg-guide__mapItem:focus-visible,
.fg-guide__copy:focus-visible {
  outline: 1px solid var(--forge-focus-ring);
  outline-offset: -1px;
}

.fg-guide__number {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--forge-surface-deep);
  color: var(--forge-text);
  font-size: 13px;
  font-weight: 600;
}

.fg-guide__questionText {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.fg-guide__questionTitle {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.fg-guide__summary {
  color: var(--forge-text-muted);
  font-size: 12px;
}

.fg-guide__chevron {
  flex: none;
  color: var(--forge-text-muted);
  transition: transform 0.16s ease-out;
}

.fg-guide__item--open .fg-guide__chevron {
  transform: rotate(90deg);
}

.fg-guide__answer {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 16px 20px 56px;
  animation: fg-guide-open 0.18s ease-out;
}

@keyframes fg-guide-open {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .fg-guide__answer { animation: fg-guide-fade 0.12s linear; }
  .fg-guide__chevron { transition: none; }
}

@keyframes fg-guide-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.fg-guide__text {
  margin: 0;
  max-width: 70ch;
  color: var(--forge-text);
  font-size: 13px;
  line-height: 1.6;
}

/* Steps: a numbered column joined by a hairline, read top to bottom. */
.fg-guide__steps {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fg-guide__step {
  position: relative;
  display: flex;
  gap: 12px;
  padding-bottom: 12px;
  font-size: 13px;
  line-height: 1.55;
}

.fg-guide__step:not(:last-child)::before {
  content: '';
  position: absolute;
  top: 24px;
  bottom: 0;
  left: 11px;
  width: 1px;
  background: var(--forge-hairline);
}

.fg-guide__stepNumber {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 23px;
  height: 23px;
  border: 1px solid var(--forge-outline);
  border-radius: 50%;
  background: var(--forge-surface);
  color: var(--forge-text);
  font-size: 11px;
  font-weight: 600;
}

.fg-guide__stepText {
  padding-top: 2px;
  color: var(--forge-text);
}

.fg-guide__figure {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fg-guide__caption {
  color: var(--forge-text-muted);
  font-size: 12px;
}

.fg-guide__code {
  border: 1px solid var(--forge-hairline);
  border-radius: 8px;
  background: var(--forge-surface-sunken);
  overflow: hidden;
}

.fg-guide__codeHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--forge-hairline);
}

.fg-guide__codeTitle {
  color: var(--forge-text-muted);
  font-family: var(--app-monospace-font-family);
  font-size: 11px;
}

.fg-guide__copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--forge-text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.fg-guide__copy:hover {
  background: var(--forge-surface-hover);
  color: var(--forge-text);
}

.fg-guide__copy .codicon {
  font-size: 13px;
}

.fg-guide__pre {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
  color: var(--forge-text);
  font-family: var(--app-monospace-font-family);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre;
}

/* The page's global `code` rule gives inline code a fill and its own colour;
   inside a block that striped every line, so the block's code takes neither. */
.fg-guide__pre code {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
}

.fg-guide__tableWrap {
  overflow-x: auto;
  border: 1px solid var(--forge-hairline);
  border-radius: 8px;
}

.fg-guide__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  line-height: 1.5;
}

.fg-guide__table th {
  padding: 8px 12px;
  background: var(--forge-surface-deep);
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-align: left;
  text-transform: uppercase;
}

.fg-guide__table td {
  padding: 8px 12px;
  border-top: 1px solid var(--forge-hairline);
  color: var(--forge-text);
  vertical-align: top;
}

.fg-guide__table td:first-child {
  font-weight: 500;
  white-space: nowrap;
}

.fg-guide__note {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--forge-surface-deep);
  color: var(--forge-text);
  font-size: 12px;
  line-height: 1.55;
}

.fg-guide__noteIcon {
  flex: none;
  margin-top: 1px;
  color: var(--forge-text-muted);
  font-size: 14px;
}

.fg-guide__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 560px) {
  .fg-guide__answer {
    padding-left: 16px;
  }
}
</style>

<template>
  <!--
    The Skills and Agents tabs' list: what the CLI will load here, and the one
    or two ways to add more. The actions sit at the top, where the eye lands
    first, so creating the first skill is one click from an empty tab. Each row
    opens its file, since the file *is* the skill or the agent.
  -->
  <SettingsSection>
    <SettingsSubSection>
      <div class="forge-items__header">
        <p class="forge-items__intro">{{ intro }}</p>
        <div class="forge-items__actions">
          <Button
            v-for="(action, i) in actions"
            :key="action.id"
            :variant="i === 0 ? 'primary' : 'secondary'"
            :disabled="busy !== undefined"
            @click="run(action.id)"
          >
            <template #icon>
              <span
                class="codicon"
                :class="busy === action.id ? 'codicon-loading forge-items__spin' : action.icon"
                aria-hidden="true"
              />
            </template>
            {{ action.label }}
          </Button>
        </div>
      </div>

      <div v-if="loading && !items.length" class="forge-items__state" role="status">
        <span class="codicon codicon-loading forge-items__spin" aria-hidden="true" />
        Loading…
      </div>

      <div v-else-if="error" class="forge-items__state" role="alert">
        <span>{{ error }}</span>
        <Button variant="tertiary" size="small" @click="refresh">Retry</Button>
      </div>

      <div v-else-if="!items.length" class="forge-items__empty">
        <span class="codicon forge-items__emptyIcon" :class="emptyIcon" aria-hidden="true" />
        <p class="forge-items__emptyTitle">{{ emptyTitle }}</p>
        <p class="forge-items__emptyText">{{ emptyText }}</p>
      </div>

      <TransitionGroup v-else tag="ul" name="forge-items" class="forge-items__list">
        <li v-for="item in items" :key="item.path">
          <button type="button" class="forge-items__row" :title="item.path" @click="open(item)">
            <span class="forge-items__rowMain">
              <span class="forge-items__name">{{ item.name }}</span>
              <span v-if="item.description" class="forge-items__description">{{ item.description }}</span>
            </span>
            <Badge :variant="item.scope === 'project' ? 'primary' : 'subtle'" size="small">
              {{ item.scope === 'project' ? 'Project' : 'Personal' }}
            </Badge>
            <span class="codicon codicon-go-to-file forge-items__open" aria-hidden="true" />
          </button>
        </li>
      </TransitionGroup>
    </SettingsSubSection>
  </SettingsSection>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import SettingsSection from './SettingsSection.vue';
import SettingsSubSection from './SettingsSubSection.vue';
import Button from '../Common/Button.vue';
import Badge from '../Common/Badge.vue';
import { runHostAction, transport } from '../../core/runtimeTransport';
import type { ForgeAction, ForgeItemEntry, ForgeItemKind } from '../../../../shared/messages';

const props = defineProps<{
  kind: ForgeItemKind;
  intro: string;
  emptyTitle: string;
  emptyText: string;
  emptyIcon: string;
  actions: Array<{ id: ForgeAction; label: string; icon: string }>;
}>();

const items = ref<ForgeItemEntry[]>([]);
const loading = ref(true);
const error = ref('');
/** The action whose prompts are open; the buttons wait until it ends. */
const busy = ref<ForgeAction | undefined>(undefined);

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    items.value = (await transport.listForgeItems(props.kind)).items;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

function run(action: ForgeAction): void {
  busy.value = action;
  runHostAction('finish that', () =>
    transport.runForgeAction(action).finally(() => {
      busy.value = undefined;
      void refresh();
    }),
  );
}

function open(item: ForgeItemEntry): void {
  runHostAction(`open ${item.name}`, () => transport.openFile(item.path));
}

onMounted(refresh);
</script>

<style scoped>
.forge-items__header {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  justify-content: space-between;
  padding: 14px;
}

.forge-items__intro {
  color: var(--cursor-text-secondary);
  flex: 1 1 260px;
  font-size: 12px;
  line-height: 17px;
  margin: 0;
  max-width: 62ch;
}

.forge-items__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.forge-items__state {
  align-items: center;
  border-top: 1px solid var(--cursor-stroke-tertiary);
  color: var(--cursor-text-secondary);
  display: flex;
  font-size: 12px;
  gap: 10px;
  padding: 14px;
}

.forge-items__empty {
  align-items: center;
  border-top: 1px solid var(--cursor-stroke-tertiary);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 28px 16px 30px;
  text-align: center;
}

.forge-items__emptyIcon {
  color: var(--forge-brand);
  font-size: 22px;
  margin-bottom: 6px;
  opacity: 0.85;
}

.forge-items__emptyTitle {
  color: var(--cursor-text-primary);
  font-size: 13px;
  font-weight: 500;
  margin: 0;
}

.forge-items__emptyText {
  color: var(--cursor-text-secondary);
  font-size: 12px;
  line-height: 17px;
  margin: 0;
  max-width: 44ch;
}

.forge-items__list {
  list-style: none;
  margin: 0;
  padding: 0 6px 6px;
}

.forge-items__row {
  align-items: center;
  background: transparent;
  border: none;
  border-radius: var(--corner-radius-medium);
  border-top: 1px solid var(--cursor-stroke-tertiary);
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: 12px;
  padding: 10px 8px;
  text-align: left;
  transition: background-color 120ms cubic-bezier(0.22, 1, 0.36, 1);
  width: 100%;
}

.forge-items__row:hover {
  background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
}

.forge-items__row:focus-visible {
  outline: 2px solid var(--forge-focus-ring);
  outline-offset: -2px;
}

.forge-items__rowMain {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.forge-items__name {
  color: var(--cursor-text-primary);
  font-family: var(--app-monospace-font-family);
  font-size: 12px;
  font-weight: 500;
}

.forge-items__description {
  color: var(--cursor-text-secondary);
  font-size: 12px;
  line-height: 17px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forge-items__open {
  color: var(--cursor-text-tertiary);
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.22, 1, 0.36, 1);
}

.forge-items__row:hover .forge-items__open,
.forge-items__row:focus-visible .forge-items__open {
  opacity: 1;
}

.forge-items__spin {
  animation: forge-items-spin 900ms linear infinite;
}

@keyframes forge-items-spin {
  to { transform: rotate(360deg); }
}

.forge-items-enter-active {
  transition: opacity 200ms cubic-bezier(0.22, 1, 0.36, 1), transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}

.forge-items-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

@media (prefers-reduced-motion: reduce) {
  .forge-items__row,
  .forge-items__open,
  .forge-items-enter-active {
    transition: none;
  }

  .forge-items__spin {
    animation-duration: 2.4s;
  }
}
</style>

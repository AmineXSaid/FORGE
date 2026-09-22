<template>
  <!--
    A topic card, built on the official startup-announcement markup (reference
    `bq0` / `Oq0`, module BrnsCQ): a header with icon, title and close, then a
    body with a description and a link. Each topic's icon and highlighted words
    wear its Pajamas hue; Ultracode's words carry its animated lightning instead.
  -->
  <div class="fg-notice__container" data-testid="startup-announcement-notice">
    <div class="fg-notice__header">
      <BoltIcon v-if="card.icon === 'bolt'" class="fg-notice__headerIcon" :class="toneClass" />
      <ModePlanIcon v-else-if="card.icon === 'plan'" class="fg-notice__headerIcon" :class="toneClass" />
      <ModeEditIcon v-else-if="card.icon === 'edit'" class="fg-notice__headerIcon" :class="toneClass" />
      <AddContextIcon v-else-if="card.icon === 'mention'" class="fg-notice__headerIcon" :class="toneClass" />
      <CommandMenuIcon v-else-if="card.icon === 'slash'" class="fg-notice__headerIcon" :class="toneClass" />
      <SelectionIcon v-else-if="card.icon === 'selection'" class="fg-notice__headerIcon" :class="toneClass" />
      <!--
        The same codicon the Settings ▸ Endpoints tab uses, so one glyph means
        "endpoint" everywhere in Forge. There is nothing to extract from the
        official bundle here: it has no endpoint concept.
      -->
      <span
        v-else-if="card.icon === 'endpoint'"
        class="codicon codicon-plug fg-notice__headerIcon"
        :class="toneClass"
        aria-hidden="true"
      />
      <span v-else class="codicon codicon-history fg-notice__headerIcon" :class="toneClass" aria-hidden="true" />
      <span class="fg-notice__headerTitle">
        {{ card.title[0] }}<span class="fg-notice__brand" :class="brandClass">{{ card.title[1] }}</span>
      </span>
      <div class="fg-notice__headerSpacer"></div>
      <button
        type="button"
        class="fg-iconbutton__iconButton fg-iconbutton__iconButton20"
        aria-label="Close"
        title="Close"
        @click="emit('dismiss', card.id)"
      >
        <CloseIcon />
      </button>
    </div>
    <div class="fg-notice__body">
      <p class="fg-notice__description">{{ description }}</p>
      <a v-if="card.action" href="#" class="fg-notice__learnMore" @click.prevent="emit('action', card.id)">
        {{ card.action }}
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BoltIcon from '../forge/icons/BoltIcon.vue';
import CloseIcon from '../forge/icons/CloseIcon.vue';
import ModePlanIcon from '../forge/icons/ModePlanIcon.vue';
import ModeEditIcon from '../forge/icons/ModeEditIcon.vue';
import AddContextIcon from '../forge/icons/AddContextIcon.vue';
import CommandMenuIcon from '../forge/icons/CommandMenuIcon.vue';
import SelectionIcon from '../forge/icons/SelectionIcon.vue';
import type { WelcomeCard } from '../../utils/announcements';
import { isMacPlatform } from '../../utils/firstRun';

const props = defineProps<{ card: WelcomeCard; platform: string }>();
const emit = defineEmits<{ (e: 'action', id: string): void; (e: 'dismiss', id: string): void }>();

const toneClass = computed(() => `fg-welcomecard--${props.card.tone}`);
const brandClass = computed(() => (props.card.id === 'ultracode' ? 'fg-ultracode-text' : toneClass.value));
const description = computed(() =>
  props.card.description.replace('{chat}', isMacPlatform(props.platform) ? 'Option+K' : 'Alt+K')
);
</script>

<style scoped>
.fg-welcomecard--pink {
  color: var(--forge-ultracode-pink);
}

.fg-welcomecard--blue {
  color: var(--forge-info);
}

.fg-welcomecard--green {
  color: var(--forge-success);
}

.fg-welcomecard--orange {
  color: var(--forge-warning);
}

.fg-welcomecard--purple {
  color: var(--forge-brand);
}

.fg-welcomecard--amber {
  color: var(--forge-card-amber);
}

.fg-welcomecard--neutral {
  color: var(--app-secondary-foreground);
}
</style>

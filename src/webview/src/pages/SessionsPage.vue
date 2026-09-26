<template>
  <!--
    The activity-bar session manager: the official `KW0` (module djirOA),
    wrapping the shared sessions list (`At`, SessionList.vue) in its
    list-only mount.

      if(!J.isAuthenticated.value) return F("div",{className:D7.root, children:F(In,{context:J})});
      return R("div",{className:D7.root, children:[
        F(f95,{…usage…}),
        F("div",{className:D7.sectionHeader, children:R("button",{className:D7.sectionToggle,
          onClick:()=>b0("sessions",!V0), "aria-expanded":!V0,
          title:V0?"Expand session manager":"Collapse session manager",
          children:[F(qv,{className:`${D7.sectionChevron} ${V0?"":D7.sectionChevronExpanded}`}),
                    F("span",{className:D7.sectionLabel, children:"Session manager"})]})}),
        R("div",{className:V0?`${D7.sessionsBody} ${D7.sessionsBodyCollapsed}`:D7.sessionsBody, children:[
          R("div",{className:D7.headerRow, children:[
            R("button",{className:D7.newSessionButton, onClick:()=>{J.openInEditor()},
              children:[F(e51,{className:D7.newSessionIcon}),"New session"]}), null]}),
          F(At,{…, isSessionListOnly:!0, autoFocusSearch:!0, sessionGroups, onUpdateSessionGroups,
                sectionCollapseState, onUpdateSectionCollapseState, openSessionIds,
                unreadSessionKeys, onSetSessionUnread, onNewSessionInGroup, …})]})]})

    Forge's differences, each recorded in docs/forge-design.md:
    - no endpoint stands where the official has no login: the setup page
      (EndpointWelcome, state A) in place of `In`;
    - the usage section (`f95`) is out of scope (account & usage), so the
      "usage" panel section never renders; "sessions" collapses as the official;
    - a row, "New session" and "Start new session in this group" hand off to
      the chat side bar instead of opening an editor tab (#17).
  -->
  <div class="fg-sessionmanager__root">
    <EndpointWelcome
      v-if="noEndpoint"
      state="no-profiles"
      :adding="addingEndpoint"
      @add="addEndpoint"
    />
    <template v-else>
      <div class="fg-sessionmanager__sectionHeader">
        <button
          class="fg-sessionmanager__sectionToggle"
          :aria-expanded="!collapsed"
          :title="collapsed ? 'Expand session manager' : 'Collapse session manager'"
          @click="store.setPanelSectionCollapsed('sessions', !collapsed)"
        >
          <SectionChevronIcon
            :class="['fg-sessionmanager__sectionChevron', { 'fg-sessionmanager__sectionChevronExpanded': !collapsed }]"
          />
          <span class="fg-sessionmanager__sectionLabel">Session manager</span>
        </button>
      </div>
      <div :class="['fg-sessionmanager__sessionsBody', { 'fg-sessionmanager__sessionsBodyCollapsed': collapsed }]">
        <div class="fg-sessionmanager__headerRow">
          <button type="button" class="fg-sessionmanager__newSessionButton" @click="createNewSession">
            <NewSessionRowIcon class="fg-sessionmanager__newSessionIcon" />
            New session
          </button>
        </div>
        <SessionList
          list-only
          groups
          feeds
          new-session-in-group
          auto-focus-search
          :loaded="loaded"
          @open="openSession"
          @new-session-in-group="(groupId) => emit('newConversation', groupId)"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import { transport, runHostAction } from '../core/runtimeTransport';
import { RuntimeKey } from '../composables/runtimeContext';
import { useSessionStore } from '../composables/useSessionStore';
import type { Session } from '../core/Session';
import SessionList from '../components/forge/SessionList.vue';
import EndpointWelcome from '../components/welcome/EndpointWelcome.vue';
import NewSessionRowIcon from '../components/forge/icons/NewSessionRowIcon.vue';
import SectionChevronIcon from '../components/forge/icons/SectionChevronIcon.vue';
import { sessionKey } from '../core/sessionStates';
import { readKnownHasEndpoints, resolveHasEndpoints, writeKnownHasEndpoints } from '../utils/endpointWelcome';

const runtime = inject(RuntimeKey);
if (!runtime) throw new Error('[SessionsPage] runtime not provided');
const store = useSessionStore(runtime.sessionStore);

const props = defineProps<{
  /**
   * This is the session manager in its own side bar, not a page inside a
   * chat. It has no conversation of its own: opening one hands off to the chat.
   */
  standalone?: boolean;
}>();

const emit = defineEmits<{
  /** A row: open this conversation in the chat. */
  switchToChat: [sessionId?: string];
  /** "New session", or "Start new session in this group". */
  newConversation: [groupId?: string];
}>();

/* ------------------------------------------------ the no-endpoint setup */

/**
 * The official shows its login page here until the user is signed in; Forge's
 * equivalent question is whether any endpoint exists. Read as the chat reads
 * it (`resolveHasEndpoints`): the live answer, else the last one this view saw.
 */
const hostConfig = useSignal(transport.config);
const liveHasEndpoints = computed<boolean | undefined>(() => {
  const count = hostConfig.value?.endpointProfileCount;
  return count === undefined ? undefined : count > 0;
});
const knownHasEndpoints = ref(readKnownHasEndpoints());
watch(
  liveHasEndpoints,
  (live) => {
    if (live === undefined) return;
    knownHasEndpoints.value = live;
    writeKnownHasEndpoints(live);
  },
  { immediate: true }
);
const noEndpoint = computed(() => !resolveHasEndpoints(liveHasEndpoints.value, knownHasEndpoints.value));

const addingEndpoint = ref(false);
function addEndpoint(): void {
  if (addingEndpoint.value) return;
  addingEndpoint.value = true;
  runHostAction('add an endpoint', () =>
    transport.runEndpointAction('add').finally(() => {
      addingEndpoint.value = false;
    })
  );
}

/* -------------------------------------------------- the section and list */

// The page was built with the stored state (`collapsedPanelSectionsSeed`).
runtime.sessionStore.seedCollapsedPanelSections(window.FORGE_BOOTSTRAP?.collapsedPanelSections);

/** `V0`: "sessions" is collapsed. */
const collapsed = computed(() => store.collapsedPanelSections.value.includes('sessions'));

/** `localSessionsLoaded`: the first listing has answered (or failed, bounded). */
const loaded = ref(false);
async function refresh(): Promise<void> {
  try {
    await store.listSessions();
  } catch (error) {
    console.warn('[SessionsPage] listing sessions failed', error);
  } finally {
    loaded.value = true;
  }
}

/** A row opens its conversation in the chat; opening it clears its unread mark. */
function openSession(session: Session): void {
  const id = session.sessionId();
  const key = sessionKey(id);
  if (key && store.unreadSessionKeys.value?.includes(key)) void store.setSessionUnread(key, false);
  if (!props.standalone) store.setActiveSession(session);
  emit('switchToChat', id);
}

function createNewSession(): void {
  emit('newConversation');
}

// `$.listSessions("sidebar_mount"), …, $.listSessionGroups(), $.listCollapsedPanelSections()`.
onMounted(() => {
  void refresh();
  void store.listSessionGroups();
  void store.listCollapsedPanelSections();
});

// `if(q>0) $.listSessionGroups({forceAdopt:!0})`: the host changed the groups.
const groupsVersion = useSignal(transport.sessionGroupsVersion);
watch(groupsVersion, (version) => {
  if (version > 0) void store.listSessionGroups({ forceAdopt: true });
});

// Shown again after being hidden: read the list again, since whatever changed
// meanwhile may have been pushed while this view was not listening.
const visible = useSignal(transport.isVisible);
watch(visible, (now, before) => {
  if (now && before === false) {
    void refresh();
    void store.listSessionGroups();
  }
});
</script>

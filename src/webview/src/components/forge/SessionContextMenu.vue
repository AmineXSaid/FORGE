<template>
  <!--
    The official context menu (`gH0`, module _ozcbg; section headings from the
    command menu module G_S7FQ's `sectionHeader`). The session list opens it
    for a row, an archived row, a group header and the status filter.

    Items come grouped by heading (`n85`): a heading starts a
    `role="group"` labelled by it. A row with `selected` defined carries the
    check column and is a checkbox (`keepOpen`) or a radio item. A row with a
    `submenu` opens a second menu beside it on hover, click or ArrowRight.
  -->
  <Teleport to="body">
    <div
      ref="menuEl"
      class="fg-contextmenu__contextMenu"
      role="menu"
      :style="{ left: `${pos?.left ?? x}px`, top: `${pos?.top ?? y}px`, visibility: pos ? 'visible' : 'hidden' }"
    >
      <template v-for="section in sections" :key="section.entries[0].index">
        <template v-if="section.heading === undefined">
          <template v-for="{ item, index } in section.entries" :key="index">
            <div v-if="item.separatorBefore" class="fg-contextmenu__separator"></div>
            <button
              :ref="(el) => setItemEl(index, el)"
              :class="['fg-contextmenu__menuItem', { 'fg-contextmenu__menuItemSubmenuOpen': item.submenu && openIndex === index }]"
              :role="roleOf(item)"
              :aria-checked="item.selected"
              :aria-haspopup="item.submenu ? 'menu' : undefined"
              :aria-expanded="item.submenu ? openIndex === index : undefined"
              @mouseenter="onEnter(item, index)"
              @click="onClick(item, index)"
            >
              <span v-if="item.selected !== undefined" class="fg-contextmenu__menuItemCheck" aria-hidden="true">
                <MenuCheckIcon v-if="item.selected" class="fg-contextmenu__checkIcon" />
              </span>{{ item.label }}<span v-if="item.submenu" class="fg-contextmenu__submenuChevron">›</span>
            </button>
          </template>
        </template>
        <template v-else>
          <div v-if="section.entries[0].item.separatorBefore" class="fg-contextmenu__separator"></div>
          <div role="group" :aria-labelledby="`${uid}-section-${section.entries[0].index}`">
            <div :id="`${uid}-section-${section.entries[0].index}`" class="fg-commandmenu__sectionHeader">{{ section.heading }}</div>
            <template v-for="{ item, index } in section.entries" :key="index">
              <div
                v-if="item.separatorBefore && index !== section.entries[0].index"
                class="fg-contextmenu__separator"
              ></div>
              <button
                :ref="(el) => setItemEl(index, el)"
                :class="['fg-contextmenu__menuItem', { 'fg-contextmenu__menuItemSubmenuOpen': item.submenu && openIndex === index }]"
                :role="roleOf(item)"
                :aria-checked="item.selected"
                :aria-haspopup="item.submenu ? 'menu' : undefined"
                :aria-expanded="item.submenu ? openIndex === index : undefined"
                @mouseenter="onEnter(item, index)"
                @click="onClick(item, index)"
              >
                <span v-if="item.selected !== undefined" class="fg-contextmenu__menuItemCheck" aria-hidden="true">
                  <MenuCheckIcon v-if="item.selected" class="fg-contextmenu__checkIcon" />
                </span>{{ item.label }}<span v-if="item.submenu" class="fg-contextmenu__submenuChevron">›</span>
              </button>
            </template>
          </div>
        </template>
      </template>
    </div>
    <div
      v-if="submenu && anchor"
      ref="subEl"
      class="fg-contextmenu__contextMenu"
      role="menu"
      :style="{ left: `${subPos?.left ?? MENU_MARGIN}px`, top: `${subPos?.top ?? anchor.top}px`, visibility: subPos ? 'visible' : 'hidden' }"
      @mouseenter="cancelClose"
    >
      <template v-for="(sub, i) in submenu" :key="i">
        <div v-if="sub.separatorBefore" class="fg-contextmenu__separator"></div>
        <button
          :ref="(el) => { subEls[i] = el as HTMLButtonElement | null }"
          class="fg-contextmenu__menuItem"
          role="menuitem"
          @click="sub.onSelect(); emit('close')"
        >{{ sub.label }}</button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import MenuCheckIcon from './icons/MenuCheckIcon.vue';
import { MENU_MARGIN, menuLeft, sectionsOf, submenuLeft, type MenuItem } from '../../core/sessionListMenus';

const props = defineProps<{ items: MenuItem[]; x: number; y: number }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const uid = `forge-ctx-${Math.random().toString(36).slice(2, 8)}`;
const menuEl = ref<HTMLElement | null>(null);
const subEl = ref<HTMLElement | null>(null);
const itemEls: Array<HTMLButtonElement | null> = [];
const subEls: Array<HTMLButtonElement | null> = [];
const pos = ref<{ left: number; top: number } | null>(null);
const subPos = ref<{ left: number; top: number } | null>(null);
const openIndex = ref<number | null>(null);
const anchor = ref<{ left: number; right: number; top: number } | null>(null);
let closeTimer: ReturnType<typeof setTimeout> | null = null;
/** What had focus before the menu took it, given back on close (the official `z`). */
const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

const sections = computed(() => sectionsOf(props.items));
const submenu = computed(() => (openIndex.value !== null ? props.items[openIndex.value]?.submenu : undefined));

function setItemEl(index: number, el: unknown): void {
  itemEls[index] = (el as HTMLButtonElement | null) ?? null;
}

/** `role`: a plain row is a menuitem; a checked one a checkbox (keeps open) or a radio. */
function roleOf(item: MenuItem): string {
  if (item.selected === undefined) return 'menuitem';
  return item.keepOpen ? 'menuitemcheckbox' : 'menuitemradio';
}

/** The official layout effect: clamp to the window, leaving room for a submenu. */
function place(): void {
  const el = menuEl.value;
  if (!el) return;
  const { offsetWidth: width, offsetHeight: height } = el;
  pos.value = {
    left: menuLeft(props.x, width, window.innerWidth, props.items.some((item) => item.submenu !== undefined)),
    top: Math.max(MENU_MARGIN, Math.min(props.y, window.innerHeight - height - MENU_MARGIN)),
  };
}

function placeSubmenu(): void {
  const el = subEl.value;
  if (!el || !anchor.value) return;
  subPos.value = {
    left: submenuLeft(anchor.value, el.offsetWidth, window.innerWidth),
    top: Math.max(MENU_MARGIN, Math.min(anchor.value.top - 3, window.innerHeight - el.offsetHeight - MENU_MARGIN)),
  };
}

function cancelClose(): void {
  if (closeTimer !== null) clearTimeout(closeTimer);
  closeTimer = null;
}

/** The official 150ms grace before a submenu closes when the pointer leaves its row. */
function scheduleClose(): void {
  cancelClose();
  closeTimer = setTimeout(() => {
    closeTimer = null;
    closeSubmenu(false);
  }, 150);
}

function openSubmenu(index: number): void {
  cancelClose();
  if (openIndex.value === index) return;
  subEls.length = 0;
  const rect = itemEls[index]?.getBoundingClientRect();
  anchor.value = rect ? { left: rect.left, right: rect.right, top: rect.top } : null;
  subPos.value = null;
  openIndex.value = index;
  void nextTick(placeSubmenu);
}

function closeSubmenu(refocus: boolean): void {
  if (openIndex.value === null) return;
  const index = openIndex.value;
  openIndex.value = null;
  subPos.value = null;
  if (refocus) itemEls[index]?.focus();
}

function onEnter(item: MenuItem, index: number): void {
  if (item.submenu) openSubmenu(index);
  else if (openIndex.value !== null) scheduleClose();
}

function onClick(item: MenuItem, index: number): void {
  if (item.submenu) {
    openSubmenu(index);
    requestAnimationFrame(() => subEls[0]?.focus());
    return;
  }
  item.onSelect?.();
  if (!item.keepOpen) emit('close');
}

/** `q(S)`: move focus through the menu, or through the submenu when focus is in it. */
function moveFocus(step: number): void {
  const active = document.activeElement;
  const inSub = subEls.filter(Boolean) as HTMLButtonElement[];
  const inSubmenu = inSub.some((el) => el === active);
  if (!inSubmenu) closeSubmenu(false);
  const list = inSubmenu ? inSub : (itemEls.filter(Boolean) as HTMLButtonElement[]);
  if (list.length === 0) return;
  const at = list.findIndex((el) => el === active);
  const next = at === -1 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
  list[next]?.focus();
}

function onDocumentMouseDown(event: MouseEvent): void {
  const target = event.target as Node;
  if (menuEl.value?.contains(target) || subEl.value?.contains(target)) return;
  // A left click outside closes the menu and is eaten, so it does not also
  // act on whatever is under it (the official swallows the next click).
  if (event.button === 0) {
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('click', swallow, { capture: true, once: true });
    document.addEventListener(
      'mouseup',
      () => setTimeout(() => document.removeEventListener('click', swallow, true), 0),
      { capture: true, once: true }
    );
  }
  emit('close');
}

function onDocumentKeyDown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('close');
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    moveFocus(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'ArrowRight') {
    const at = itemEls.findIndex((el) => el === document.activeElement);
    if (at !== -1 && props.items[at]?.submenu) {
      event.preventDefault();
      event.stopPropagation();
      openSubmenu(at);
      requestAnimationFrame(() => subEls[0]?.focus());
    }
  } else if (event.key === 'ArrowLeft') {
    if (subEls.some((el) => el !== null && el === document.activeElement)) {
      event.preventDefault();
      event.stopPropagation();
      closeSubmenu(true);
    }
  }
}

function onWindowBlur(): void {
  emit('close');
}

watch(() => [props.x, props.y, props.items], () => void nextTick(place));

onMounted(() => {
  place();
  // Focus the first row once placed.
  void nextTick(() => itemEls.find(Boolean)?.focus());
  document.addEventListener('mousedown', onDocumentMouseDown);
  document.addEventListener('keydown', onDocumentKeyDown, true);
  window.addEventListener('blur', onWindowBlur);
});

onBeforeUnmount(() => {
  cancelClose();
  document.removeEventListener('mousedown', onDocumentMouseDown);
  document.removeEventListener('keydown', onDocumentKeyDown, true);
  window.removeEventListener('blur', onWindowBlur);
  const active = document.activeElement;
  if ((active === null || active === document.body || menuEl.value?.contains(active)) && document.hasFocus()) {
    restoreFocus?.focus();
  }
});
</script>

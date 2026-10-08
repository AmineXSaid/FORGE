/**
 * What needs the user while they are looking elsewhere.
 *
 * - A turn ends (a session goes from busy to idle) or a session asks for
 *   permission: an OS notification, which the desktop app shows only while
 *   its window is not focused.
 * - Every permission request still open is tracked; the ones in sessions
 *   that are not on screen are `waiting`, which the shell shows as Monad's
 *   black announcement bar. Opening the session, or answering, clears it.
 */
import { effect } from 'alien-signals';
import { computed, shallowRef, type ComputedRef } from 'vue';
import type { SessionStore } from '../core/SessionStore';
import type { Session } from '../core/Session';
import { desktopHost } from './desktopHost';

export interface Waiting {
  session: Session;
  tool: string;
}

export function sessionTitle(session: Session): string {
  return session.summary()?.trim() || 'Untitled session';
}

export function watchAttention(store: SessionStore): { waiting: ComputedRef<Waiting[]>; dispose: () => void } {
  const open = shallowRef<(Waiting & { id: number })[]>([]);
  const active = shallowRef<Session | undefined>(store.activeSession());
  const wasBusy = new WeakMap<Session, boolean>();
  const notify = (title: string, body: string) => void desktopHost()?.notify(title, body).catch(() => {});
  let seq = 0;

  const stopBusy = effect(() => {
    for (const session of store.sessions()) {
      const busy = session.busy();
      if (wasBusy.get(session) && !busy) notify('Forge', `${sessionTitle(session)} is done.`);
      wasBusy.set(session, busy);
    }
  });

  const stopActive = effect(() => {
    active.value = store.activeSession();
  });

  const stopPermission = store.onPermissionRequested(({ session, permissionRequest }) => {
    notify('Forge needs your approval', `${permissionRequest.toolName} in ${sessionTitle(session)}`);
    const id = ++seq;
    open.value = [...open.value, { id, session, tool: permissionRequest.toolName }];
    permissionRequest.onResolved(() => {
      open.value = open.value.filter((w) => w.id !== id);
    });
  });

  // One entry per session, newest request first, for the sessions not on screen.
  const waiting = computed(() => {
    const seen = new Set<Session>();
    const out: Waiting[] = [];
    for (const w of [...open.value].reverse()) {
      if (w.session === active.value || seen.has(w.session)) continue;
      seen.add(w.session);
      out.push({ session: w.session, tool: w.tool });
    }
    return out;
  });

  return {
    waiting,
    dispose() {
      stopBusy();
      stopActive();
      stopPermission();
    },
  };
}

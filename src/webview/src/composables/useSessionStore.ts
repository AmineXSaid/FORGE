/**
 * useSessionStore - Vue Composable for SessionStore
 *
 * 核心功能：
 * 1. 将 SessionStore 类的 alien-signals 转换为 Vue refs
 * 2. 将 alien computed 转换为 Vue computed
 * 3. 提供 Vue-friendly 的 API
 *
 * 使用方法：
 * ```typescript
 * const store = new SessionStore(...);
 * const storeAPI = useSessionStore(store);
 * // storeAPI.sessions 是 Vue Ref<Session[]>
 * // storeAPI.activeSession 是 Vue Ref<Session | undefined>
 * ```
 */

import type { ComputedRef, Ref } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import type { SessionStore, PermissionEvent } from '../core/SessionStore';
import type { Session, SessionOptions } from '../core/Session';
import type { BaseTransport } from '../transport/BaseTransport';
import type { PanelSection, SessionGroup, SessionSectionCollapseState } from '../../../shared/sessionGroups';

/**
 * useSessionStore 返回类型
 */
export interface UseSessionStoreReturn {
  // 状态
  sessions: Ref<Session[]>;
  activeSession: Ref<Session | undefined>;

  // 计算属性
  sessionsByLastModified: ComputedRef<Session[]>;
  connectionState: ComputedRef<string>;
  /**
   * The `session_states_update` feeds (step 22). Both are `undefined` until the
   * host answers, which is the official's "no dot yet" state.
   */
  openSessionIds: ComputedRef<string[] | undefined>;
  unreadSessionKeys: ComputedRef<string[] | undefined>;
  /** Session groups and collapse state (production audit, Phase 6). */
  sessionGroups: Ref<SessionGroup[]>;
  sessionGroupsLoaded: Ref<boolean>;
  sessionSectionCollapseState: Ref<SessionSectionCollapseState>;
  collapsedPanelSections: Ref<PanelSection[]>;

  // 方法
  onPermissionRequested: (callback: (event: PermissionEvent) => void) => () => void;
  getConnection: () => Promise<BaseTransport>;
  createSession: (options?: SessionOptions) => Promise<Session>;
  listSessions: () => Promise<void>;
  /** The official `renameSession($,J)`: write a custom title (step 20). */
  renameSession: (sessionId: string, title: string) => Promise<void>;
  /** The official `archiveSession` / `unarchiveSession` (step 21). */
  archiveSession: (session: Session) => Promise<void>;
  unarchiveSession: (session: Session) => Promise<void>;
  /** The official `setSessionUnread($,J)`: mark a conversation unread, or read (step 22). */
  setSessionUnread: (key: string, unread: boolean) => Promise<void>;
  listSessionGroups: (options?: { forceAdopt?: boolean }) => Promise<void>;
  updateSessionGroups: (groups: SessionGroup[]) => Promise<void>;
  updateSessionSectionCollapseState: (patch: Partial<SessionSectionCollapseState>) => Promise<void>;
  listCollapsedPanelSections: () => Promise<void>;
  setPanelSectionCollapsed: (section: PanelSection, collapsed: boolean) => Promise<void>;
  setActiveSession: (session: Session | undefined) => void;
  dispose: () => void;

  // 原始实例（用于高级场景）
  __store: SessionStore;
}

/**
 * useSessionStore - 将 SessionStore 实例包装为 Vue Composable API
 *
 * @param store SessionStore 实例
 * @returns Vue-friendly API
 */
export function useSessionStore(store: SessionStore): UseSessionStoreReturn {
  // 🔥 使用官方 useSignal 桥接
  const sessions = useSignal(store.sessions);
  const activeSession = useSignal(store.activeSession);

  // 🔥 使用 useSignal 包装 alien computed
  const sessionsByLastModified = useSignal(store.sessionsByLastModified) as unknown as ComputedRef<Session[]>;
  const connectionState = useSignal(store.connectionState) as unknown as ComputedRef<string>;
  const openSessionIds = useSignal(store.openSessionIds) as unknown as ComputedRef<
    string[] | undefined
  >;
  const unreadSessionKeys = useSignal(store.unreadSessionKeys) as unknown as ComputedRef<
    string[] | undefined
  >;

  const sessionGroups = useSignal(store.sessionGroups);
  const sessionGroupsLoaded = useSignal(store.sessionGroupsLoaded);
  const sessionSectionCollapseState = useSignal(store.sessionSectionCollapseState);
  const collapsedPanelSections = useSignal(store.collapsedPanelSections);

  // 🔥 绑定所有方法（确保 this 指向正确）
  const onPermissionRequested = store.onPermissionRequested.bind(store);
  const getConnection = store.getConnection.bind(store);
  const createSession = store.createSession.bind(store);
  const listSessions = store.listSessions.bind(store);
  const renameSession = store.renameSession.bind(store);
  const archiveSession = store.archiveSession.bind(store);
  const unarchiveSession = store.unarchiveSession.bind(store);
  const setSessionUnread = store.setSessionUnread.bind(store);
  const setActiveSession = store.setActiveSession.bind(store);
  const listSessionGroups = store.listSessionGroups.bind(store);
  const updateSessionGroups = store.updateSessionGroups.bind(store);
  const updateSessionSectionCollapseState = store.updateSessionSectionCollapseState.bind(store);
  const listCollapsedPanelSections = store.listCollapsedPanelSections.bind(store);
  const setPanelSectionCollapsed = store.setPanelSectionCollapsed.bind(store);
  const dispose = store.dispose.bind(store);

  return {
    // 状态
    sessions,
    activeSession,

    // 计算属性
    sessionsByLastModified,
    connectionState,
    openSessionIds,
    unreadSessionKeys,
    sessionGroups,
    sessionGroupsLoaded,
    sessionSectionCollapseState,
    collapsedPanelSections,

    // 方法
    onPermissionRequested,
    getConnection,
    createSession,
    listSessions,
    renameSession,
    archiveSession,
    unarchiveSession,
    setSessionUnread,
    listSessionGroups,
    updateSessionGroups,
    updateSessionSectionCollapseState,
    listCollapsedPanelSections,
    setPanelSectionCollapsed,
    setActiveSession,
    dispose,

    // 原始实例
    __store: store,
  };
}

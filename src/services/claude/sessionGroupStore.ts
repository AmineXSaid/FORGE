/**
 * Session groups, the list's section collapse state, and the session manager's
 * collapsed panel sections, kept across reloads (production audit, Phase 6).
 *
 * Ported from the official settings store (`extension.js`):
 *
 *   sessionGroupsKey(){ return `sessionGroups:${this.sessionListScopeRoot()}` }
 *   getSessionGroups(){ return VG(this.context.globalState.get(this.sessionGroupsKey())) }
 *   async setSessionGroups($){ await this.context.globalState.update(this.sessionGroupsKey(),$) }
 *   sessionSectionCollapseStateKey(){ return `sessionSectionCollapseState:${this.sessionListScopeRoot()}` }
 *   getSessionSectionCollapseState(){ return O7$(this.context.globalState.get(this.sessionSectionCollapseStateKey())) }
 *   getCollapsedPanelSections(){ return ye(this.context.globalState.get("collapsedPanelSections")) }
 *   async setCollapsedPanelSections($){ await this.context.globalState.update("collapsedPanelSections",ye($)) }
 *
 * Groups and the section state are per workspace (the scope root, which a
 * worktree shares with its main checkout); the panel sections are global.
 * Kept free of `vscode` so the specs can drive it with a Map.
 */

import {
    readCollapsedPanelSections,
    readSectionCollapseState,
    normalizeSessionGroups,
    type PanelSection,
    type SessionGroup,
    type SessionSectionCollapseState,
} from '../../shared/sessionGroups';
import { sessionListScopeRoot } from './unreadSessions';

/** The `Memento` surface this store needs. */
export interface SessionGroupsMemento {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/** The official global key for the panel sections. */
export const COLLAPSED_PANEL_SECTIONS_KEY = 'collapsedPanelSections';

/** `sessionGroupsKey()`. */
export function sessionGroupsKey(workspaceFolder: string): string {
    return `sessionGroups:${sessionListScopeRoot(workspaceFolder)}`;
}

/** `sessionSectionCollapseStateKey()`. */
export function sessionSectionCollapseStateKey(workspaceFolder: string): string {
    return `sessionSectionCollapseState:${sessionListScopeRoot(workspaceFolder)}`;
}

export class SessionGroupStore {
    constructor(
        private readonly memento: SessionGroupsMemento,
        private readonly workspaceFolder: () => string
    ) {}

    getSessionGroups(): SessionGroup[] {
        return normalizeSessionGroups(this.memento.get<unknown>(sessionGroupsKey(this.workspaceFolder())));
    }

    async setSessionGroups(groups: SessionGroup[]): Promise<void> {
        await this.memento.update(sessionGroupsKey(this.workspaceFolder()), groups);
    }

    getSessionSectionCollapseState(): SessionSectionCollapseState {
        return readSectionCollapseState(this.memento.get<unknown>(sessionSectionCollapseStateKey(this.workspaceFolder())));
    }

    async setSessionSectionCollapseState(state: SessionSectionCollapseState): Promise<void> {
        await this.memento.update(sessionSectionCollapseStateKey(this.workspaceFolder()), state);
    }

    getCollapsedPanelSections(): PanelSection[] {
        return readCollapsedPanelSections(this.memento.get<unknown>(COLLAPSED_PANEL_SECTIONS_KEY));
    }

    async setCollapsedPanelSections(sections: readonly PanelSection[]): Promise<void> {
        await this.memento.update(COLLAPSED_PANEL_SECTIONS_KEY, readCollapsedPanelSections(sections));
    }
}

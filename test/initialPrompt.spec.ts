/**
 * A draft handed to a new conversation reaches the composer (found by the
 * Phase 3 harness pass, 2026-09-24).
 *
 * "Fork conversation from here" on the first message starts a new
 * conversation with that prompt in the composer (the official
 * `onCreateNewSession`: `createSession().then(V1 => { V1.initialPrompt.value = C … })`).
 * The chat consumed `initialPrompt` in a Vue `watch` whose getter read the
 * alien-signals signal directly. Vue cannot track that read, so the watch ran
 * only when the active session changed -- before the prompt was set -- and the
 * draft was lost. It now reads the prompt through `useSession`'s Vue ref.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectScope, nextTick, watch } from 'vue';
import { signal } from 'alien-signals';
import { useSignal } from '@gn8/alien-signals-vue';

describe('initialPrompt set after the session is already active', () => {
  it('is seen through the Vue ref, and was missed through the raw signal', async () => {
    const initialPrompt = signal<string | undefined>(undefined);
    const seenViaRef: Array<string | undefined> = [];
    const seenViaSignal: Array<string | undefined> = [];
    const scope = effectScope();
    scope.run(() => {
      const ref = useSignal(initialPrompt);
      watch(() => ref.value, (value) => seenViaRef.push(value));
      watch(() => initialPrompt(), (value) => seenViaSignal.push(value));
    });

    initialPrompt('Is this the same chatbox as the Claude Code one?');
    await nextTick();
    await nextTick();

    expect(seenViaRef).toEqual(['Is this the same chatbox as the Claude Code one?']);
    expect(seenViaSignal).toEqual([]);
    scope.stop();
  });

  it('the chat watches the ref', () => {
    const page = readFileSync(join(__dirname, '../src/webview/src/pages/ChatPage.vue'), 'utf8');
    expect(page).toMatch(/watch\(\s*\(\) => session\.value\?\.initialPrompt\.value,/);
    expect(page).not.toMatch(/watch\(\s*\(\) => activeSessionRaw\.value\?\.initialPrompt\(\),/);
    const composable = readFileSync(join(__dirname, '../src/webview/src/composables/useSession.ts'), 'utf8');
    expect(composable).toMatch(/const initialPrompt = useSignal\(session\.initialPrompt\);/);
  });
});

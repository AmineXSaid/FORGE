import { ref } from 'vue';

/**
 * First-run state, as the official webview keeps it: a localStorage flag set the
 * first time a message is sent. Until then the empty state shows its fixed
 * opening tip and the composer asks "Ask Forge to edit…"; afterwards the tips
 * rotate and the composer names its focus shortcut instead.
 */
export const FIRST_RUN_KEY = 'forge-vscode-first-run-bypassed';

function read(): boolean {
  try {
    return globalThis.localStorage?.getItem(FIRST_RUN_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Reactive, so everything reading it updates the moment the first message goes out. */
export const firstRunBypassed = ref(read());

export function isFirstRunBypassed(): boolean {
  return firstRunBypassed.value;
}

export function markFirstRunBypassed(): void {
  firstRunBypassed.value = true;
  try {
    globalThis.localStorage?.setItem(FIRST_RUN_KEY, 'true');
  } catch {
    // Storage can be unavailable in a locked-down webview; the state still holds for this view.
  }
}

// Another Forge view sending its first message flips this one too.
globalThis.addEventListener?.('storage', (event: StorageEvent) => {
  if (event.key === FIRST_RUN_KEY) firstRunBypassed.value = event.newValue === 'true';
});

/** Platform names arrive as Node's (win32, darwin) or the official host's (windows, macos). */
export const isWindowsPlatform = (platform: string | undefined) => platform === 'win32' || platform === 'windows';
export const isMacPlatform = (platform: string | undefined) =>
  platform === 'darwin' || platform === 'macos' || platform === 'mac';

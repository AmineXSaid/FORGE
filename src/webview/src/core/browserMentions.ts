/**
 * Step 28: the webview half of @browser mentions, ported from the official
 * `Oj0` (index.js @3455450) and the instruction text `Aj0` (@3448888).
 *
 * The official resolves `@browser` mentions at **send** time, not at type
 * time: `send` passes `ensureChromeMcpEnabled` and `createNewBrowserTab` into
 * its content builder (`dR1`, @3495800), both gated on
 * `config.browserIntegrationSupported`.
 *
 *   async function Oj0($,J,Z){
 *     let Y=/@browser(?:(?::([^:]*):(\d+):([^\s]*))|:new_tab|(?=\s|$))/g,
 *         X=[...$.matchAll(Y)];
 *     if(X.length===0)return[];
 *     let Q=[];
 *     if(await J())Q.push({type:"text",text:`<browser_instruction>${mR1()}</browser_instruction>`});
 *     for(let z of X){
 *       let q=z[1]??"",U=z[2]??"0",V=z[3]??"";
 *       if(q===""&&U==="0"){let W=await Z();q=W.tabGroupId,U=String(W.tabId)}
 *       if(!q||!U)continue;
 *       Q.push({type:"text",text:`<browser tabGroupId="${q}" tabId="${U}">${V}</browser>`})}
 *     return Q}
 *
 * Two details worth naming, because they are easy to get wrong:
 * - the instruction block is pushed only when `ensureChromeMcpEnabled()`
 *   answers truthy, and the session's wrapper resolves it to `wasDisabled` --
 *   so the long prompt is sent once, on the turn that first connects the
 *   browser, not on every turn;
 * - a bare `@browser:` (no ids) is the "make me a tab" form: it falls into
 *   `q===""&&U==="0"` and calls `createNewBrowserTab()`.
 */

/** The official `Aj0`, returned by `mR1()`, verbatim. */
export const BROWSER_INSTRUCTION = [
  "# Claude in Chrome browser automation",
  "",
  "You have access to browser automation tools (mcp__claude-in-chrome__*) for interacting with web pages in Chrome. Follow these guidelines for effective browser automation.",
  "",
  "## Loading deferred tools",
  "",
  "If the mcp__claude-in-chrome__* tools are deferred (must be loaded via ToolSearch before use), load every tool you expect to need in ONE ToolSearch call — the select query accepts a comma-separated list — never one call per tool. Start with the core set:",
  "",
  "ToolSearch with query \"select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp\"",
  "",
  "Add task-specific tools to the same call when the task obviously needs them: read_console_messages / read_network_requests for debugging, form_input for forms, gif_creator for recordings, javascript_tool for page scripting.",
  "",
  "## GIF recording",
  "",
  "When performing multi-step browser interactions that the user may want to review or share, use mcp__claude-in-chrome__gif_creator to record them.",
  "",
  "You must ALWAYS:",
  "* Capture extra frames before and after taking actions to ensure smooth playback",
  "* Name the file meaningfully to help the user identify it later (e.g., \"login_process.gif\")",
  "",
  "## Console log debugging",
  "",
  "You can use mcp__claude-in-chrome__read_console_messages to read console output. Console output may be verbose. If you are looking for specific log entries, use the 'pattern' parameter with a regex-compatible pattern. This filters results efficiently and avoids overwhelming output. For example, use pattern: \"[MyApp]\" to filter for application-specific logs rather than reading all console output.",
  "",
  "## Alerts and dialogs",
  "",
  "IMPORTANT: Do not trigger JavaScript alerts, confirms, prompts, or browser modal dialogs through your actions. These browser dialogs block all further browser events and will prevent the extension from receiving any subsequent commands. Instead, when possible, use console.log for debugging and then use the mcp__claude-in-chrome__read_console_messages tool to read those log messages. If a page has dialog-triggering elements:",
  "1. Avoid clicking buttons or links that may trigger alerts (e.g., \"Delete\" buttons with confirmation dialogs)",
  "2. If you must interact with such elements, warn the user first that this may interrupt the session",
  "3. Use mcp__claude-in-chrome__javascript_tool to check for and dismiss any existing dialogs before proceeding",
  "",
  "If you accidentally trigger a dialog and lose responsiveness, inform the user they need to manually dismiss it in the browser.",
  "",
  "## Avoid rabbit holes and loops",
  "",
  "When using browser automation tools, stay focused on the specific task. If you encounter any of the following, stop and ask the user for guidance:",
  "- Unexpected complexity or tangential browser exploration",
  "- Browser tool calls failing or returning errors after 2-3 attempts",
  "- No response from the browser extension",
  "- Page elements not responding to clicks or input",
  "- Pages not loading or timing out",
  "- Unable to complete the browser task despite multiple approaches",
  "",
  "Explain what you attempted, what went wrong, and ask how the user would like to proceed. Do not keep retrying the same failing browser action or explore unrelated pages without checking in first.",
  "",
  "## Tab context and session startup",
  "",
  "IMPORTANT: At the start of each browser automation session, call mcp__claude-in-chrome__tabs_context_mcp first to get information about the user's current browser tabs. Use this context to understand what the user might want to work with before creating new tabs.",
  "",
  "Never reuse tab IDs from a previous/other session. Follow these guidelines:",
  "1. Only reuse an existing tab if the user explicitly asks to work with it",
  "2. Otherwise, create a new tab with mcp__claude-in-chrome__tabs_create_mcp",
  "3. If a tool returns an error indicating the tab doesn't exist or is invalid, call tabs_context_mcp to get fresh tab IDs",
  "4. When a tab is closed by the user or a navigation error occurs, call tabs_context_mcp to see what tabs are available",
].join('\n');

/** The official regex, character for character. */
export const BROWSER_MENTION_PATTERN = /@browser(?:(?::([^:]*):(\d+):([^\s]*))|:new_tab|(?=\s|$))/g;

/**
 * A browser mention that could not be attached, with the reason in words
 * (production audit, Phase 6, item 4). The official swallows it: its composer
 * catches the failed `send` and says nothing, so the message simply does not
 * go. Forge shows `message` in the chat's error banner and gives the typed text
 * back to the composer.
 */
export class BrowserAttachError extends Error {
  constructor(readonly reason: string) {
    super(`Couldn't attach a browser tab: ${reason}`);
    this.name = 'BrowserAttachError';
  }
}

/**
 * The reason, as the host words it. Its request errors arrive as the thrown
 * message; "Failed to create new tab: " is the host's own prefix, and the
 * sentence after it is the browser server's.
 */
export function browserAttachReason(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error ?? '')).replace(/^(\w*Error):\s*/, '').trim();
  const reason = raw.replace(/^Failed to create new tab:\s*/, '').trim();
  return reason || 'the browser did not answer.';
}

export interface BrowserTextBlock {
  type: 'text';
  text: string;
}

/**
 * The official `Oj0`. `ensureChromeMcpEnabled` returning true means the browser
 * was not connected before this turn, so the instruction block is due.
 */
export async function browserMentionBlocks(
  input: string,
  ensureChromeMcpEnabled: () => Promise<boolean>,
  createNewBrowserTab: () => Promise<{ tabGroupId: string; tabId: number }>
): Promise<BrowserTextBlock[]> {
  const matches = [...input.matchAll(BROWSER_MENTION_PATTERN)];
  if (matches.length === 0) return [];

  const blocks: BrowserTextBlock[] = [];
  let connected: boolean;
  try {
    connected = await ensureChromeMcpEnabled();
  } catch (error) {
    throw new BrowserAttachError(browserAttachReason(error));
  }
  if (connected) {
    blocks.push({ type: 'text', text: `<browser_instruction>${BROWSER_INSTRUCTION}</browser_instruction>` });
  }
  for (const match of matches) {
    let tabGroupId = match[1] ?? '';
    let tabId = match[2] ?? '0';
    const text = match[3] ?? '';
    if (tabGroupId === '' && tabId === '0') {
      let tab: { tabGroupId: string; tabId: number };
      try {
        tab = await createNewBrowserTab();
      } catch (error) {
        throw new BrowserAttachError(browserAttachReason(error));
      }
      tabGroupId = tab.tabGroupId;
      tabId = String(tab.tabId);
    }
    if (!tabGroupId || !tabId) continue;
    blocks.push({ type: 'text', text: `<browser tabGroupId="${tabGroupId}" tabId="${tabId}">${text}</browser>` });
  }
  return blocks;
}

/**
 * `open_claude_in_terminal`: the official `JI0` validator and the command line
 * `claude-vscode.terminal.open` builds (`Qd0` -> `Ja$` / `za$` / `az`).
 *
 * The rejections carry the weight. The webview is untrusted input, and this
 * request is the one that puts a string in front of a shell, so anything that is
 * not a bare slash command or `--resume <session id>` has to be refused before a
 * terminal exists.
 */
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
// Static, so its cold import (the whole handler module) is not timed as a test.
import { handleOpenClaudeInTerminal } from '../src/services/claude/handlers/handlers';
import {
  INVALID_REQUEST_MESSAGE,
  SET_UP_ENDPOINT_ACTION,
  TERMINAL_NEEDS_ENDPOINT,
  terminalEnvironment,
  SLASH_COMMAND_RE,
  TerminalLaunchError,
  UNQUOTABLE_FOR_CMD_MESSAGE,
  UNQUOTABLE_ARGUMENT_FOR_CMD_MESSAGE,
  basenameKey,
  quoteArgument,
  buildCommandLine,
  detectWindowsShell,
  isTerminalLocation,
  isUnusableProfilePath,
  isValidOpenClaudeInTerminalRequest,
  quoteExecutable,
  launchCommand,
  readDefaultProfile,
  shellKindFromBasename,
  shellQuote,
  shouldDisposeAfterExecution,
  terminalPlacement,
  validateSessionId,
} from '../src/services/claude/terminalLaunch';

const SESSION = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('JI0: what the webview may ask for', () => {
  it('accepts an empty payload (the login screen sends no arguments at all)', () => {
    expect(isValidOpenClaudeInTerminalRequest({})).toBe(true);
  });

  it('accepts the "/" row: no prompt, no args', () => {
    expect(isValidOpenClaudeInTerminalRequest({ prompt: undefined, args: undefined })).toBe(true);
  });

  it('accepts a bare slash command', () => {
    for (const prompt of ['/fast', '/review', '/a', '/security-review', '/x-y-z']) {
      expect(isValidOpenClaudeInTerminalRequest({ prompt })).toBe(true);
    }
  });

  it('accepts an empty args array, and --resume with a session id', () => {
    expect(isValidOpenClaudeInTerminalRequest({ args: [] })).toBe(true);
    expect(isValidOpenClaudeInTerminalRequest({ args: ['--resume', SESSION] })).toBe(true);
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '/fast', args: ['--resume', SESSION] })).toBe(true);
  });

  it('accepts the terminal-kickback shape: a slash command with []', () => {
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '/login', args: [] })).toBe(true);
  });

  it('rejects a shell injection dressed as a slash command', () => {
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '/x; rm' })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '/x && curl evil.sh' })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '/x`whoami`' })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '/x $(id)' })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ prompt: "/x'" })).toBe(false);
  });

  it('rejects a prompt that is not a slash command', () => {
    expect(isValidOpenClaudeInTerminalRequest({ prompt: 'hello' })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '' })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '/' })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '/Review' })).toBe(false); // uppercase
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '/9lives' })).toBe(false); // digit first
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '/-x' })).toBe(false); // dash first
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '/a b' })).toBe(false); // space
    expect(isValidOpenClaudeInTerminalRequest({ prompt: '//x' })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ prompt: `/a${'b'.repeat(64)}` })).toBe(false); // 64 chars after the first
  });

  it('rejects a prompt that is not a string', () => {
    for (const prompt of [null, 42, {}, ['/fast'], true]) {
      expect(isValidOpenClaudeInTerminalRequest({ prompt })).toBe(false);
    }
  });

  it('rejects unknown flags and extra args', () => {
    expect(isValidOpenClaudeInTerminalRequest({ args: ['--dangerously-skip-permissions'] })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ args: ['--settings', '/tmp/evil.json'] })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ args: ['--resume'] })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ args: ['--resume', SESSION, '--print'] })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ args: ['-r', SESSION] })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ args: ['resume', SESSION] })).toBe(false);
  });

  it('rejects a --resume value that is not a session id', () => {
    expect(isValidOpenClaudeInTerminalRequest({ args: ['--resume', '../x'] })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ args: ['--resume', '../../etc/passwd'] })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ args: ['--resume', `${SESSION}/../x`] })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ args: ['--resume', ''] })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ args: ['--resume', SESSION.replace('-', '')] })).toBe(false);
    expect(isValidOpenClaudeInTerminalRequest({ args: ['--resume', null] })).toBe(false);
  });

  it('rejects args that are not an array', () => {
    for (const args of [null, '--resume', 42, { 0: '--resume' }]) {
      expect(isValidOpenClaudeInTerminalRequest({ args })).toBe(false);
    }
  });

  it('carries the official error message', () => {
    expect(INVALID_REQUEST_MESSAGE).toBe(
      'open_claude_in_terminal: only a bare slash command and --resume <session id> can be passed from the webview'
    );
  });
});

describe('y0 / SD0: session ids', () => {
  it('accepts a uuid in either case', () => {
    expect(validateSessionId(SESSION)).toBe(SESSION);
    expect(validateSessionId(SESSION.toUpperCase())).toBe(SESSION.toUpperCase());
  });

  it('rejects anything else', () => {
    for (const id of ['', 'not-a-uuid', `${SESSION} `, ` ${SESSION}`, 42, null, undefined]) {
      expect(validateSessionId(id)).toBeNull();
    }
  });

  it('is not a global regex, so repeated calls agree', () => {
    expect(validateSessionId(SESSION)).not.toBeNull();
    expect(validateSessionId(SESSION)).not.toBeNull();
    expect(SLASH_COMMAND_RE.test('/fast')).toBe(true);
    expect(SLASH_COMMAND_RE.test('/fast')).toBe(true);
  });
});

describe('$d0: location', () => {
  it('accepts the three official values', () => {
    expect(isTerminalLocation('bottom')).toBe(true);
    expect(isTerminalLocation('window')).toBe(true);
    expect(isTerminalLocation('beside')).toBe(true);
  });

  it('rejects anything else, which the official turns into undefined', () => {
    for (const value of ['panel', '', null, 42, {}]) {
      expect(isTerminalLocation(value)).toBe(false);
    }
  });

  it('maps to the official placement', () => {
    expect(terminalPlacement('bottom')).toBe('panel');
    expect(terminalPlacement('window')).toBe('one');
    expect(terminalPlacement('beside')).toBe('beside');
    expect(terminalPlacement(undefined)).toBe('beside');
  });
});

describe('az: POSIX quoting', () => {
  it('passes safe characters through', () => {
    expect(shellQuote(['--resume', SESSION])).toBe(`--resume ${SESSION}`);
    expect(shellQuote(['/security-review'])).toBe('/security-review');
  });

  it('quotes an empty string and anything with a space', () => {
    expect(shellQuote([''])).toBe("''");
    expect(shellQuote(['a b'])).toBe("'a b'");
  });

  it('closes and reopens the quote around a single quote', () => {
    expect(shellQuote(["it's"])).toBe(`'it'"'"'s'`);
  });

  it('leaves every JI0-accepted argument untouched, so the shell does not matter', () => {
    const accepted = ['--resume', SESSION, '/fast', '/security-review', '/a-b-c'];
    for (const value of accepted) expect(shellQuote([value])).toBe(value);
  });
});

describe('za$: the command line', () => {
  const exe = '"C:\\ext\\resources\\native-binary\\claude.exe"';

  it('is the executable alone when there is nothing to pass', () => {
    expect(buildCommandLine(exe)).toBe(exe);
    expect(buildCommandLine(exe, [])).toBe(exe);
    expect(buildCommandLine(exe, [], undefined)).toBe(exe);
  });

  it('puts the args first and the prompt last', () => {
    expect(buildCommandLine(exe, ['--resume', SESSION])).toBe(`${exe} --resume ${SESSION}`);
    expect(buildCommandLine(exe, [], '/fast')).toBe(`${exe} /fast`);
    expect(buildCommandLine(exe, ['--resume', SESSION], '/fast')).toBe(`${exe} --resume ${SESSION} /fast`);
  });
});

describe('Ja$: quoting Forge\'s own binary for the shell', () => {
  const win = 'C:\\Users\\me\\.vscode\\extensions\\forge\\resources\\native-binary\\claude.exe';
  const posix = '/home/me/.vscode/extensions/forge/resources/native-binary/claude';

  it('uses POSIX quoting off Windows', () => {
    expect(quoteExecutable('darwin', posix, 'unknown')).toBe(posix);
    expect(quoteExecutable('linux', '/opt/my apps/claude', 'unknown')).toBe("'/opt/my apps/claude'");
  });

  it('uses the call operator in PowerShell, so a quoted path is executed and not printed', () => {
    expect(quoteExecutable('win32', win, 'powershell')).toBe(`& '${win}'`);
  });

  it('doubles a single quote, and the smart quotes PowerShell also treats as quotes', () => {
    expect(quoteExecutable('win32', "C:\\o'brien\\claude.exe", 'powershell')).toBe("& 'C:\\o''brien\\claude.exe'");
    expect(quoteExecutable('win32', 'C:\\a\u2019b\\claude.exe', 'powershell')).toBe(
      "& 'C:\\a\u2019\u2019b\\claude.exe'"
    );
  });

  it('double-quotes for Command Prompt and for a shell it could not identify', () => {
    expect(quoteExecutable('win32', win, 'cmd')).toBe(`"${win}"`);
    expect(quoteExecutable('win32', win, 'unknown')).toBe(`"${win}"`);
  });

  it('uses POSIX quoting for Git Bash on Windows', () => {
    expect(quoteExecutable('win32', win, 'bash')).toBe(`'${win}'`);
  });

  it('refuses a cmd launch it cannot quote, rather than running the wrong thing', () => {
    const percent = 'C:\\100%\\claude.exe';
    expect(() => quoteExecutable('win32', percent, 'cmd')).toThrow(TerminalLaunchError);
    expect(() => quoteExecutable('win32', percent, 'cmd')).toThrow(UNQUOTABLE_FOR_CMD_MESSAGE);
    expect(() => quoteExecutable('win32', 'C:\\a!b\\claude.exe', 'unknown')).toThrow(TerminalLaunchError);
    // PowerShell and bash quote those paths fine, so they are not blocked.
    expect(() => quoteExecutable('win32', percent, 'powershell')).not.toThrow();
    expect(() => quoteExecutable('win32', percent, 'bash')).not.toThrow();
  });
});

describe('Qa$: which Windows shell the default profile starts', () => {
  it('trusts an explicit profile source', () => {
    expect(detectWindowsShell({ profileSource: 'PowerShell' })).toBe('powershell');
    expect(detectWindowsShell({ profileSource: 'Git Bash' })).toBe('bash');
  });

  it('reads the profile path', () => {
    expect(detectWindowsShell({ profilePath: 'C:\\WINDOWS\\System32\\cmd.exe' })).toBe('cmd');
    expect(detectWindowsShell({ profilePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' })).toBe('powershell');
    expect(detectWindowsShell({ profilePath: 'C:\\Program Files\\Git\\bin\\bash.exe' })).toBe('bash');
  });

  it('accepts a path list and a {path} object, as VS Code allows', () => {
    expect(detectWindowsShell({ profilePath: ['C:\\a\\pwsh.exe', 'C:\\b\\powershell.exe'] })).toBe('powershell');
    expect(detectWindowsShell({ profilePath: { path: 'C:\\WINDOWS\\System32\\cmd.exe' } })).toBe('cmd');
  });

  it('prefers powershell when a mixed list disagrees', () => {
    expect(detectWindowsShell({ profilePath: ['C:\\a\\cmd.exe', 'C:\\b\\pwsh.exe'] })).toBe('powershell');
  });

  it('treats a ${env:...} path and an 8.3 short name as powershell', () => {
    expect(detectWindowsShell({ profilePath: '${env:windir}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' })).toBe(
      'powershell'
    );
    expect(detectWindowsShell({ profilePath: 'C:\\PROGRA~1\\somesh.exe' })).toBe('unknown');
    expect(detectWindowsShell({ profilePath: 'C:\\x\\LONGNA~1.exe' })).toBe('powershell');
  });

  it('falls back to the built-in profile name when no path identifies it', () => {
    expect(detectWindowsShell({ profileName: 'Windows PowerShell' })).toBe('powershell');
    expect(detectWindowsShell({ profileName: 'Command Prompt' })).toBe('cmd');
    expect(detectWindowsShell({ profileName: 'Git Bash' })).toBe('bash');
    expect(detectWindowsShell({ profileName: 'Ubuntu (WSL)' })).toBe('bash');
  });

  it('ignores the built-in name once a profiles entry has been read', () => {
    expect(detectWindowsShell({ profileName: 'Command Prompt', suppressBuiltinName: true })).toBe('powershell');
  });

  it('falls back to vscode.env.shell, then to powershell', () => {
    expect(detectWindowsShell({ envShell: 'C:\\WINDOWS\\System32\\cmd.exe' })).toBe('cmd');
    expect(detectWindowsShell({ envShell: 'C:\\Program Files\\Git\\bin\\bash.exe' })).toBe('bash');
    expect(detectWindowsShell({})).toBe('powershell');
    expect(detectWindowsShell({ envShell: '' })).toBe('powershell');
    expect(detectWindowsShell({ envShell: 'C:\\x\\nushell.exe' })).toBe('unknown');
  });

  it('drops a profile path VS Code could not run', () => {
    expect(detectWindowsShell({ profilePath: 'C:\\a\\cmd?.exe', profileName: 'Windows PowerShell' })).toBe('powershell');
    expect(isUnusableProfilePath('C:\\a\\b|c')).toBe(true);
    expect(isUnusableProfilePath('C:\\a\\b\u0001c')).toBe(true);
    expect(isUnusableProfilePath('C:\\a\\b:c')).toBe(true);
    expect(isUnusableProfilePath('C:\\WINDOWS\\System32\\cmd.exe')).toBe(false);
  });

  it('reduces a path to a comparable basename', () => {
    expect(basenameKey('C:\\WINDOWS\\System32\\CMD.EXE')).toBe('cmd.exe');
    expect(basenameKey('/usr/bin/zsh')).toBe('zsh');
    expect(basenameKey('C:\\a\\b.exe. ')).toBe('b.exe');
    expect(basenameKey(undefined)).toBe('');
  });

  it('classifies a basename', () => {
    expect(shellKindFromBasename('powershell.exe')).toBe('powershell');
    expect(shellKindFromBasename('pwsh')).toBe('powershell');
    expect(shellKindFromBasename('cmd.exe')).toBe('cmd');
    expect(shellKindFromBasename('wsl.exe')).toBe('bash');
    expect(shellKindFromBasename('nu.exe')).toBe('unknown');
    expect(shellKindFromBasename('.exe')).toBe('unknown');
  });
});

describe('tn$: reading the default profile out of settings', () => {
  it('returns nothing when the default profile is unset or absent', () => {
    expect(readDefaultProfile({ 'Command Prompt': {} }, undefined)).toEqual({});
    expect(readDefaultProfile({ 'Command Prompt': {} }, 'PowerShell')).toEqual({});
    expect(readDefaultProfile(null, 'PowerShell')).toEqual({});
  });

  it('takes a known source, and suppresses the built-in name either way', () => {
    expect(readDefaultProfile({ mine: { source: 'PowerShell' } }, 'mine')).toEqual({
      suppressBuiltinName: true,
      profileSource: 'PowerShell',
    });
    expect(readDefaultProfile({ mine: { source: 'Something Else' } }, 'mine')).toEqual({ suppressBuiltinName: true });
  });

  it('takes a path when there is no source', () => {
    expect(readDefaultProfile({ mine: { path: 'C:\\x\\pwsh.exe' } }, 'mine')).toEqual({
      suppressBuiltinName: true,
      profilePath: 'C:\\x\\pwsh.exe',
    });
  });

  it('does not read through the prototype chain', () => {
    expect(readDefaultProfile({}, 'toString')).toEqual({});
  });
});

describe('Ya$: disposing the terminal once the command has finished', () => {
  const quoted = '"C:\\ext\\claude.exe"';
  const bare = '/home/me/claude';

  it('never disposes on a non-zero exit', () => {
    expect(shouldDisposeAfterExecution(bare, bare, 1)).toBe(false);
    expect(shouldDisposeAfterExecution(bare, bare, undefined)).toBe(false);
  });

  it('disposes when the shell reports back the command that was sent', () => {
    expect(shouldDisposeAfterExecution(bare, bare, 0)).toBe(true);
    expect(shouldDisposeAfterExecution('claude --resume x', 'anything', 0)).toBe(true);
  });

  it('leaves a quoted command line alone, and one the shell rewrote', () => {
    expect(shouldDisposeAfterExecution(quoted, quoted, 0)).toBe(false);
    expect(shouldDisposeAfterExecution('something else', bare, 0)).toBe(false);
  });
});

describe('the terminal runs on the chat`s endpoint', () => {
  // Reported: "when chatting with the extension I got the msg please login".
  // The terminal was started with no endpoint environment, and the CLI with
  // no key and no relay answers "Not logged in · Please run /login".
  const RELAY = {
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:5555',
    ANTHROPIC_AUTH_TOKEN: 'relay-token',
    ANTHROPIC_API_KEY: 'relay-token',
    ANTHROPIC_MODEL: 'qwen3-coder',
  };

  it('gets the relay address, token and model', async () => {
    expect(terminalEnvironment(RELAY, {})).toMatchObject({ ...RELAY, ANTHROPIC_API_KEY: null, NoDefaultCurrentDirectoryInExePath: '1' });
  });

  it('keeps the user`s own variables, but no API key: the interactive CLI asks about one', async () => {
    // "Detected a custom API key in your environment · Do you want to use this
    // API key? › No (recommended)": the recommended answer left the terminal
    // without the relay. The auth token is never asked about.
    const env = terminalEnvironment(RELAY, { ANTHROPIC_API_KEY: 'sk-ant-old', MY_FLAG: '1' });
    expect(env.ANTHROPIC_API_KEY).toBeNull();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('relay-token');
    expect(env.MY_FLAG).toBe('1');
  });

  it('passes a stated context window to the CLI, and no guess', async () => {
    expect(terminalEnvironment(RELAY, {}, {}, 131072).CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('131072');
    expect(terminalEnvironment(RELAY, {}, {})).not.toHaveProperty('CLAUDE_CODE_MAX_CONTEXT_TOKENS');
  });

  // The welcome page's `$ forge` chip sends this request while there is, by
  // definition, no endpoint. It must lead to a working terminal, never to a CLI
  // that can only ask for a login.
  const written: { file: string; data: string }[] = [];
  function noEndpointContext(afterSetup: Record<string, string>) {
    let env: Record<string, string> = {};
    const createTerminal = vi.fn(() => ({ dispose() {}, sendText() {}, show() {}, shellIntegration: undefined }));
    const context = {
      logService: { info: () => {}, warn: () => {}, error: () => {} },
      sdkService: { resolveClaudeExecutablePath: () => 'C:/forge/claude.exe', asAbsolutePath: (p: string) => p },
      terminalService: { createTerminal },
      endpointService: { getEnvironment: async () => env },
      configService: { getEnvironmentVariables: async () => ({}) },
    } as any;
    // The terminal events the handler subscribes to once a terminal exists.
    const w = vscode.window as any;
    for (const event of ['onDidEndTerminalShellExecution', 'onDidChangeTerminalShellIntegration', 'onDidCloseTerminal']) {
      w[event] ??= () => ({ dispose() {} });
    }
    // The terminal's --settings file is written beside forge.json; keep the
    // real home directory out of the tests.
    written.length = 0;
    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify({ env: { FROM_FORGE_JSON: '1' } }) as never);
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (file: any, data: any) => {
      written.push({ file: String(file), data: String(data) });
    });
    const ranSetup = vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (command: string) => {
      if (command === 'forge.addEndpoint') env = afterSetup;
      return undefined;
    });
    return { context, createTerminal, ranSetup };
  }

  it('with no endpoint, offers the setup and starts no CLI when that is dismissed', async () => {
    const offer = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as never);
    const { context, createTerminal, ranSetup } = noEndpointContext(RELAY);
    expect(await handleOpenClaudeInTerminal({ type: 'open_claude_in_terminal' } as any, context)).toEqual({
      type: 'open_claude_in_terminal_response',
    });
    expect(offer).toHaveBeenCalledWith(TERMINAL_NEEDS_ENDPOINT, SET_UP_ENDPOINT_ACTION);
    expect(ranSetup).not.toHaveBeenCalledWith('forge.addEndpoint');
    expect(createTerminal).not.toHaveBeenCalled();
    offer.mockRestore();
    ranSetup.mockRestore();
  });

  it('runs the setup when asked, then opens the terminal on the endpoint it saved', async () => {
    const offer = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(SET_UP_ENDPOINT_ACTION as never);
    const { context, createTerminal, ranSetup } = noEndpointContext(RELAY);
    await handleOpenClaudeInTerminal({ type: 'open_claude_in_terminal' } as any, context);
    expect(ranSetup).toHaveBeenCalledWith('forge.addEndpoint');
    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect((createTerminal.mock.calls[0] as any)[0].env).toMatchObject({ ...RELAY, ANTHROPIC_API_KEY: null });
    offer.mockRestore();
    ranSetup.mockRestore();
  });

  it('opens the terminal branded as Forge: banner, settings file and status-line env', async () => {
    const offer = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(SET_UP_ENDPOINT_ACTION as never);
    const { context, createTerminal, ranSetup } = noEndpointContext(RELAY);
    await handleOpenClaudeInTerminal({ type: 'open_claude_in_terminal', args: ['--resume', SESSION] } as any, context);
    const options = (createTerminal.mock.calls[0] as any)[0];

    // The banner VS Code writes before the shell starts.
    expect(options.message).toContain('Forge');
    expect(options.message).toContain('qwen3-coder');
    // The status line reads these.
    expect(options.env).toHaveProperty('FORGE_ENDPOINT');
    expect(options.env).toHaveProperty('FORGE_AGENT');

    // The settings file: forge.json's content, with the branding on top.
    const settings = written.find((w) => w.file.endsWith('forge-terminal.json'));
    expect(settings).toBeDefined();
    const json = JSON.parse(settings!.data);
    expect(json.env).toEqual({ FROM_FORGE_JSON: '1' });
    expect(json.spinnerVerbs.mode).toBe('replace');
    expect(json.statusLine.command).toContain('statusline.js');
    offer.mockRestore();
    ranSetup.mockRestore();
    vi.restoreAllMocks();
  });

  it('opens nothing when the setup saves nothing', async () => {
    const offer = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(SET_UP_ENDPOINT_ACTION as never);
    const { context, createTerminal, ranSetup } = noEndpointContext({});
    await handleOpenClaudeInTerminal({ type: 'open_claude_in_terminal' } as any, context);
    expect(ranSetup).toHaveBeenCalledWith('forge.addEndpoint');
    expect(createTerminal).not.toHaveBeenCalled();
    offer.mockRestore();
    ranSetup.mockRestore();
  });
});

describe('launchCommand: the CLI and its settings file, by variable', () => {
  it('reads both paths from the environment, in each shell\'s syntax', () => {
    expect(launchCommand('linux', 'unknown')).toBe('command "$FORGE_CLAUDE" --settings "$FORGE_SETTINGS"');
    expect(launchCommand('darwin', 'unknown')).toBe('command "$FORGE_CLAUDE" --settings "$FORGE_SETTINGS"');
    expect(launchCommand('win32', 'bash')).toBe('command "$FORGE_CLAUDE" --settings "$FORGE_SETTINGS"');
    expect(launchCommand('win32', 'powershell')).toBe('& $env:FORGE_CLAUDE --settings $env:FORGE_SETTINGS');
    expect(launchCommand('win32', 'cmd')).toBe('"%FORGE_CLAUDE%" --settings "%FORGE_SETTINGS%"');
    expect(launchCommand('win32', 'unknown')).toBe('"%FORGE_CLAUDE%" --settings "%FORGE_SETTINGS%"');
  });

  it('is one short line whatever the paths are, and closes the terminal after a clean exit', () => {
    for (const shell of ['unknown', 'bash', 'powershell'] as const) {
      const line = launchCommand(shell === 'unknown' ? 'linux' : 'win32', shell);
      expect(line.length).toBeLessThan(60);
      expect(shouldDisposeAfterExecution(line, line, 0)).toBe(true);
    }
  });
});

describe('quoteArgument: a host-side path for the shell that reads it', () => {
  const PATH = 'C:\\Users\\Ada Lovelace\\.claude\\forge-terminal.json';

  it('uses POSIX quoting off Windows and in Git Bash', () => {
    expect(quoteArgument('linux', '/home/ada lovelace/.claude/forge-terminal.json', 'unknown')).toBe(
      "'/home/ada lovelace/.claude/forge-terminal.json'",
    );
    expect(quoteArgument('win32', PATH, 'bash')).toBe(`'${PATH}'`);
  });

  it('single-quotes for PowerShell, doubling quotes inside', () => {
    expect(quoteArgument('win32', PATH, 'powershell')).toBe(`'${PATH}'`);
    expect(quoteArgument('win32', "C:\\O'Brien\\f.json", 'powershell')).toBe("'C:\\O''Brien\\f.json'");
  });

  it('double-quotes for Command Prompt, and refuses what cmd would expand', () => {
    expect(quoteArgument('win32', PATH, 'cmd')).toBe(`"${PATH}"`);
    for (const bad of ['C:\\100%\\f.json', 'C:\\hi!\\f.json', 'C:\\a"b\\f.json']) {
      expect(() => quoteArgument('win32', bad, 'cmd')).toThrow(TerminalLaunchError);
      expect(() => quoteArgument('win32', bad, 'cmd')).toThrow(UNQUOTABLE_ARGUMENT_FOR_CMD_MESSAGE);
    }
  });
});

// The small-model guards reach the terminal CLI as HTTP hooks (Forge SDK):
// a token in the environment and `--settings <file>` on the command line,
// both added by the host. `off` adds neither.
describe('Open Forge in Terminal: the small-model guards', () => {
  const RELAY = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ANTHROPIC_API_KEY: 'relay-token' };
  async function launch(profile: Record<string, unknown>) {
    vi.useFakeTimers();
    const sendText = vi.fn();
    const createTerminal = vi.fn(() => ({ dispose() {}, sendText, show() {}, shellIntegration: undefined }));
    const context = {
      logService: { info: () => {}, warn: () => {}, error: () => {} },
      sdkService: { resolveClaudeExecutablePath: () => '/opt/forge/claude', asAbsolutePath: (p: string) => p },
      terminalService: { createTerminal },
      endpointService: { getEnvironment: async () => RELAY, getStatus: () => ({ profile }) },
      configService: { getEnvironmentVariables: async () => ({}) },
    } as any;
    const w = vscode.window as any;
    for (const event of ['onDidEndTerminalShellExecution', 'onDidChangeTerminalShellIntegration', 'onDidCloseTerminal']) {
      w[event] ??= () => ({ dispose() {} });
    }
    // The terminal's settings file is written beside forge.json: capture it
    // rather than touch the real home directory. The guards' own hooks file
    // (in the OS temp dir) is written for real and read back through the spy.
    const written: Record<string, string> = {};
    vi.restoreAllMocks();
    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (file: any, data: any) => {
      written[String(file)] = String(data);
    });
    vi.spyOn(fs.promises, 'readFile').mockImplementation((async (file: any, ...rest: any[]) => {
      if (String(file).includes('forge-guards-')) return fs.readFileSync(file, ...(rest as [BufferEncoding]));
      throw new Error('ENOENT');
    }) as any);
    try {
      await handleOpenClaudeInTerminal({ type: 'open_claude_in_terminal' } as any, context);
      await vi.advanceTimersByTimeAsync(3100);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
    const settingsFile = Object.keys(written).find((f) => f.endsWith('forge-terminal.json'));
    return {
      env: (createTerminal.mock.calls[0] as any)[0].env as Record<string, string>,
      command: String(sendText.mock.calls[0]?.[0]),
      settingsFile,
      settings: settingsFile ? JSON.parse(written[settingsFile]) : undefined,
    };
  }

  it('an OpenAI-wire profile (strict): a hook token, and the hooks in the one --settings file', async () => {
    const { env, command, settingsFile, settings } = await launch({ wire: 'openai' });
    expect(env.FORGE_HOOK_TOKEN).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    // One --settings flag, pointing at the terminal's settings file through
    // FORGE_SETTINGS: the echoed command stays one short line.
    expect(command.match(/--settings /g)).toHaveLength(1);
    expect(command).toBe(launchCommand(process.platform, 'unknown'));
    expect(env.FORGE_SETTINGS).toBe(settingsFile);
    expect(env.FORGE_CLAUDE).toBe('/opt/forge/claude');
    expect(settings.hooks.PostToolUse[0].hooks[0]).toMatchObject({ type: 'http', allowedEnvVars: ['FORGE_HOOK_TOKEN'] });
    // The branding travels in the same file.
    expect(settings.spinnerVerbs.mode).toBe('replace');
    expect(JSON.stringify(settings)).not.toContain(env.FORGE_HOOK_TOKEN);
    expect(env).toMatchObject(RELAY);
  });

  it('guards off: no hook token and no hooks, only the branding settings', async () => {
    const { env, settings } = await launch({ wire: 'openai', guards: 'off' });
    expect(env.FORGE_HOOK_TOKEN).toBeUndefined();
    expect(settings.hooks).toBeUndefined();
    expect(settings.statusLine.type).toBe('command');
  });
});

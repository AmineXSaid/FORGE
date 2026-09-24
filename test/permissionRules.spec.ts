/**
 * Step 16: the permission prompt's option 2 with its save destination, and the
 * official permission-rule requests behind the "Permission rules" dialog.
 *
 * Host: `src/services/claude/permissionRules.ts` (the official `nu$`, `Zb`,
 * `BH`, `$j0`, `I8`, `pe.edit`, `listPermissionRulesUntil`, `QI0`, `Rf$`) and
 * the three handlers on `ClaudeAgentService`. Webview: `core/permissionPrompt.ts`
 * (`L45`, `gK1`, `uK1`, `O45`, `S5`) and `core/permissionRules.ts` (`kU0`'s copy
 * and escaping).
 */
import { describe, expect, it, vi } from 'vitest';
import type { PermissionUpdate, SDKControlPermissionRulesState } from '@anthropic-ai/claude-agent-sdk';
import {
  EDITABLE_RULE_DESTINATIONS,
  RETURN_TO_DEFAULT_MODE,
  RULES_REREAD_ATTEMPTS,
  addShowsUp,
  claudeCommand,
  escapeBidiControls as hostEscape,
  filterAnsweredPermissions,
  isEditableRuleDestination,
  isOfferedUpdate,
  isPermissionBehavior,
  isValidAddRequest,
  isValidRemoveRequest,
  listPermissionRulesUntil,
  parseEditOutput,
  readPermissionRules,
  removeShowsUp,
  runPermissionRuleEdit,
  stableStringify,
  type ExecFileLike,
} from '../src/services/claude/permissionRules';
import { buildExtraArgs } from '../src/services/claude/cliArgs';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import {
  DESTINATION_LABELS,
  DESTINATION_STORAGE_KEY,
  DESTINATION_TITLES,
  PROMPT_DESTINATIONS,
  bullet,
  cycleDestination,
  describeSuggestions,
  escapeBidiControls,
  grantsRulesOrDirectories,
  initialDestination,
  oneLine,
  optionTwoLabel,
  optionTwoUpdates,
  sessionModeChange,
  suggestedDestination,
  type LabelPart,
} from '../src/webview/src/core/permissionPrompt';
import {
  canRemove,
  escapeRuleText,
  groupByBehavior,
  initialAddDestination,
  readOnlyReason,
  removedPendingNotice,
  ruleSourceText,
  savedPendingNotice,
  sourceLabel,
} from '../src/webview/src/core/permissionRules';
import { PermissionRequest } from '../src/webview/src/core/PermissionRequest';
import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { EventEmitter } from '../src/webview/src/utils/events';

const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);
const NBSP = String.fromCharCode(0xa0);

const state = (rules: SDKControlPermissionRulesState['rules'] = []): SDKControlPermissionRulesState => ({
  rules,
  workspaceDirectories: [],
  originalCwd: '/work',
  managedOnly: false,
});

// ================================================================== host ===

describe('host: the request checks (nu$, Zb, the shape checks)', () => {
  it('behavior is allow, deny or ask, exactly', () => {
    for (const ok of ['allow', 'deny', 'ask']) expect(isPermissionBehavior(ok)).toBe(true);
    for (const bad of ['Allow', 'ALLOW', '', 'session', 'always', null, undefined, 1, {}, []]) {
      expect(isPermissionBehavior(bad)).toBe(false);
    }
  });

  it('a rule destination is one of the three settings files -- never session or cliArg', () => {
    expect(EDITABLE_RULE_DESTINATIONS).toEqual(['userSettings', 'projectSettings', 'localSettings']);
    for (const ok of EDITABLE_RULE_DESTINATIONS) expect(isEditableRuleDestination(ok)).toBe(true);
    for (const bad of ['session', 'cliArg', 'flagSettings', 'policySettings', 'local', 'user', '', null, undefined]) {
      expect(isEditableRuleDestination(bad)).toBe(false);
    }
  });

  it('add: 1 to 100 strings of at most 10 000 characters, a behavior, a destination', () => {
    expect(isValidAddRequest(['Bash(ls)'], 'allow', 'localSettings')).toBe(true);
    expect(isValidAddRequest(Array(100).fill('Read'), 'deny', 'userSettings')).toBe(true);
    expect(isValidAddRequest(['x'.repeat(10000)], 'ask', 'projectSettings')).toBe(true);
    // The host's check is the shape only; the CLI refuses an empty rule itself.
    expect(isValidAddRequest([''], 'allow', 'localSettings')).toBe(true);
  });

  it('add: every bad shape is refused', () => {
    const cases: [unknown, unknown, unknown][] = [
      [undefined, 'allow', 'localSettings'],
      ['Bash(ls)', 'allow', 'localSettings'],
      [{ 0: 'Bash' }, 'allow', 'localSettings'],
      [[], 'allow', 'localSettings'],
      [Array(101).fill('Read'), 'allow', 'localSettings'],
      [['Read', 3], 'allow', 'localSettings'],
      [['Read', null], 'allow', 'localSettings'],
      [['x'.repeat(10001)], 'allow', 'localSettings'],
      [['Read'], 'always', 'localSettings'],
      [['Read'], undefined, 'localSettings'],
      [['Read'], 'allow', 'session'],
      [['Read'], 'allow', 'cliArg'],
      [['Read'], 'allow', '../../etc'],
      [['Read'], 'allow', undefined],
    ];
    for (const [rules, behavior, destination] of cases) {
      expect(isValidAddRequest(rules, behavior, destination)).toBe(false);
    }
  });

  it('remove: a non-empty string of at most 10 000 characters, a behavior, a source', () => {
    expect(isValidRemoveRequest('Bash(ls)', 'allow', 'localSettings')).toBe(true);
    expect(isValidRemoveRequest('x'.repeat(10000), 'deny', 'projectSettings')).toBe(true);
    const cases: [unknown, unknown, unknown][] = [
      ['', 'allow', 'localSettings'],
      ['x'.repeat(10001), 'allow', 'localSettings'],
      [['Read'], 'allow', 'localSettings'],
      [undefined, 'allow', 'localSettings'],
      ['Read', 'maybe', 'localSettings'],
      ['Read', 'allow', 'session'],
      ['Read', 'allow', 'policySettings'],
    ];
    for (const [rule, behavior, source] of cases) expect(isValidRemoveRequest(rule, behavior, source)).toBe(false);
  });

  it('BH: object keys are sorted, arrays keep their order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(stableStringify({ x: [2, 1] })).toBe('{"x":[2,1]}');
  });
});

describe('host: the write (pe.edit, $j0, I8)', () => {
  it('$j0 reads the last stdout line, keeping only strings', () => {
    expect(parseEditOutput('noise\n{"ok":true,"warnings":["w",3],"stored":["Bash(ls)"]}\n')).toEqual({
      warnings: ['w'],
      stored: ['Bash(ls)'],
    });
    expect(parseEditOutput('not json')).toEqual({ warnings: [], stored: [] });
    expect(parseEditOutput('')).toEqual({ warnings: [], stored: [] });
    expect(parseEditOutput('{"warnings":"no"}')).toEqual({ warnings: [], stored: [] });
  });

  it('I8: a native binary runs its subcommand directly', () => {
    expect(claudeCommand({ pathToClaudeCodeExecutable: '/c/claude.exe', executableArgs: [], env: {} }, ['a'])).toEqual({
      command: '/c/claude.exe',
      args: ['a'],
    });
    expect(claudeCommand({ pathToClaudeCodeExecutable: '/c/cli.js', executableArgs: [], nodePath: '/n/node', env: {} }, ['a'])).toEqual({
      command: '/n/node',
      args: ['/c/cli.js', 'a'],
    });
    expect(claudeCommand({ pathToClaudeCodeExecutable: '/c/x', executableArgs: ['--flag'], env: {} }, ['a'])).toEqual({
      command: '/c/x',
      args: ['--flag', 'a'],
    });
  });

  function fakeExec(result: { error?: any; stdout?: string; stderr?: string }) {
    const calls: { command: string; args: string[]; options: any; stdin?: string }[] = [];
    const exec: ExecFileLike = (command, args, options, callback) => {
      const call: (typeof calls)[number] = { command, args, options };
      calls.push(call);
      setTimeout(() => callback(result.error ?? null, result.stdout ?? '', result.stderr ?? ''), 0);
      return { stdin: { on: () => undefined, end: (data: string) => void (call.stdin = data) } };
    };
    return { exec, calls };
  }
  const binary = { pathToClaudeCodeExecutable: '/bin/claude', executableArgs: [], env: { CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' } };
  const addEdit = { op: 'add' as const, rules: ['Bash(ls)'], behavior: 'allow' as const, destination: 'projectSettings' as const };

  it('runs `claude edit-permission-rules --json` in the cwd with the edit on stdin', async () => {
    const { exec, calls } = fakeExec({ stdout: '{"ok":true,"warnings":[],"stored":["Bash(ls)"]}\n' });
    await expect(runPermissionRuleEdit(binary, addEdit, '/work', exec)).resolves.toEqual({ warnings: [], stored: ['Bash(ls)'] });
    expect(calls[0].command).toBe('/bin/claude');
    expect(calls[0].args).toEqual(['edit-permission-rules', '--json']);
    expect(calls[0].options).toMatchObject({ cwd: '/work', encoding: 'utf-8', timeout: 30000, windowsHide: true, maxBuffer: 1048576 });
    expect(calls[0].options.env.CLAUDE_CODE_ENTRYPOINT).toBe('claude-vscode');
    expect(JSON.parse(calls[0].stdin!)).toEqual(addEdit);
  });

  it("a refusal throws the CLI's own message, without colour codes or 'Error:'", async () => {
    const esc = String.fromCharCode(27);
    const { exec } = fakeExec({
      error: Object.assign(new Error('x'), { code: 1 }),
      stderr: `Error: ${esc}[31m"Read" is already in the allow rules in user settings${esc}[0m\n`,
    });
    await expect(runPermissionRuleEdit(binary, addEdit, '/work', exec)).rejects.toThrow(
      '"Read" is already in the allow rules in user settings'
    );
  });

  it('a silent failure says how it ended', async () => {
    const exit = fakeExec({ error: Object.assign(new Error('x'), { code: 2 }) });
    await expect(runPermissionRuleEdit(binary, addEdit, '/work', exit.exec)).rejects.toThrow(
      'Claude Code could not save the permission rule (exit code 2).'
    );
    const killed = fakeExec({ error: Object.assign(new Error('x'), { killed: true, signal: 'SIGTERM' }) });
    await expect(runPermissionRuleEdit(binary, addEdit, '/work', killed.exec)).rejects.toThrow('(stopped or timed out)');
  });

  it('a missing working directory is named; other spawn errors are rethrown', async () => {
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT', syscall: 'spawn /bin/claude' });
    const gone = fakeExec({ error: enoent });
    await expect(runPermissionRuleEdit(binary, addEdit, '/gone', gone.exec, () => false)).rejects.toThrow(
      'Working directory not found: /gone.'
    );
    const there = fakeExec({ error: enoent });
    await expect(runPermissionRuleEdit(binary, addEdit, '/work', there.exec, () => true)).rejects.toBe(enoent);
  });

  it('no binary, no write', async () => {
    const { exec, calls } = fakeExec({});
    await expect(runPermissionRuleEdit({ ...binary, pathToClaudeCodeExecutable: '' }, addEdit, '/w', exec)).rejects.toThrow(
      'Claude Code is not installed with this extension.'
    );
    expect(calls).toHaveLength(0);
  });
});

describe('host: the re-read (listPermissionRules, listPermissionRulesUntil)', () => {
  it('reads `.state` from query.listPermissionRules(), and refuses a CLI that cannot answer', async () => {
    const s = state();
    await expect(readPermissionRules({ listPermissionRules: async () => ({ state: s }) })).resolves.toBe(s);
    await expect(readPermissionRules({})).rejects.toThrow('cannot list permission rules');
    await expect(readPermissionRules({ listPermissionRules: async () => ({}) })).rejects.toThrow('sent no permission rules');
  });

  it('stops as soon as the change shows, else after 14 more reads 300 ms apart', async () => {
    const before = state();
    const after = state([{ behavior: 'allow', source: 'localSettings', rule: 'Read', editability: 'persistent' }]);
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);

    let reads = 0;
    const third = { listPermissionRules: async () => ({ state: ++reads >= 3 ? after : before }) };
    const found = await listPermissionRulesUntil(third, before, (s) => s.rules.length === 1, sleep);
    expect(found).toEqual({ state: after, changed: true });
    expect(reads).toBe(3);
    expect(sleeps).toEqual([300, 300]);

    reads = 0;
    sleeps.length = 0;
    const never = { listPermissionRules: async () => (reads++, { state: before }) };
    const pending = await listPermissionRulesUntil(never, before, (s) => s.rules.length === 1, sleep);
    expect(pending).toEqual({ state: before, changed: false });
    expect(reads).toBe(RULES_REREAD_ATTEMPTS + 1);
    expect(sleeps).toHaveLength(14);
  });

  it('a failed re-read falls back to the state from before, unchanged', async () => {
    const before = state();
    const onError = vi.fn();
    const broken = { listPermissionRules: async () => { throw new Error('gone'); } };
    await expect(listPermissionRulesUntil(broken, before, () => true, async () => {}, onError)).resolves.toEqual({
      state: before,
      changed: false,
    });
    expect(onError).toHaveBeenCalled();
  });

  it('add shows up when every stored rule is listed under its behavior and destination', () => {
    const before = state();
    const done = addShowsUp('allow', 'projectSettings', ['Bash(ls)'], before);
    expect(done(state([{ behavior: 'allow', source: 'projectSettings', rule: 'Bash(ls)', editability: 'persistent' }]))).toBe(true);
    expect(done(state([{ behavior: 'allow', source: 'localSettings', rule: 'Bash(ls)', editability: 'persistent' }]))).toBe(false);
    expect(done(state([{ behavior: 'deny', source: 'projectSettings', rule: 'Bash(ls)', editability: 'persistent' }]))).toBe(false);
    // Nothing stored reported: any change at all counts.
    const any = addShowsUp('allow', 'projectSettings', [], before);
    expect(any(before)).toBe(false);
    expect(any(state([{ behavior: 'ask', source: 'userSettings', rule: 'X', editability: 'persistent' }]))).toBe(true);
  });

  it('remove shows up when that exact rule is gone from that behavior and source', () => {
    const done = removeShowsUp('Read', 'deny', 'userSettings');
    expect(done(state([{ behavior: 'deny', source: 'userSettings', rule: 'Read', editability: 'persistent' }]))).toBe(false);
    expect(done(state([{ behavior: 'deny', source: 'localSettings', rule: 'Read', editability: 'persistent' }]))).toBe(true);
  });
});

describe("host: the prompt answer's filter (QI0, jf$, Rf$)", () => {
  const rule: PermissionUpdate = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' };
  const dir: PermissionUpdate = { type: 'addDirectories', directories: ['/shared'], destination: 'session' };
  const acceptEdits: PermissionUpdate = { type: 'setMode', mode: 'acceptEdits', destination: 'session' };
  const bypass: PermissionUpdate = { type: 'setMode', mode: 'bypassPermissions', destination: 'session' };

  it('an offered update is kept, as offered or re-targeted to any known destination', () => {
    expect(isOfferedUpdate(rule, [rule])).toBe(true);
    for (const destination of ['userSettings', 'projectSettings', 'localSettings', 'session', 'cliArg']) {
      expect(isOfferedUpdate({ ...rule, destination }, [rule])).toBe(true);
      expect(isOfferedUpdate({ ...dir, destination }, [dir])).toBe(true);
    }
    // Key order does not matter (BH).
    expect(isOfferedUpdate({ destination: 'session', behavior: 'allow', rules: rule.rules, type: 'addRules' }, [rule])).toBe(true);
  });

  it('anything else is not: another rule, an unknown destination, a re-targeted mode change', () => {
    expect(isOfferedUpdate({ ...rule, rules: [{ toolName: 'Bash', ruleContent: 'rm -rf:*' }] }, [rule])).toBe(false);
    expect(isOfferedUpdate({ ...rule, behavior: 'deny' }, [rule])).toBe(false);
    expect(isOfferedUpdate({ ...rule, destination: 'policySettings' }, [rule])).toBe(false);
    expect(isOfferedUpdate({ ...rule, destination: undefined }, [rule])).toBe(false);
    expect(isOfferedUpdate(acceptEdits, [acceptEdits])).toBe(true);
    expect(isOfferedUpdate({ ...acceptEdits, destination: 'userSettings' }, [acceptEdits])).toBe(false);
    expect(isOfferedUpdate(acceptEdits, [rule])).toBe(false);
    expect(isOfferedUpdate(null, [rule])).toBe(false);
    expect(isOfferedUpdate('addRules', [rule])).toBe(false);
  });

  it("the plan prompt's return-to-default is always allowed (jf$)", () => {
    expect(RETURN_TO_DEFAULT_MODE).toEqual({ type: 'setMode', mode: 'default', destination: 'session' });
    expect(isOfferedUpdate({ type: 'setMode', mode: 'default', destination: 'session' }, [])).toBe(true);
  });

  it('an allow keeps only offered updates; a deny or a plain allow passes through untouched', () => {
    const deny = { behavior: 'deny' as const, message: 'no' };
    expect(filterAnsweredPermissions(deny, [rule], false)).toEqual({ result: deny, dropped: 0 });
    const plain = { behavior: 'allow' as const, updatedInput: {} };
    expect(filterAnsweredPermissions(plain, [rule], false).result).toBe(plain);
    const offered = { behavior: 'allow' as const, updatedInput: {}, updatedPermissions: [{ ...rule, destination: 'projectSettings' as const }] };
    expect(filterAnsweredPermissions(offered, [rule], false)).toEqual({ result: offered, dropped: 0 });
    const smuggled = { behavior: 'allow' as const, updatedInput: {}, updatedPermissions: [rule, { ...rule, rules: [{ toolName: 'Bash' }] }] };
    expect(filterAnsweredPermissions(smuggled, [rule], false)).toEqual({
      result: { ...smuggled, updatedPermissions: [rule] },
      dropped: 1,
    });
  });

  it('a switch to bypassPermissions needs allowDangerouslySkipPermissions, even when offered', () => {
    const answer = { behavior: 'allow' as const, updatedInput: {}, updatedPermissions: [bypass] };
    expect(filterAnsweredPermissions(answer, [bypass], false)).toEqual({ result: { ...answer, updatedPermissions: [] }, dropped: 1 });
    expect(filterAnsweredPermissions(answer, [bypass], true)).toEqual({ result: answer, dropped: 0 });
  });

  it('malformed updates become none', () => {
    const answer = { behavior: 'allow' as const, updatedInput: {}, updatedPermissions: 'all' as unknown as PermissionUpdate[] };
    expect(filterAnsweredPermissions(answer, [rule], false)).toEqual({ result: { ...answer, updatedPermissions: [] }, dropped: -1 });
  });

  it('suggestions are compared with bidi controls spelled out, as the webview echoes them (Rf$ / S5)', () => {
    const tricky: PermissionUpdate = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: `ls ${RLO}fdp.exe` }], behavior: 'allow', destination: 'session' };
    const echoed = escapeBidiControls(tricky);
    expect((echoed as any).rules[0].ruleContent).toBe('ls \\u202Efdp.exe');
    expect(hostEscape(tricky)).toEqual(echoed);
    const answer = (u: PermissionUpdate) => ({ behavior: 'allow' as const, updatedInput: {}, updatedPermissions: [u] });
    expect(filterAnsweredPermissions(answer(echoed), [tricky], false).dropped).toBe(0);
    expect(filterAnsweredPermissions(answer(tricky), [tricky], false).dropped).toBe(1);
  });

  it('forge.cliArgs cannot turn bypass on: the setting owns it', () => {
    for (const flag of ['allow-dangerously-skip-permissions', '--dangerously-skip-permissions']) {
      const build = buildExtraArgs({}, { [flag]: true });
      expect(build.extraArgs).toEqual({});
      expect(build.rejected).toEqual([
        { flag: flag.replace(/^-+/, ''), value: null, reason: 'set forge.allowDangerouslySkipPermissions instead' },
      ]);
    }
  });
});

describe('host: the handlers on ClaudeAgentService', () => {
  function makeService(opts: { reads?: SDKControlPermissionRulesState[]; edit?: (e: any, cwd: string) => Promise<any>; noList?: boolean } = {}) {
    const order: string[] = [];
    const reads = opts.reads ?? [state()];
    let readCount = 0;
    const query = opts.noList
      ? {}
      : {
          listPermissionRules: vi.fn(async () => {
            order.push('list');
            const s = reads[Math.min(readCount, reads.length - 1)];
            readCount++;
            return { state: s };
          }),
        };
    const log = { info: () => {}, warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const sdkService = { getAllowDangerouslySkipPermissions: vi.fn(() => false), getClaudeBinary: vi.fn() };
    const workspaceService = { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: '/workspace' } }) };
    const svc = new (ClaudeAgentService as any)(log, {}, workspaceService, {}, {}, {}, {}, sdkService, {}, {});
    svc.channels.set('ch1', { query, cwd: '/repo' });
    svc.permissionRulesSleep = async () => {};
    const edit = vi.fn(async (e: any, cwd: string) => {
      order.push(`edit(${e.op},${cwd})`);
      return opts.edit ? opts.edit(e, cwd) : { warnings: [], stored: e.op === 'add' ? e.rules : [] };
    });
    svc.editPermissionRules = edit;
    const dispatch = (request: any, channelId: string | undefined = 'ch1') =>
      svc.processRequest({ type: 'request', requestId: 'r1', channelId, request }, new AbortController().signal);
    return { svc, query, edit, order, log, sdkService, dispatch };
  }

  const added = state([{ behavior: 'allow', source: 'projectSettings', rule: 'Bash(ls)', editability: 'persistent' }]);

  it('list_permission_rules answers the live state', async () => {
    const { dispatch } = makeService({ reads: [added] });
    await expect(dispatch({ type: 'list_permission_rules' })).resolves.toEqual({ type: 'list_permission_rules_response', state: added });
  });

  it('list_permission_rules answers errors in-band: no channel, no method', async () => {
    const { dispatch } = makeService();
    await expect(dispatch({ type: 'list_permission_rules' }, 'nope')).resolves.toEqual({
      type: 'list_permission_rules_response',
      error: 'Channel not found: nope',
    });
    const bare = makeService({ noList: true });
    await expect(bare.dispatch({ type: 'list_permission_rules' })).resolves.toMatchObject({ error: expect.stringContaining('cannot list') });
  });

  it('add: read, have the CLI write, re-read until it shows -- in that order', async () => {
    const { dispatch, order, edit } = makeService({ reads: [state(), state(), added] });
    const response = await dispatch({ type: 'add_permission_rules', rules: ['Bash(ls)'], behavior: 'allow', destination: 'projectSettings' });
    expect(response).toEqual({ type: 'add_permission_rules_response', state: added });
    expect(order).toEqual(['list', 'edit(add,/repo)', 'list', 'list']);
    expect(edit).toHaveBeenCalledWith({ op: 'add', rules: ['Bash(ls)'], behavior: 'allow', destination: 'projectSettings' }, '/repo');
  });

  it("add: the CLI's warnings are passed on; not listed yet is pending", async () => {
    const { dispatch } = makeService({
      reads: [state()],
      edit: async () => ({ warnings: ['saved as the tool-wide rule "Bash"'], stored: ['Bash'] }),
    });
    await expect(dispatch({ type: 'add_permission_rules', rules: ['Bash(*)'], behavior: 'allow', destination: 'localSettings' })).resolves.toEqual({
      type: 'add_permission_rules_response',
      state: state(),
      pending: true,
      warnings: ['saved as the tool-wide rule "Bash"'],
    });
  });

  it('add: every bad shape is refused in-band, before anything is read or written', async () => {
    const { dispatch, edit, query, log } = makeService();
    for (const request of [
      { rules: [], behavior: 'allow', destination: 'localSettings' },
      { rules: 'Read', behavior: 'allow', destination: 'localSettings' },
      { rules: Array(101).fill('Read'), behavior: 'allow', destination: 'localSettings' },
      { rules: ['x'.repeat(10001)], behavior: 'allow', destination: 'localSettings' },
      { rules: ['Read'], behavior: 'yes', destination: 'localSettings' },
      { rules: ['Read'], behavior: 'allow', destination: 'session' },
      { rules: ['Read'], behavior: 'allow', destination: 'cliArg' },
      { rules: ['Read'], behavior: 'allow' },
    ]) {
      await expect(dispatch({ type: 'add_permission_rules', ...request })).resolves.toEqual({
        type: 'add_permission_rules_response',
        error: 'invalid request',
      });
    }
    expect(edit).not.toHaveBeenCalled();
    expect((query as any).listPermissionRules).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('Refusing add_permission_rules on channel ch1: invalid request shape');
  });

  it('add: a refused write or a missing channel is an in-band error', async () => {
    const refused = makeService({ edit: async () => { throw new Error('"Read" is already in the allow rules in user settings'); } });
    await expect(
      refused.dispatch({ type: 'add_permission_rules', rules: ['Read'], behavior: 'allow', destination: 'userSettings' })
    ).resolves.toEqual({ type: 'add_permission_rules_response', error: '"Read" is already in the allow rules in user settings' });
    const missing = makeService();
    await expect(
      missing.dispatch({ type: 'add_permission_rules', rules: ['Read'], behavior: 'allow', destination: 'userSettings' }, 'gone')
    ).resolves.toEqual({ type: 'add_permission_rules_response', error: 'Channel not found: gone' });
    expect(missing.edit).not.toHaveBeenCalled();
  });

  it("add: runs where the session runs, else in the workspace", async () => {
    const { svc, dispatch, edit } = makeService();
    svc.channels.set('ch2', { query: { listPermissionRules: async () => ({ state: state() }) } });
    await dispatch({ type: 'add_permission_rules', rules: ['Read'], behavior: 'ask', destination: 'localSettings' }, 'ch2');
    expect(edit.mock.calls[0][1]).toBe('/workspace');
  });

  it('remove: read, have the CLI remove, re-read until it is gone', async () => {
    const { dispatch, order, edit } = makeService({ reads: [added, added, state()] });
    await expect(dispatch({ type: 'remove_permission_rule', rule: 'Bash(ls)', behavior: 'allow', source: 'projectSettings' })).resolves.toEqual({
      type: 'remove_permission_rule_response',
      state: state(),
    });
    expect(order).toEqual(['list', 'edit(remove,/repo)', 'list', 'list']);
    expect(edit).toHaveBeenCalledWith({ op: 'remove', rule: 'Bash(ls)', behavior: 'allow', source: 'projectSettings' }, '/repo');
  });

  it('remove: still listed is pending; bad shapes and failures are in-band', async () => {
    const stuck = makeService({ reads: [added] });
    await expect(stuck.dispatch({ type: 'remove_permission_rule', rule: 'Bash(ls)', behavior: 'allow', source: 'projectSettings' })).resolves.toEqual({
      type: 'remove_permission_rule_response',
      state: added,
      pending: true,
    });
    const { dispatch, edit } = makeService();
    for (const request of [
      { rule: '', behavior: 'allow', source: 'localSettings' },
      { rule: 'Read', behavior: 'allow', source: 'session' },
      { rule: 'Read', behavior: 'never', source: 'localSettings' },
      { rule: ['Read'], behavior: 'allow', source: 'localSettings' },
    ]) {
      await expect(dispatch({ type: 'remove_permission_rule', ...request })).resolves.toEqual({
        type: 'remove_permission_rule_response',
        error: 'invalid request',
      });
    }
    expect(edit).not.toHaveBeenCalled();
    const failing = makeService({ edit: async () => { throw new Error('rule not found'); } });
    await expect(
      failing.dispatch({ type: 'remove_permission_rule', rule: 'Read', behavior: 'deny', source: 'userSettings' })
    ).resolves.toEqual({ type: 'remove_permission_rule_response', error: 'rule not found' });
  });

  it('the prompt gets the four CanUseTool options the official forwards, and its answer is filtered', async () => {
    const { svc, sdkService, log } = makeService();
    const offered: PermissionUpdate = { type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow', destination: 'session' };
    const sent: any[] = [];
    svc.sendRequest = vi.fn(async (_channel: string, request: any) => {
      sent.push(request);
      return {
        type: 'tool_permission_response',
        result: { behavior: 'allow', updatedInput: {}, updatedPermissions: [{ ...offered, destination: 'userSettings' }, { type: 'setMode', mode: 'bypassPermissions', destination: 'session' }] },
      };
    });
    const result = await svc.requestToolPermission('ch1', 'Read', { file_path: '/a' }, [offered], {
      defaultToNo: true,
      suppressAlwaysAllowRule: false,
      toolUseId: 'tu1',
      agentId: 'ag1',
    });
    expect(sent[0]).toEqual({
      type: 'tool_permission_request',
      toolName: 'Read',
      inputs: { file_path: '/a' },
      suggestions: [offered],
      defaultToNo: true,
      suppressAlwaysAllowRule: false,
      toolUseId: 'tu1',
      agentId: 'ag1',
    });
    expect(result.updatedPermissions).toEqual([{ ...offered, destination: 'userSettings' }]);
    expect(sdkService.getAllowDangerouslySkipPermissions).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Dropping 1 permission update(s)'));
  });
});

// =============================================================== webview ===

describe('webview: the destination (by, uK1, O45, ro/io)', () => {
  it('cycles local → all projects → shared → this session → local, both ways', () => {
    expect(PROMPT_DESTINATIONS).toEqual(['localSettings', 'userSettings', 'projectSettings', 'session']);
    expect(cycleDestination('localSettings', 1)).toBe('userSettings');
    expect(cycleDestination('session', 1)).toBe('localSettings');
    expect(cycleDestination('localSettings', -1)).toBe('session');
    expect(cycleDestination('cliArg', 1)).toBe('localSettings');
  });

  it('link text and titles are the official strings', () => {
    expect(DESTINATION_LABELS).toEqual({
      localSettings: 'this project (just you)',
      userSettings: 'all projects',
      projectSettings: 'this project (shared)',
      session: 'this session',
      cliArg: 'startup options',
    });
    expect(DESTINATION_TITLES.projectSettings).toBe('Saves to .claude/settings.json (shared with team)');
    expect(DESTINATION_TITLES.session).toBe('Only for this session (not saved)');
  });

  it('starts from the remembered destination, else the broadest suggested, else this session', () => {
    const remembered = (value: string | null) => ({ getItem: (key: string) => (key === DESTINATION_STORAGE_KEY ? value : null) });
    const local: PermissionUpdate = { type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow', destination: 'localSettings' };
    const user: PermissionUpdate = { ...local, destination: 'userSettings' };
    expect(initialDestination([local], remembered('projectSettings'))).toBe('projectSettings');
    expect(initialDestination([local, user], remembered('cliArg'))).toBe('userSettings');
    expect(initialDestination([local], remembered('garbage'))).toBe('localSettings');
    expect(initialDestination([], remembered(null))).toBe('session');
    expect(suggestedDestination(undefined)).toBeUndefined();
  });
});

describe("webview: option 2's label (L45, gK1)", () => {
  const text = (parts: LabelPart[], destination = 'this project (just you)') =>
    parts
      .map((p) => (p.kind === 'text' ? p.text : p.kind === 'grant' ? p.grant.label : p.kind === 'count' ? p.text : `[${destination}]`))
      .join('');
  const addRules = (...contents: (string | undefined)[]): PermissionUpdate => ({
    type: 'addRules',
    rules: contents.map((c) => (c === undefined ? { toolName: 'WebSearch' } : { toolName: 'Bash', ruleContent: c })),
    behavior: 'allow',
    destination: 'localSettings',
  });

  it("no suggestions: \"Yes, and don't ask again\"", () => {
    expect(text(optionTwoLabel([]))).toBe("Yes, and don't ask again");
    expect(text(optionTwoLabel(undefined))).toBe("Yes, and don't ask again");
  });

  it('a mode change alone names the mode', () => {
    expect(text(optionTwoLabel([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]))).toBe('Yes, allow all edits this session');
    expect(text(optionTwoLabel([{ type: 'setMode', mode: 'default', destination: 'session' }]))).toBe('Yes, return to normal mode');
    expect(text(optionTwoLabel([{ type: 'setMode', mode: 'plan', destination: 'session' }]))).toBe("Yes, and don't ask again");
  });

  it('one, two, and more rules', () => {
    expect(text(optionTwoLabel([addRules('npm test:*')]))).toBe('Yes, allow npm test for [this project (just you)]');
    expect(text(optionTwoLabel([addRules('npm test:*', undefined)]))).toBe('Yes, allow npm test and WebSearch for [this project (just you)]');
    const three = optionTwoLabel([addRules('npm test:*', 'git status', 'git diff')]);
    expect(text(three)).toBe('Yes, allow npm test and 2 more for [this project (just you)]');
    expect(three.find((p) => p.kind === 'count')).toEqual({ kind: 'count', text: '2 more', title: '• git status\n• git diff' });
  });

  it('long rules are cut at 17 characters, prefixes lose their ":*", Artifact replies read as a phrase', () => {
    const { ruleDescriptions } = describeSuggestions([
      addRules('echo 12345678901234567890', 'x'.repeat(20)),
      { type: 'addRules', rules: [{ toolName: 'Artifact', ruleContent: 'action:reply' }], behavior: 'allow', destination: 'session' },
    ]);
    expect(ruleDescriptions).toEqual([
      { label: 'echo 123456789012…', full: 'echo 12345678901234567890' },
      { label: 'x'.repeat(20), full: 'x'.repeat(20) },
      { label: 'replies to comments on artifacts', full: 'Artifact(action:reply)' },
    ]);
  });

  it('one directory, then a count of them', () => {
    const one: PermissionUpdate = { type: 'addDirectories', directories: ['C:\\work\\shared'], destination: 'session' };
    expect(text(optionTwoLabel([one]))).toBe('Yes, allow access to shared/ for [this project (just you)]');
    const many: PermissionUpdate = { type: 'addDirectories', directories: ['/a/b', '/c/d', '/e'], destination: 'session' };
    const parts = optionTwoLabel([many]);
    expect(text(parts)).toBe('Yes, allow access to 3 directories for [this project (just you)]');
    expect(parts.find((p) => p.kind === 'count')).toMatchObject({ title: '• /a/b\n• /c/d\n• /e' });
  });

  it('the destination only matters for rules and directories (OU0)', () => {
    expect(grantsRulesOrDirectories([addRules('ls')])).toBe(true);
    expect(grantsRulesOrDirectories([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])).toBe(false);
    expect(grantsRulesOrDirectories([])).toBe(false);
  });

  it('line breaks read as ⏎, bullets for the tooltip', () => {
    expect(oneLine('a\nb\r\nc')).toBe('a⏎b⏎c');
    expect(bullet('x\ny')).toBe('• x⏎y');
  });
});

describe('webview: what option 2 answers with', () => {
  const rule: PermissionUpdate = { type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow', destination: 'localSettings' };
  const mode: PermissionUpdate = { type: 'setMode', mode: 'acceptEdits', destination: 'session' };

  it('the suggestions, saved to the chosen destination; a mode change keeps its own', () => {
    expect(optionTwoUpdates([rule, mode], 'projectSettings')).toEqual([{ ...rule, destination: 'projectSettings' }, mode]);
    expect(optionTwoUpdates([rule], 'session')).toEqual([{ ...rule, destination: 'session' }]);
  });

  it('a session-scoped mode change is what the webview mirrors', () => {
    expect(sessionModeChange([rule, mode])).toBe('acceptEdits');
    expect(sessionModeChange([rule])).toBeUndefined();
    expect(sessionModeChange([{ ...mode, destination: 'userSettings' }])).toBeUndefined();
  });

  it('plain "Yes" sends no updates: accept() defaults to none (the official CL)', () => {
    const request = new PermissionRequest('ch', 'Read', { file_path: '/a' }, [rule]);
    const results: any[] = [];
    request.onResolved((r) => results.push(r));
    request.accept(request.inputs);
    expect(results[0]).toEqual({ behavior: 'allow', updatedInput: { file_path: '/a' }, updatedPermissions: [] });
    request.accept(request.inputs, [rule]);
    expect(results[1].updatedPermissions).toEqual([rule]);
  });
});

describe('webview: the transport builds the prompt like handleToolPermissionRequest', () => {
  class TestTransport extends BaseTransport {
    sent: any[] = [];
    protected send(message: any): void {
      this.sent.push(message);
    }
  }

  it('bidi controls spelled out; the flags only when exactly true; ids passed through', async () => {
    const transport = new TestTransport(new EventEmitter(), new EventEmitter());
    const pending = (transport as any).handleToolPermissionRequest('ch', {
      type: 'tool_permission_request',
      toolName: `Bash${RLO}`,
      inputs: { command: `ls ${RLO}` },
      suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: `x${RLO}` }], behavior: 'allow', destination: 'session' }],
      defaultToNo: true,
      suppressAlwaysAllowRule: 'yes',
      toolUseId: 'tu',
      agentId: 'ag',
    });
    const request = transport.permissionRequests()[0];
    expect(request.toolName).toBe('Bash\\u202E');
    expect(request.inputs).toEqual({ command: 'ls \\u202E' });
    expect((request.suggestions[0] as any).rules[0].ruleContent).toBe('x\\u202E');
    expect(request.defaultToNo).toBe(true);
    expect(request.suppressAlwaysAllowRule).toBe(false);
    expect([request.toolUseId, request.agentId]).toEqual(['tu', 'ag']);
    request.reject('no', false);
    await expect(pending).resolves.toEqual({ type: 'tool_permission_response', result: { behavior: 'deny', message: 'no', interrupt: false } });
    expect(transport.permissionRequests()).toHaveLength(0);
  });

  it('the three requests carry the official payloads, channel on the envelope', async () => {
    const transport = new TestTransport(new EventEmitter(), new EventEmitter());
    void transport.listPermissionRules('ch');
    void transport.addPermissionRules('ch', ['Read'], 'deny', 'userSettings');
    void transport.removePermissionRule('ch', 'Read', 'deny', 'userSettings');
    expect(transport.sent.map((m) => [m.channelId, m.request])).toEqual([
      ['ch', { type: 'list_permission_rules' }],
      ['ch', { type: 'add_permission_rules', rules: ['Read'], behavior: 'deny', destination: 'userSettings' }],
      ['ch', { type: 'remove_permission_rule', rule: 'Read', behavior: 'deny', source: 'userSettings' }],
    ]);
  });
});

describe("webview: the Permission rules dialog's copy (kU0)", () => {
  it('sources in words; unknown ones as they are', () => {
    expect(sourceLabel('localSettings')).toBe('project local settings');
    expect(sourceLabel('projectSettings')).toBe('shared project settings');
    expect(sourceLabel('policySettings')).toBe('enterprise managed settings');
    expect(sourceLabel('someNewSource')).toBe('someNewSource');
  });

  it('invisible characters, bidi controls, edge spaces and look-alike escapes are spelled out (NQ)', () => {
    expect(escapeRuleText(`Bash(ls${ZWSP})`)).toBe('Bash(ls\\u200B)');
    expect(escapeRuleText(`a${NBSP}b`)).toBe('a\\u00A0b');
    expect(escapeRuleText(`x${RLO}y`)).toBe('x\\u202Ey');
    expect(escapeRuleText('  Read ')).toBe('\\u0020\\u0020Read\\u0020');
    expect(escapeRuleText('Bash(echo \\u0041)')).toBe('Bash(echo \\u005Cu0041)');
    expect(escapeRuleText(String.fromCodePoint(0xf0000))).toBe('\\u{F0000}');
    expect(escapeRuleText('Bash(npm run build:*)')).toBe('Bash(npm run build:*)');
  });

  it('the source column and the read-only reasons (h45, k45)', () => {
    const entry = (over: Partial<SDKControlPermissionRulesState['rules'][number]>) =>
      ({ behavior: 'allow', source: 'localSettings', rule: 'Read', editability: 'persistent', ...over }) as SDKControlPermissionRulesState['rules'][number];
    expect(ruleSourceText(entry({}))).toBe('From project local settings');
    expect(ruleSourceText(entry({ source: 'cliArg', editability: 'session' }))).toBe('From startup options (this session only)');
    expect(ruleSourceText(entry({ notInEffect: true }))).toBe('From project local settings (not in effect)');
    expect(readOnlyReason(entry({}))).toBeNull();
    expect(readOnlyReason(entry({ source: 'session', editability: 'session' }))).toBe('Approved for this session only; not saved in a settings file.');
    expect(readOnlyReason(entry({ source: 'cliArg', editability: 'session' }))).toBe('Not saved in a settings file.');
    expect(readOnlyReason(entry({ source: 'policySettings', editability: 'readonly' }))).toBe('Managed by enterprise settings.');
    expect(readOnlyReason(entry({ source: 'flagSettings', editability: 'readonly' }))).toBe('From a settings file given at startup.');
    expect(readOnlyReason(entry({ source: 'command', editability: 'readonly' }))).toBe("Granted by a command; change it in the command.");
    expect(readOnlyReason(entry({ source: 'toolsNarrowing', editability: 'readonly' }))).toBe('Read-only.');
    expect(canRemove(entry({}), true)).toBe(true);
    expect(canRemove(entry({}), false)).toBe(false);
    expect(canRemove(entry({ editability: 'session' }), true)).toBe(false);
    expect(canRemove(entry({ notInEffect: true }), true)).toBe(false);
  });

  it('groups by behavior in listing order; the add form starts on a file', () => {
    const s = state([
      { behavior: 'deny', source: 'userSettings', rule: 'A', editability: 'persistent' },
      { behavior: 'allow', source: 'userSettings', rule: 'B', editability: 'persistent' },
      { behavior: 'deny', source: 'userSettings', rule: 'C', editability: 'persistent' },
    ]);
    expect(groupByBehavior(s).deny.map((r) => r.rule)).toEqual(['A', 'C']);
    expect(groupByBehavior(s).ask).toEqual([]);
    const storage = (value: string | null) => ({ getItem: () => value });
    expect(initialAddDestination(storage('userSettings'))).toBe('userSettings');
    expect(initialAddDestination(storage('session'))).toBe('localSettings');
    expect(initialAddDestination(storage(null))).toBe('localSettings');
  });

  it('the pending notices', () => {
    expect(removedPendingNotice('localSettings')).toBe(
      'Removed from project local settings. If the rule is still shown, Claude Code is still re-reading its settings; reopen this dialog to check.'
    );
    expect(savedPendingNotice('userSettings', 'deny')).toBe(
      'Saved to user settings. Not listed yet: this session is still re-reading its settings (reopen this dialog to check).'
    );
    expect(savedPendingNotice('userSettings', 'allow')).toContain(', or it ignores this rule (in auto permission mode');
  });
});

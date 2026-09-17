import { describe, expect, it } from 'vitest';
import {
	slashCommandInvocations,
	slashCommandRows,
	slashCommandSelection,
	type CliSlashCommand,
} from '../src/webview/src/components/forge/slashCommands';

const cmd = (name: string, extra: Partial<CliSlashCommand> = {}): CliSlashCommand => ({
	name,
	description: `${name} description`,
	argumentHint: '',
	...extra,
});

describe('slashCommandInvocations (official Y55)', () => {
	it('uses the bare name when it is unique', () => {
		expect(slashCommandInvocations([cmd('compact')]).map((x) => x.invocation)).toEqual(['compact']);
	});

	it('uses the namespaced alias for a duplicated name', () => {
		const result = slashCommandInvocations([
			cmd('review'),
			cmd('review', { aliases: ['team-tools:review'] }),
		]);
		expect(result.map((x) => x.invocation)).toEqual(['review', 'team-tools:review']);
	});

	it('ignores aliases that do not end with :<name>', () => {
		const result = slashCommandInvocations([cmd('review'), cmd('review', { aliases: ['rv'] })]);
		expect(result.map((x) => x.invocation)).toEqual(['review', 'review']);
	});
});

describe('slashCommandRows (official qz0)', () => {
	it('builds slash-command-<invocation> rows in the Slash Commands section, sorted by label', () => {
		const rows = slashCommandRows([cmd('security-review'), cmd('compact'), cmd('init')]);
		expect(rows).toEqual([
			{ id: 'slash-command-compact', label: '/compact', description: 'compact description', section: 'Slash Commands' },
			{ id: 'slash-command-init', label: '/init', description: 'init description', section: 'Slash Commands' },
			{ id: 'slash-command-security-review', label: '/security-review', description: 'security-review description', section: 'Slash Commands' },
		]);
	});

	it('leaves out usage and context (out of scope in Forge)', () => {
		const ids = slashCommandRows([cmd('usage'), cmd('context'), cmd('compact')]).map((r) => r.id);
		expect(ids).toEqual(['slash-command-compact']);
	});

	it('rejects malformed entries and non-arrays', () => {
		expect(slashCommandRows(undefined)).toEqual([]);
		expect(slashCommandRows('nope' as unknown as CliSlashCommand[])).toEqual([]);
		expect(slashCommandRows([{ name: '' } as CliSlashCommand, null as unknown as CliSlashCommand, cmd('init')]).map((r) => r.id)).toEqual([
			'slash-command-init',
		]);
	});

	it('passes descriptions through the describe function', () => {
		expect(slashCommandRows([cmd('init')], (t) => t.toUpperCase())[0].description).toBe('INIT DESCRIPTION');
	});
});

describe('slashCommandSelection (official KZ, menu opened from the / button)', () => {
	it('sends the command on click / Enter', () => {
		expect(slashCommandSelection('slash-command-compact', false)).toEqual({ kind: 'send', text: '/compact' });
	});

	it('replaces the draft with "<label> " on Tab', () => {
		expect(slashCommandSelection('slash-command-compact', true)).toEqual({ kind: 'insert', text: '/compact ' });
	});

	it('keeps a namespaced invocation intact', () => {
		expect(slashCommandSelection('slash-command-team-tools:review', false)).toEqual({ kind: 'send', text: '/team-tools:review' });
	});

	it('ignores non-slash rows, empty invocations and out-of-scope commands', () => {
		expect(slashCommandSelection('model', false)).toBeNull();
		expect(slashCommandSelection('slash-command-', false)).toBeNull();
		expect(slashCommandSelection('slash-command-usage', false)).toBeNull();
		expect(slashCommandSelection('slash-command-context', true)).toBeNull();
	});
});

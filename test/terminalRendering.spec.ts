import { describe, expect, it } from 'vitest';
import { tokenizeShell, type ShellToken } from '../src/webview/src/components/Messages/tools/shellHighlight';
import { ansiPlainText, parseAnsi } from '../src/webview/src/components/Messages/tools/ansi';
import { diffLines, toSideBySide } from '../src/webview/src/components/Messages/tools/lineDiff';

/** The non-whitespace tokens, as `kind:text`. */
const kinds = (tokens: ShellToken[]) =>
	tokens.filter((t) => t.text.trim() !== '').map((t) => `${t.kind}:${t.text.trim()}`);

describe('tokenizeShell (bash)', () => {
	it('round-trips the source exactly', () => {
		const source = 'NODE_ENV=test npx vitest run --reporter=dot "test/**/*.spec.ts" 2>&1 | tail -n 20 && echo "$?"';
		expect(tokenizeShell(source, 'bash').map((t) => t.text).join('')).toBe(source);
	});

	it('colours the command after each operator, and flags, strings and variables', () => {
		expect(kinds(tokenizeShell('git status --short | grep -v "^??" && echo $HOME', 'bash'))).toEqual([
			'command:git',
			'text:status',
			'flag:--short',
			'operator:|',
			'command:grep',
			'flag:-v',
			'string:"^??"',
			'operator:&&',
			'command:echo',
			'variable:$HOME',
		]);
	});

	it('treats an env assignment and sudo as leading into the command', () => {
		expect(kinds(tokenizeShell('FOO=1 sudo apt install -y jq', 'bash'))).toEqual([
			'variable:FOO',
			'operator:=',
			'text:1',
			'command:sudo',
			'command:apt',
			'text:install',
			'flag:-y',
			'text:jq',
		]);
	});

	it('keeps a redirect target out of command position, and reads comments and keywords', () => {
		expect(kinds(tokenizeShell('ls > out.txt # list', 'bash'))).toEqual(['command:ls', 'operator:>', 'text:out.txt', 'comment:# list']);
		expect(kinds(tokenizeShell('for f in *.ts; do wc -l $f; done', 'bash'))).toEqual([
			'keyword:for',
			'variable:f',
			'keyword:in',
			'text:*.ts',
			'operator:;',
			'keyword:do',
			'command:wc',
			'flag:-l',
			'variable:$f',
			'operator:;',
			'keyword:done',
		]);
	});
});

describe('tokenizeShell (powershell)', () => {
	it('round-trips the source exactly', () => {
		const source = "Get-ChildItem -Path $env:USERPROFILE -Filter '*.vsix' | Where-Object { $_.Length -gt 1MB }";
		expect(tokenizeShell(source, 'powershell').map((t) => t.text).join('')).toBe(source);
	});

	it('colours cmdlets, parameters, variables, comparison operators and types', () => {
		expect(kinds(tokenizeShell("Get-ChildItem -Path $env:USERPROFILE | Where-Object { $_.Length -gt [int]5 }", 'powershell'))).toEqual([
			'command:Get-ChildItem',
			'flag:-Path',
			'variable:$env:USERPROFILE',
			'operator:|',
			'command:Where-Object',
			'operator:{',
			'variable:$_',
			'text:.Length',
			'operator:-gt',
			'keyword:[int]',
			'number:5',
			'operator:}',
		]);
	});
});

describe('parseAnsi', () => {
	it('keeps SGR colour and weight, and resets', () => {
		const [line] = parseAnsi('[1m[32mok[39m[22m done');
		expect(line).toEqual([
			{ bold: true, fg: 'green', text: 'ok' },
			{ text: ' done' },
		]);
	});

	it('carries style across lines until reset', () => {
		const lines = parseAnsi('[31mred\nstill red[0m\nplain');
		expect(lines[1]).toEqual([{ fg: 'red', text: 'still red' }]);
		expect(lines[2]).toEqual([{ text: 'plain' }]);
	});

	it('maps bright, 256-colour and true-colour codes onto the sixteen', () => {
		expect(parseAnsi('[90mx')[0][0].fg).toBe('bright-black');
		expect(parseAnsi('[38;5;196mx')[0][0].fg).toBe('red');
		expect(parseAnsi('[38;5;203mx')[0][0].fg).toBe('bright-red');
		expect(parseAnsi('[38;2;13;188;121mx')[0][0].fg).toBe('green');
	});

	it('drops non-SGR escapes and resolves carriage-return overwrites', () => {
		expect(ansiPlainText(']0;title[2Kprogress 10%\rprogress 100%\r\ndone')).toBe('progress 100%\ndone');
	});
});

describe('diffLines', () => {
	it('aligns unchanged lines and pairs a modification side by side', () => {
		const rows = diffLines('const a = 1;\nconst b = 2;', 'const a = 1;\nconst b = 3;\nconst c = 4;');
		expect(rows).toEqual([
			{ kind: 'equal', original: 'const a = 1;', modified: 'const a = 1;' },
			{ kind: 'removed', original: 'const b = 2;' },
			{ kind: 'added', modified: 'const b = 3;' },
			{ kind: 'added', modified: 'const c = 4;' },
		]);
		expect(toSideBySide(rows)).toEqual([
			{ left: { text: 'const a = 1;', removed: false }, right: { text: 'const a = 1;', added: false } },
			{ left: { text: 'const b = 2;', removed: true }, right: { text: 'const b = 3;', added: true } },
			{ left: undefined, right: { text: 'const c = 4;', added: true } },
		]);
	});
});

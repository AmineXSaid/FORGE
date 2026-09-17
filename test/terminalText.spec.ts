import { describe, expect, it } from 'vitest';
import {
	ansiLines,
	formatLines,
	jsonLines,
	linesText,
	prettyJson,
	resolveFormat,
	resultText,
	shellLines,
	stripToolUseError,
	trimBlankEdges,
	type TermLine,
} from '../src/webview/src/components/Messages/tools/terminalText';

/** Each line as `cls:text` pairs, unclassed text as plain `text`. */
const show = (lines: TermLine[]) => lines.map((line) => line.map((s) => (s.cls ? `${s.cls}:${s.text}` : s.text)));

describe('jsonLines', () => {
	it('colours keys, strings, numbers, literals and punctuation', () => {
		expect(show(jsonLines('  "id": 42, "ok": true, "name": "forge", "x": null'))).toEqual([
			[
				'  ',
				'fterm-tok-key:"id"',
				'fterm-tok-punct::',
				' ',
				'fterm-tok-number:42',
				'fterm-tok-punct:,',
				' ',
				'fterm-tok-key:"ok"',
				'fterm-tok-punct::',
				' ',
				'fterm-tok-keyword:true',
				'fterm-tok-punct:,',
				' ',
				'fterm-tok-key:"name"',
				'fterm-tok-punct::',
				' ',
				'fterm-tok-string:"forge"',
				'fterm-tok-punct:,',
				' ',
				'fterm-tok-key:"x"',
				'fterm-tok-punct::',
				' ',
				'fterm-tok-keyword:null',
			],
		]);
	});

	it('keeps escaped quotes inside a string', () => {
		expect(show(jsonLines('"say \\"hi\\""'))).toEqual([['fterm-tok-string:"say \\"hi\\""']]);
	});
});

describe('prettyJson / resolveFormat', () => {
	it('re-indents a JSON object and leaves other text alone', () => {
		expect(prettyJson('{"number":42,"labels":["ui"]}')).toBe('{\n  "number": 42,\n  "labels": [\n    "ui"\n  ]\n}');
		expect(prettyJson('Shell bash_1 killed')).toBeUndefined();
		expect(prettyJson('{ not json')).toBeUndefined();
	});

	it('picks JSON for auto only when the text parses', () => {
		expect(resolveFormat('[1, 2]', 'auto')).toBe('json');
		expect(resolveFormat('fancy output', 'auto')).toBe('ansi');
		expect(resolveFormat('[1, 2]', 'plain')).toBe('plain');
	});

	it('formats each kind, and nothing for empty text', () => {
		expect(linesText(formatLines('{"a":1}', 'json'))).toBe('{\n  "a": 1\n}');
		expect(show(formatLines('[31mred[0m', 'ansi'))).toEqual([['fterm-fg-red:red']]);
		expect(show(formatLines('a\n\nb', 'plain'))).toEqual([['a'], [], ['b']]);
		expect(formatLines('', 'ansi')).toEqual([]);
	});
});

describe('ansiLines', () => {
	it('maps weight, dim and inverse onto fterm classes', () => {
		expect(show(ansiLines('[1;32mok[0m [2mdim[0m [7minv'))).toEqual([
			['fterm-fg-green fterm-bold:ok', ' ', 'fterm-dim:dim', ' ', 'fterm-fg-inverse-fg fterm-bg-inverse-bg:inv'],
		]);
	});
});

describe('shellLines', () => {
	it('splits a multi-line command and classes its tokens', () => {
		expect(show(shellLines('cd src &&\nls -la', 'bash'))).toEqual([
			['fterm-tok-command:cd', ' src ', 'fterm-tok-operator:&&'],
			['fterm-tok-command:ls', ' ', 'fterm-tok-flag:-la'],
		]);
	});
});

describe('resultText', () => {
	it('reads string content and the text blocks of array content', () => {
		expect(resultText({ type: 'tool_result', tool_use_id: 't', content: 'plain' })).toEqual({ text: 'plain', hasNonText: false });
		expect(
			resultText({
				type: 'tool_result',
				tool_use_id: 't',
				content: [{ type: 'text', text: 'one' }, { type: 'tool_reference', tool_name: 'x' }, { type: 'text', text: 'two' }],
			})
		).toEqual({ text: 'one\ntwo', hasNonText: false });
	});

	it('flags content the terminal cannot draw as text', () => {
		const result = resultText({
			type: 'tool_result',
			tool_use_id: 't',
			content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }],
		});
		expect(result.hasNonText).toBe(true);
		expect(resultText(undefined)).toEqual({ text: '', hasNonText: false });
	});
});

describe('stripToolUseError / trimBlankEdges', () => {
	it('drops the CLI error tags and blank edge lines', () => {
		expect(stripToolUseError('<tool_use_error>File does not exist.</tool_use_error>')).toBe('File does not exist.');
		expect(trimBlankEdges('\n\n  \nName   Length\n----\n\n')).toBe('Name   Length\n----');
	});
});

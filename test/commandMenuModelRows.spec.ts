/**
 * 48b: the "/" menu Model section, with Forge's Alpha mode row.
 *
 * The official Model section is model, effort-level, toggle-thinking and the
 * fast-mode row, in that order (the official Model-section sort). Alpha mode is
 * Forge-only (divergence #58) and must be the last Model row, so it never
 * splits the official sequence. The order is checked on the rows as the source
 * lists them, *before* Forge-only rows are filtered out, so a reorder that puts
 * Alpha in the middle cannot hide.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUTTON_AREA = join(__dirname, '..', 'src', 'webview', 'src', 'components', 'ButtonArea.vue');

/** Model rows in source order: each `section: 'Model'` literal, and the fast-mode spread as its id `fast`. */
function modelRowIds(): string[] {
    const source = readFileSync(BUTTON_AREA, 'utf8').replace(/\r\n/g, '\n');
    const ids: string[] = [];
    for (const line of source.split('\n')) {
        const t = line.trim();
        if (t.startsWith('...fastModeRows(')) ids.push('fast');
        else if (t.includes("section: 'Model'")) {
            const id = /\bid: '([^']*)'/.exec(t)?.[1];
            if (id) ids.push(id);
        }
    }
    return ids;
}

describe('the "/" menu Model section', () => {
    const ids = modelRowIds();
    const OFFICIAL = ['model', 'effort-level', 'toggle-thinking', 'fast'];

    it('keeps the official ids in their order, with nothing Forge-only between them', () => {
        const firstOfficial = ids.indexOf(OFFICIAL[0]);
        expect(ids.slice(firstOfficial, firstOfficial + OFFICIAL.length)).toEqual(OFFICIAL);
    });

    it('puts Alpha mode last, as the only Forge-only Model row', () => {
        expect(ids.at(-1)).toBe('toggle-alpha');
        expect(ids.filter((id) => !OFFICIAL.includes(id))).toEqual(['toggle-alpha']);
    });

    it('is a toggle that keeps the menu open, with its copy', () => {
        const source = readFileSync(BUTTON_AREA, 'utf8');
        expect(source).toContain(
            "{ id: 'toggle-alpha', label: 'Alpha mode', description: 'Stricter checks and working rules for any model', section: 'Model', trailing: 'toggle', isOn: props.alphaModeEnabled, keepMenuOpen: true }",
        );
        expect(source).toContain("case 'toggle-alpha': return emit('alphaToggle')");
    });
});

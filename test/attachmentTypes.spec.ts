/**
 * What may be attached, and what becomes of it.
 *
 * Asked to check whether uploads work, the answer was "for images, PDFs and
 * `.txt`". Everything else was accepted into the composer as a chip and then
 * dropped at send time with a `console.error` nobody sees — so a `.zip` looked
 * attached and never arrived, and so did every `.ts`, `.py` and `.ps1`, because
 * browsers label source files `application/octet-stream` (or, for `.ts`,
 * `video/mp2t`) and the old rule compared MIME types exactly.
 *
 * Ported from the official webview: `lR1` (classify), `Mj0` (is it text),
 * `jj0` (may it be picked), `Pj0`/`cR1` (the type and extension sets), and the
 * `TextDecoder` round-trip its text branch uses.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyAttachment,
  decodeBase64Text,
  isSupportedAttachment,
} from '../src/webview/src/types/attachment';

describe('classifyAttachment — the official `lR1`', () => {
  it('classifies the four image types the official lists', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(classifyAttachment(type, 'shot.png'), type).toBe('image');
    }
  });

  it('classifies PDFs', () => {
    expect(classifyAttachment('application/pdf', 'spec.pdf')).toBe('pdf');
  });

  it('classifies any text/* as text', () => {
    expect(classifyAttachment('text/markdown', 'README.md')).toBe('text');
  });

  it('rejects archives and binaries', () => {
    // The reported case. Rejecting is correct -- silently rejecting was not.
    expect(classifyAttachment('application/zip', 'bundle.zip')).toBe('unsupported');
    expect(classifyAttachment('application/x-msdownload', 'claude.exe')).toBe('unsupported');
    expect(classifyAttachment('video/mp4', 'clip.mp4')).toBe('unsupported');
  });

  describe('source files the browser cannot label', () => {
    // Each of these was dropped before: the MIME says nothing, the extension
    // says everything.
    const cases: Array<[string, string]> = [
      ['application/octet-stream', 'generate_files.ps1'],
      ['', 'handlers.ts'],
      ['video/mp2t', 'Session.ts'],
      ['application/octet-stream', 'scrape.py'],
      ['application/octet-stream', 'vehicle_ecu_config.json'],
      ['application/octet-stream', 'system_manifest.xml'],
      ['application/octet-stream', 'notes.md'],
      ['application/octet-stream', 'query.sql'],
      ['application/octet-stream', 'App.vue'],
      ['application/octet-stream', 'main.rs'],
    ];

    for (const [type, name] of cases) {
      it(`accepts ${name} (${type || 'no MIME type'})`, () => {
        expect(classifyAttachment(type, name)).toBe('text');
      });
    }
  });

  it('accepts extensionless files the official names', () => {
    for (const name of ['LICENSE', 'README', 'Dockerfile', 'Makefile']) {
      expect(classifyAttachment('application/octet-stream', name), name).toBe('text');
    }
  });

  it('is case-insensitive about the extension', () => {
    expect(classifyAttachment('application/octet-stream', 'SCRIPT.PS1')).toBe('text');
  });

  it('treats a missing MIME type as octet-stream rather than throwing', () => {
    expect(classifyAttachment('', 'mystery.bin')).toBe('unsupported');
  });
});

describe('isSupportedAttachment — the official `jj0`', () => {
  it('lets a source file be picked', () => {
    expect(isSupportedAttachment({ type: 'application/octet-stream', name: 'a.ps1' })).toBe(true);
  });

  it('stops a zip becoming a chip in the first place', () => {
    // The whole point of gating at pick time: the user finds out now, not
    // never.
    expect(isSupportedAttachment({ type: 'application/zip', name: 'a.zip' })).toBe(false);
  });
});

describe('decodeBase64Text', () => {
  it('round-trips UTF-8 rather than mangling it', () => {
    // `atob` alone returns one byte per character, so anything non-ASCII
    // arrived corrupted. The official decodes through TextDecoder; so does this.
    const source = 'const gruß = "café ✓ 日本語";';
    const base64 = Buffer.from(source, 'utf8').toString('base64');

    expect(decodeBase64Text(base64)).toBe(source);
  });

  it('handles plain ASCII unchanged', () => {
    const base64 = Buffer.from('Write-Host "[OK]"', 'utf8').toString('base64');
    expect(decodeBase64Text(base64)).toBe('Write-Host "[OK]"');
  });
});

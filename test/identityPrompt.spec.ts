/**
 * Forge introduces itself as Forge.
 *
 * Reported from a real install: asked "hi", it answered "Hello! I'm Claude, an
 * AI assistant created by Anthropic." The CLI underneath is Claude Code and its
 * `claude_code` preset says so, so the product name has to be appended or the
 * preset's own identity is the one that comes out.
 *
 * The honest part is deliberate: the brand is asserted, the model is not
 * hidden. Asked directly what model it runs on, it answers.
 */
import { describe, expect, it } from 'vitest';
import { VS_CODE_APPEND_PROMPT } from '../src/services/claude/ClaudeSdkService';

describe('the appended system prompt', () => {
  it('names Forge and Lemino', () => {
    expect(VS_CODE_APPEND_PROMPT).toContain('Forge');
    expect(VS_CODE_APPEND_PROMPT).toContain('Lemino');
  });

  it('says who Lemino is, inside the identity section', () => {
    // The user's own definition (2026-09-24), so "who is Lemino?" has an answer.
    const identity = VS_CODE_APPEND_PROMPT.slice(
      VS_CODE_APPEND_PROMPT.indexOf('# Identity'),
      VS_CODE_APPEND_PROMPT.indexOf('# VSCode Extension Context'),
    ).replace(/\s+/g, ' ');
    expect(identity).toContain('Lemino is Mohamed Amine Said, who works at KPIT Tunisia.');
    expect(identity).toContain('Lemino created Forge, the coding agent you are');
    expect(identity).toContain('When asked who Lemino is, say so.');
    // House style: no em dash in anything the user reads.
    expect(identity).not.toContain('—');
  });

  it('tells it not to introduce itself as Claude', () => {
    // The specific failure that was reported.
    expect(VS_CODE_APPEND_PROMPT).toMatch(/Do not introduce yourself as Claude/i);
  });

  it('still keeps the model question answerable', () => {
    // Branding, not deception: "which model are you" has an honest answer.
    expect(VS_CODE_APPEND_PROMPT).toMatch(/answer that honestly/i);
  });

  it('puts identity before the editor context', () => {
    // The preset's own "you are Claude Code" lands first; whatever contradicts
    // it should lead the append rather than trail three sections of file-link
    // formatting rules.
    expect(VS_CODE_APPEND_PROMPT.indexOf('# Identity'))
      .toBeLessThan(VS_CODE_APPEND_PROMPT.indexOf('# VSCode Extension Context'));
  });

  it('keeps the editor context it was appended to', () => {
    // Guards against the identity block being pasted over the rest.
    expect(VS_CODE_APPEND_PROMPT).toContain('Code References in Text');
    expect(VS_CODE_APPEND_PROMPT).toContain('ide_selection');
  });
});

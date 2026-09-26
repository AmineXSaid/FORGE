/**
 * Slash command descriptions from the CLI, voiced as Forge without renaming
 * things that exist elsewhere (found by the end-to-end run, 2026-09-24: the
 * real CLI's `/claude-api` read "Reference for the Forge API").
 */
import { describe, expect, it } from 'vitest';
import { forgeVoice } from '../src/webview/src/utils/forgeVoice';

describe('forgeVoice', () => {
  it('voices the product as Forge', () => {
    expect(forgeVoice('Set the AI model for Claude Code')).toBe('Set the AI model for Forge');
    expect(forgeVoice('Generate a report analyzing your Claude Code sessions')).toBe('Generate a report analyzing your Forge sessions');
    expect(forgeVoice('Ask Claude to create/manage subagents, or edit .claude/agents/')).toBe('Ask Forge to create/manage subagents, or edit .claude/agents/');
  });

  it('leaves domains and the files the CLI reads alone', () => {
    expect(forgeVoice('Sign in at Claude.ai; see CLAUDE.md')).toBe('Sign in at Claude.ai; see CLAUDE.md');
  });

  it("leaves Anthropic's products alone", () => {
    expect(forgeVoice('Build with the Claude Agent SDK')).toBe('Build with the Claude Agent SDK');
    expect(forgeVoice('Keys from the Claude Console or the Claude Developer Platform')).toBe('Keys from the Claude Console or the Claude Developer Platform');
    expect(forgeVoice('Calls the Claude API directly')).toBe('Calls the Claude API directly');
  });

  it('leaves the model family alone where the text is about Anthropic', () => {
    const cli = 'Reference for the Claude API / Anthropic SDK. TRIGGER: the prompt names Claude/Anthropic in any form (Claude, Anthropic, Opus). Built for Claude Code users.';
    expect(forgeVoice(cli)).toBe('Reference for the Claude API / Anthropic SDK. TRIGGER: the prompt names Claude/Anthropic in any form (Claude, Anthropic, Opus). Built for Forge users.');
  });
});

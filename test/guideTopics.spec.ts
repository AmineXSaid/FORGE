/**
 * The Guide (Settings › Guide): Forge's help, local.
 *
 * Two properties are under test. First, **the guide says what Forge does**: its
 * worked examples are compared to the functions that write those files, and its
 * mode table to the mode picker, so the text cannot drift from the code.
 * Second, **help never leaves the machine**: the guide has no web links, and no
 * source file still points at a documentation website.
 */
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    AGENT_EXAMPLE,
    GUIDE_TOPICS,
    MCP_EXAMPLE,
    SKILL_EXAMPLE,
    type GuideBlock,
} from '../src/webview/src/components/settings/guide/guideTopics';
import { splitInlineCode } from '../src/webview/src/components/settings/guide/guideText';
import {
    agentMarkdown,
    buildMcpServer,
    itemsDir,
    skillMarkdown,
} from '../src/services/customizations/customizations';
import { loadAgents } from '../src/services/agents/loader';
import { claudeToolNames } from '../src/services/agents/scope';
import { FORGE_ACTION_COMMANDS } from '../src/services/claude/handlers/handlers';
import { FORGE_HELP_TAB, isForgeSettingsTab } from '../src/shared/messages';

const ROOT = join(__dirname, '..');
const blocks = (): GuideBlock[] => GUIDE_TOPICS.flatMap((t) => t.blocks);
const codeTitled = (fragment: string): string => {
    const block = blocks().find((b) => b.kind === 'code' && b.title.includes(fragment));
    if (!block || block.kind !== 'code') throw new Error(`no code block titled *${fragment}*`);
    return block.code;
};

describe('the five questions', () => {
    it('asks the five questions, in order, each with an answer', () => {
        expect(GUIDE_TOPICS.map((t) => t.id)).toEqual(['conversation', 'skill', 'mcp', 'agent', 'use']);
        for (const topic of GUIDE_TOPICS) {
            expect(topic.question).toMatch(/\?$/);
            expect(topic.summary.length).toBeGreaterThan(10);
            expect(topic.short.length).toBeGreaterThan(0);
            expect(topic.blocks.length).toBeGreaterThan(2);
        }
        expect(new Set(GUIDE_TOPICS.map((t) => t.id)).size).toBe(GUIDE_TOPICS.length);
    });

    it('draws at least one diagram per answer, each a mermaid source', () => {
        for (const topic of GUIDE_TOPICS) {
            const diagrams = topic.blocks.filter((b) => b.kind === 'diagram');
            expect(diagrams.length, topic.id).toBeGreaterThan(0);
            for (const d of diagrams) {
                if (d.kind !== 'diagram') continue;
                const body = d.source.replace(/^%%\{init:[\s\S]*?\}%%\n/, '');
                expect(body, topic.id).toMatch(/^(flowchart (TB|LR|TD)|sequenceDiagram)\n/);
                expect(d.caption.length).toBeGreaterThan(0);
            }
        }
    });

    it('its buttons only name actions and tabs the host accepts', () => {
        const actions = blocks().flatMap((b) => (b.kind === 'actions' ? b.items : []));
        expect(actions.length).toBeGreaterThan(0);
        for (const item of actions) {
            if ('action' in item) expect(Object.keys(FORGE_ACTION_COMMANDS)).toContain(item.action);
            else expect(isForgeSettingsTab(item.tab), item.tab).toBe(true);
        }
    });
});

describe('the guide says what Forge writes', () => {
    it('shows SKILL.md exactly as "Create skill" writes it', () => {
        expect(codeTitled('SKILL.md')).toBe(skillMarkdown(SKILL_EXAMPLE.name, SKILL_EXAMPLE.description));
    });

    it('shows a Claude Code agent exactly as "Create agent" writes it', () => {
        expect(codeTitled('(Claude Code agent)')).toBe(
            agentMarkdown(AGENT_EXAMPLE.name, AGENT_EXAMPLE.description, AGENT_EXAMPLE.tools),
        );
    });

    it('shows the .mcp.json entry "Add MCP server" builds', () => {
        const doc = JSON.parse(codeTitled('.mcp.json'));
        expect(doc).toEqual({ mcpServers: { [MCP_EXAMPLE.name]: buildMcpServer('stdio', MCP_EXAMPLE.command) } });
    });

    it('shows a Hermes agent the loader reads, with every key it names', () => {
        const dir = mkdtempSync(join(tmpdir(), 'forge-guide-'));
        writeFileSync(join(dir, 'reviewer.md'), codeTitled('(Hermes agent)'));
        const { agents } = loadAgents(dir);
        expect(agents).toHaveLength(1);
        const [agent] = agents;
        expect(agent.name).toBe('reviewer');
        expect(agent.model).toBe('your-model-id');
        expect(agent.memory).toBe('.agent/memory/reviewer.md');
        expect(agent.tools).toEqual(['Read', 'Grep', 'Glob']);
        // The Hermes names the comment promises mean the same tools.
        expect(claudeToolNames(['read_file', 'search', 'glob']).tools.sort()).toEqual(['Glob', 'Grep', 'Read']);
        expect(agent.skills).toEqual(['release-notes']);
        expect(agent.mcp.map((m) => m.server)).toEqual(['memory']);
        expect(agent.persona).toMatch(/^You are a careful reviewer/);
    });

    it('puts skills where Forge puts them', () => {
        const tree = codeTitled('Where skills live');
        expect(itemsDir('skills', 'user', undefined)).toMatch(/\.claude[\\/]skills$/);
        expect(tree).toContain('~/.claude/skills/');
        expect(itemsDir('skills', 'project', '/repo')).toBe(join('/repo', '.claude', 'skills'));
        expect(tree).toContain('<project>/.claude/skills/');
    });

    it('lists the permission modes the mode picker offers, by the same names', () => {
        const picker = readFileSync(join(ROOT, 'src/webview/src/components/ModeSelect.vue'), 'utf8');
        const offered = [...picker.matchAll(/^\s*label: '([^']+)',$/gm)].map((m) => m[1]);
        const table = GUIDE_TOPICS[0].blocks.find((b) => b.kind === 'table' && b.head[0] === 'Mode');
        if (!table || table.kind !== 'table') throw new Error('no mode table');
        expect(table.rows.map((r) => r[0])).toEqual(offered);
    });
});

describe('help is local', () => {
    it('the guide links to nothing outside', () => {
        expect(JSON.stringify(GUIDE_TOPICS)).not.toMatch(/https?:\/\//);
    });

    it('open_help lands on the Guide tab', () => {
        expect(FORGE_HELP_TAB).toBe('guide');
        expect(isForgeSettingsTab('guide')).toBe(true);
        const page = readFileSync(join(ROOT, 'src/webview/src/pages/SettingsPage.vue'), 'utf8');
        expect(page).toMatch(/case 'guide':\s*return SettingsTabGuide;/);
        const sidebar = readFileSync(join(ROOT, 'src/webview/src/components/settings/SettingsSidebar.vue'), 'utf8');
        expect(page).toContain(`{ id: 'guide', label: 'Guide', icon: 'codicon-book', footer: true }`);
        expect(sidebar).toContain(`v-for="tab in footerTabs"`);
        expect(sidebar).not.toContain('openHelp');
        expect(sidebar).not.toContain('codicon-link-external');
    });

    it('no source file points at a documentation website', () => {
        const DOCS = /https?:\/\/(code\.claude\.com|docs\.claude\.com|docs\.anthropic\.com|support\.anthropic\.com)/;
        const hits: string[] = [];
        const walk = (dir: string): void => {
            for (const name of readdirSync(dir)) {
                const file = join(dir, name);
                if (statSync(file).isDirectory()) walk(file);
                else if (/\.(ts|vue|js)$/.test(name) && DOCS.test(readFileSync(file, 'utf8'))) {
                    hits.push(relative(ROOT, file));
                }
            }
        };
        walk(join(ROOT, 'src'));
        expect(hits).toEqual([]);
    });
});

describe('inline code in guide text', () => {
    it('splits `backticks` into code runs and leaves the rest as text', () => {
        expect(splitInlineCode('Run `npx` then `claude` now')).toEqual([
            { text: 'Run ', code: false },
            { text: 'npx', code: true },
            { text: ' then ', code: false },
            { text: 'claude', code: true },
            { text: ' now', code: false },
        ]);
    });

    it('keeps an unpaired backtick as text', () => {
        expect(splitInlineCode('a ` b')).toEqual([{ text: 'a ` b', code: false }]);
        expect(splitInlineCode('`x`')).toEqual([{ text: 'x', code: true }]);
    });
});

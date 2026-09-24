import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

/**
 * A row of the mode menu: a permission mode, or Forge's Expert row
 * (production audit, Phase 6). Expert is Manual permissions plus the plugin's
 * `forge:Expert` output style, so it is exclusive with the other rows.
 */
export type ModeId = PermissionMode | 'expert';

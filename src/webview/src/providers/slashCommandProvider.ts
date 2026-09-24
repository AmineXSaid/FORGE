import type { CommandAction } from '../core/AppContext'
import { forgeVoice } from '../utils/forgeVoice';
import type { RuntimeInstance } from '../composables/useRuntime'
import type { DropdownItemType } from '../types/dropdown'

/**
 * Slash Command 数据提供者
 *
 * 从 CommandRegistry 获取并过滤 slash commands
 */

// 带 section 信息的命令
export interface CommandWithSection extends CommandAction {
  section: string
}

/**
 * 获取 slash commands
 *
 * @param query 搜索查询（可选）
 * @param runtime Runtime 实例
 * @param _signal 未使用,仅为保持接口一致性
 * @returns 命令列表
 */
export function getSlashCommands(
  query: string,
  runtime: RuntimeInstance | undefined,
  _signal?: AbortSignal
): CommandAction[] {
  if (!runtime) return []

  const commandsBySection = runtime.appContext.commandRegistry.getCommandsBySection()
  const allCommands = commandsBySection['Slash Commands'] || []

  // 如果没有查询，返回所有命令
  if (!query || !query.trim()) return allCommands

  return rankSlashCommands(allCommands, query)
}

/**
 * The official command-menu order (`o65`): the exact name first, then names
 * starting with the query, then the rest. The CLI lists commands
 * alphabetically, so without this "/compact" + Enter picked "/autocompact"
 * (found by the end-to-end run, 2026-09-24). The "/" menu ranks the same way
 * (`CommandMenu.vue`, `rank`).
 */
export function slashRank(command: CommandAction, query: string): number {
  const q = query.trim().toLowerCase().replace(/^\//, '')
  const name = command.label.toLowerCase().replace(/^\//, '')
  if (name === q) return 0
  if (name.startsWith(q)) return 1
  if (name.includes(q) || command.id.toLowerCase().includes(q)) return 2
  if (command.description?.toLowerCase().includes(q)) return 3
  return -1
}

/** Matches of `query`, best first; ties keep the CLI's order. */
export function rankSlashCommands<T extends CommandAction>(commands: readonly T[], query: string): T[] {
  return commands
    .map((command, index) => ({ command, index, rank: slashRank(command, query) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.command)
}

/**
 * 获取带分组信息的 slash commands（用于 ButtonArea）
 *
 * @param query 搜索查询（可选）
 * @param runtime Runtime 实例
 * @returns 带分组信息的命令列表
 */
export function getSlashCommandsWithSection(
  query: string,
  runtime: RuntimeInstance | undefined
): CommandWithSection[] {
  if (!runtime) return []

  const commandsBySection = runtime.appContext.commandRegistry.getCommandsBySection()
  const results: CommandWithSection[] = []

  const SECTION_ORDER = ['Slash Commands'] as const

  // 遍历分组
  for (const section of SECTION_ORDER) {
    const commands = commandsBySection[section]
    if (!commands || commands.length === 0) continue

    // 过滤命令
    const filteredCommands = query ? rankSlashCommands(commands, query) : commands

    // 添加分组信息
    for (const cmd of filteredCommands) {
      results.push({
        ...cmd,
        section
      })
    }
  }

  return results
}

/**
 * 将 CommandAction 转换为 DropdownItemType
 *
 * @param command 命令对象
 * @returns Dropdown 项
 */
export function commandToDropdownItem(command: CommandAction): DropdownItemType {
  return {
    id: command.id,
    label: command.label,
    detail: command.description ? forgeVoice(command.description) : command.description,
    icon: 'codicon-symbol-method',
    type: 'command',
    data: { commandId: command.id, command }
  }
}

/**
 * 获取命令的图标
 *
 * @param command 命令对象
 * @returns 图标类名
 */
export function getCommandIcon(command: CommandAction): string | undefined {
  const label = command.label.toLowerCase()

  // Slash commands 使用默认图标
  if (label.startsWith('/')) {
    return 'codicon-symbol-method'
  }

  return undefined
}

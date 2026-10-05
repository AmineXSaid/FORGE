import type { AgentMapAgent } from '../../../core/agentMap';

/** The official `mz0`: an agent's key in the map dialog's selection. */
export function agentKey(agent: AgentMapAgent): string {
  return agent.toolUseId ?? agent.taskId;
}

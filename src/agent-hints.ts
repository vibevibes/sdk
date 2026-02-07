/**
 * Pre-built agent hints for the negotiation protocol.
 */
import type { AgentHint } from './types';

export function createAgentProtocolHints(namespace: string): AgentHint[] {
  return [
    {
      trigger: 'A proposal is pending and you have not voted on it yet',
      condition: `Object.values(state._agentProposals || {}).some(p => p.status === 'pending' && !p.votes.some(v => v.actorId === actorId))`,
      suggestedTools: [`${namespace}.agent.vote`],
      priority: 'high',
      cooldownMs: 2000,
    },
    {
      trigger: 'You received a delegation addressed to you',
      condition: `(state._agentMessages || []).some(m => m.type === 'delegate' && m.to === actorId)`,
      suggestedTools: [`${namespace}.agent.respond`],
      priority: 'high',
      cooldownMs: 3000,
    },
    {
      trigger: 'You received a request addressed to you',
      condition: `(state._agentMessages || []).some(m => m.type === 'request' && m.to === actorId)`,
      suggestedTools: [`${namespace}.agent.respond`],
      priority: 'medium',
      cooldownMs: 2000,
    },
    {
      trigger: 'You have useful information to share with other agents',
      suggestedTools: [`${namespace}.agent.inform`],
      priority: 'low',
      cooldownMs: 5000,
    },
    {
      trigger: 'You want to propose a collaborative action for the group',
      suggestedTools: [`${namespace}.agent.propose`],
      priority: 'low',
      cooldownMs: 10000,
    },
  ];
}

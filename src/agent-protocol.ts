/**
 * Multi-agent negotiation protocol.
 * Provides pre-built tools for agent-to-agent communication.
 */
import type { ToolDef, ToolCtx } from './types';

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function capMessages(msgs: any[], max = 100): any[] {
  return msgs.length > max ? msgs.slice(-max) : msgs;
}

export function createAgentProtocolTools(namespace: string, z: any): ToolDef[] {
  return [
    {
      name: `${namespace}.agent.propose`,
      description: 'Propose an action for other agents to vote on',
      input_schema: z.object({
        proposal: z.string(),
        data: z.any().optional(),
        requiresVotes: z.number().optional(),
      }),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx, input: { proposal: string; data?: any; requiresVotes?: number }) => {
        const id = uid();
        const proposals = { ...(ctx.state._agentProposals || {}) };
        proposals[id] = {
          id,
          from: ctx.actorId,
          proposal: input.proposal,
          data: input.data,
          requiresVotes: input.requiresVotes || 1,
          votes: [],
          status: 'pending',
          ts: ctx.timestamp,
        };
        const messages = capMessages([
          ...(ctx.state._agentMessages || []),
          { id, from: ctx.actorId, to: '*', type: 'proposal', content: input.proposal, data: input.data, ts: ctx.timestamp },
        ]);
        ctx.setState({ ...ctx.state, _agentProposals: proposals, _agentMessages: messages });
        return { proposalId: id };
      },
    },
    {
      name: `${namespace}.agent.vote`,
      description: 'Vote on a pending proposal (approve or reject)',
      input_schema: z.object({
        proposalId: z.string(),
        vote: z.enum(['approve', 'reject']),
        reason: z.string().optional(),
      }),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx, input: { proposalId: string; vote: 'approve' | 'reject'; reason?: string }) => {
        const proposals = { ...(ctx.state._agentProposals || {}) };
        const proposal = proposals[input.proposalId];
        if (!proposal) throw new Error(`Proposal ${input.proposalId} not found`);
        if (proposal.status !== 'pending') throw new Error(`Proposal already ${proposal.status}`);
        if (proposal.votes.some((v: any) => v.actorId === ctx.actorId)) throw new Error('Already voted');

        const votes = [...proposal.votes, { actorId: ctx.actorId, vote: input.vote, reason: input.reason }];
        const approves = votes.filter((v: any) => v.vote === 'approve').length;
        const rejects = votes.filter((v: any) => v.vote === 'reject').length;
        let status = 'pending';
        if (approves >= proposal.requiresVotes) status = 'approved';
        else if (rejects >= proposal.requiresVotes) status = 'rejected';

        proposals[input.proposalId] = { ...proposal, votes, status };
        const messages = capMessages([
          ...(ctx.state._agentMessages || []),
          { id: uid(), from: ctx.actorId, to: proposal.from, type: 'vote', content: `${input.vote}: ${input.reason || ''}`, data: { proposalId: input.proposalId, vote: input.vote }, ts: ctx.timestamp },
        ]);
        ctx.setState({ ...ctx.state, _agentProposals: proposals, _agentMessages: messages });
        return { status, voteCount: votes.length };
      },
    },
    {
      name: `${namespace}.agent.delegate`,
      description: 'Delegate a task to another agent',
      input_schema: z.object({
        targetActorId: z.string(),
        task: z.string(),
        data: z.any().optional(),
      }),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx, input: { targetActorId: string; task: string; data?: any }) => {
        const id = uid();
        const messages = capMessages([
          ...(ctx.state._agentMessages || []),
          { id, from: ctx.actorId, to: input.targetActorId, type: 'delegate', content: input.task, data: input.data, ts: ctx.timestamp },
        ]);
        ctx.setState({ ...ctx.state, _agentMessages: messages });
        return { messageId: id };
      },
    },
    {
      name: `${namespace}.agent.inform`,
      description: 'Share information with other agents',
      input_schema: z.object({
        to: z.string(),
        message: z.string(),
        data: z.any().optional(),
      }),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx, input: { to: string; message: string; data?: any }) => {
        const id = uid();
        const messages = capMessages([
          ...(ctx.state._agentMessages || []),
          { id, from: ctx.actorId, to: input.to, type: 'inform', content: input.message, data: input.data, ts: ctx.timestamp },
        ]);
        ctx.setState({ ...ctx.state, _agentMessages: messages });
        return { messageId: id };
      },
    },
    {
      name: `${namespace}.agent.request`,
      description: 'Request an action from another agent',
      input_schema: z.object({
        targetActorId: z.string(),
        request: z.string(),
        data: z.any().optional(),
      }),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx, input: { targetActorId: string; request: string; data?: any }) => {
        const id = uid();
        const messages = capMessages([
          ...(ctx.state._agentMessages || []),
          { id, from: ctx.actorId, to: input.targetActorId, type: 'request', content: input.request, data: input.data, ts: ctx.timestamp },
        ]);
        ctx.setState({ ...ctx.state, _agentMessages: messages });
        return { messageId: id };
      },
    },
    {
      name: `${namespace}.agent.respond`,
      description: 'Respond to a message, request, or delegation from another agent',
      input_schema: z.object({
        messageId: z.string(),
        response: z.string(),
        data: z.any().optional(),
      }),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx, input: { messageId: string; response: string; data?: any }) => {
        const id = uid();
        const messages = capMessages([
          ...(ctx.state._agentMessages || []),
          { id, from: ctx.actorId, to: '*', type: 'inform', content: input.response, data: { ...input.data, inReplyTo: input.messageId }, ts: ctx.timestamp },
        ]);
        ctx.setState({ ...ctx.state, _agentMessages: messages });
        return { messageId: id };
      },
    },
  ];
}

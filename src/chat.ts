/**
 * Chat tool factory for experiences.
 *
 * Messages are stored in shared state under `_chat` so agents
 * see them via the stop hook's /agent-context endpoint.
 *
 * Usage:
 *   import { createChatTools } from "@vibevibes/sdk";
 *   const tools = [...myTools, ...createChatTools(z)];
 *
 *   // In Canvas: read sharedState._chat, send via callTool('_chat.send', { message })
 */
import type { ToolDef, ToolCtx, ZodFactory } from './types';

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function capMessages<T>(msgs: T[], max = 200): T[] {
  return msgs.length > max ? msgs.slice(-max) : msgs;
}

export type ChatMessage = {
  id: string;
  actorId: string;
  message: string;
  replyTo?: string;
  ts: number;
};

export function createChatTools(z: ZodFactory): ToolDef[] {
  return [
    {
      name: '_chat.send',
      description: 'Send a chat message',
      input_schema: z.object({
        message: z.string().min(1).max(2000),
        replyTo: z.string().optional(),
      }),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx, input: { message: string; replyTo?: string }) => {
        const cleanMessage = input.message.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
        const messages = capMessages([
          ...(ctx.state._chat || []),
          {
            id: uid(),
            actorId: ctx.actorId,
            message: cleanMessage,
            replyTo: input.replyTo,
            ts: ctx.timestamp,
          },
        ]);
        ctx.setState({ ...ctx.state, _chat: messages });
        return { sent: true, messageCount: messages.length };
      },
    },
    {
      name: '_chat.clear',
      description: 'Clear all chat messages',
      input_schema: z.object({}),
      risk: 'medium' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx) => {
        ctx.setState({ ...ctx.state, _chat: [] });
        return { cleared: true };
      },
    },
  ];
}

/**
 * Standardized chat for experiences.
 *
 * Provides a collapsible ChatPanel component, a useChat hook,
 * and tool factories for agent participation.
 *
 * Messages are stored in shared state under `_chat` so agents
 * see them via the stop hook's /agent-context endpoint.
 *
 * Usage:
 *   import { ChatPanel, createChatTools } from "@vibevibes/sdk";
 *
 *   const tools = [...myTools, ...createChatTools(z)];
 *
 *   function Canvas(props) {
 *     return <div>
 *       <ChatPanel {...props} />
 *     </div>;
 *   }
 */
import type { ToolDef, ToolCtx } from './types';
import { useTypingIndicator } from './hooks';

// ── Helpers (same pattern as agent-protocol.ts) ─────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function capMessages(msgs: any[], max = 200): any[] {
  return msgs.length > max ? msgs.slice(-max) : msgs;
}

// ── Lazy React accessor ─────────────────────────────────────────────────

function getReact(): any {
  const R = (globalThis as any).React;
  if (!R) throw new Error('React is not available.');
  return R;
}

function h(type: any, props: any, ...children: any[]) {
  return getReact().createElement(type, props, ...children);
}

// ── Types ───────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string;
  actorId: string;
  message: string;
  replyTo?: string;
  ts: number;
};

type CallToolFn = (name: string, input: any) => Promise<any>;

export type UseChatReturn = {
  messages: ChatMessage[];
  sendMessage: (message: string, replyTo?: string) => Promise<void>;
  clearChat: () => Promise<void>;
  setTyping: (isTyping: boolean) => void;
  typingUsers: string[];
};

// ── Tool Factory ────────────────────────────────────────────────────────

export function createChatTools(z: any): ToolDef[] {
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
        const messages = capMessages([
          ...(ctx.state._chat || []),
          {
            id: uid(),
            actorId: ctx.actorId,
            message: input.message,
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

// ── useChat Hook ────────────────────────────────────────────────────────

export function useChat(
  sharedState: Record<string, any>,
  callTool: CallToolFn,
  actorId: string,
  ephemeralState: Record<string, Record<string, any>>,
  setEphemeral: (data: Record<string, any>) => void,
): UseChatReturn {
  const React = getReact();

  const messages: ChatMessage[] = sharedState._chat || [];

  const sendMessage = React.useCallback(
    async (message: string, replyTo?: string) => {
      await callTool('_chat.send', { message, replyTo });
    },
    [callTool],
  );

  const clearChat = React.useCallback(async () => {
    await callTool('_chat.clear', {});
  }, [callTool]);

  const { setTyping, typingUsers } = useTypingIndicator(actorId, ephemeralState, setEphemeral);

  return { messages, sendMessage, clearChat, setTyping, typingUsers };
}

// ── Helper: parse actorId ───────────────────────────────────────────────

function parseActorId(id: string): { username: string; type: 'human' | 'ai' | 'unknown' } {
  const m = id.match(/^(.+)-(human|ai)-(\d+)$/);
  if (m) return { username: m[1], type: m[2] as 'human' | 'ai' };
  return { username: id, type: 'unknown' };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── ChatPanel Component ─────────────────────────────────────────────────

type ChatPanelProps = {
  sharedState: Record<string, any>;
  callTool: (name: string, input: any) => Promise<any>;
  actorId: string;
  ephemeralState: Record<string, Record<string, any>>;
  setEphemeral: (data: Record<string, any>) => void;
  participants: string[];
  style?: Record<string, any>;
};

export function ChatPanel({
  sharedState,
  callTool,
  actorId,
  ephemeralState,
  setEphemeral,
  style,
}: ChatPanelProps) {
  const React = getReact();
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [lastSeenCount, setLastSeenCount] = React.useState(0);
  const listRef = React.useRef(null);

  const { messages, sendMessage, setTyping, typingUsers } = useChat(
    sharedState,
    callTool,
    actorId,
    ephemeralState,
    setEphemeral,
  );

  // Unread count
  const unread = open ? 0 : Math.max(0, messages.length - lastSeenCount);

  // Track seen messages when panel is open
  React.useEffect(() => {
    if (open) {
      setLastSeenCount(messages.length);
    }
  }, [open, messages.length]);

  // Auto-scroll to bottom on new messages
  React.useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = React.useCallback(async () => {
    const text = inputValue.trim();
    if (!text || sending) return;
    setSending(true);
    setInputValue('');
    setTyping(false);
    try {
      await sendMessage(text);
    } catch {
      // Error is shown by the experience's error handling
    } finally {
      setSending(false);
    }
  }, [inputValue, sending, sendMessage, setTyping]);

  const handleKeyDown = React.useCallback(
    (e: any) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInputChange = React.useCallback(
    (e: any) => {
      setInputValue(e.target.value);
      setTyping(e.target.value.length > 0);
    },
    [setTyping],
  );

  const actorColors: Record<string, string> = {
    human: '#60a5fa',
    ai: '#a78bfa',
    unknown: '#94a3b8',
  };

  // ── Toggle Button ───────────────────────────────────────
  const toggleBtn = h(
    'button',
    {
      onClick: () => setOpen(!open),
      title: 'Chat',
      style: {
        position: 'fixed',
        bottom: '64px',
        right: '16px',
        zIndex: 9990,
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        background: '#1e1e2e',
        border: '1px solid #334155',
        color: '#94a3b8',
        fontSize: '18px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.15s',
        ...style,
      },
    },
    // Chat icon (speech bubble SVG)
    h(
      'svg',
      {
        width: 20,
        height: 20,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      h('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }),
    ),
    // Unread badge
    unread > 0
      ? h(
          'span',
          {
            style: {
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              background: '#6366f1',
              color: '#fff',
              fontSize: '10px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
          },
          unread > 9 ? '9+' : String(unread),
        )
      : null,
  );

  if (!open) return toggleBtn;

  // ── Expanded Panel ──────────────────────────────────────
  return h(
    'div',
    null,
    toggleBtn,
    h(
      'div',
      {
        style: {
          position: 'fixed',
          bottom: '112px',
          right: '16px',
          zIndex: 9990,
          width: '320px',
          maxHeight: '500px',
          borderRadius: '12px',
          background: '#111113',
          border: '1px solid #1e1e24',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        },
      },
      // Header
      h(
        'div',
        {
          style: {
            padding: '12px 16px',
            borderBottom: '1px solid #1e1e24',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
        },
        h(
          'span',
          {
            style: {
              fontSize: '12px',
              fontWeight: 700,
              color: '#6b6b80',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            },
          },
          'Chat',
        ),
        h(
          'button',
          {
            onClick: () => setOpen(false),
            style: {
              background: 'none',
              border: 'none',
              color: '#6b6b80',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '2px',
            },
          },
          '\u2715',
        ),
      ),
      // Message list
      h(
        'div',
        {
          ref: listRef,
          style: {
            flex: 1,
            overflowY: 'auto',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            minHeight: '200px',
            maxHeight: '340px',
          },
        },
        messages.length === 0
          ? h(
              'div',
              {
                style: {
                  color: '#4a4a5a',
                  fontSize: '13px',
                  textAlign: 'center',
                  padding: '32px 0',
                },
              },
              'No messages yet',
            )
          : messages.map((msg: ChatMessage) => {
              const { username, type } = parseActorId(msg.actorId);
              const isMe = msg.actorId === actorId;
              return h(
                'div',
                {
                  key: msg.id,
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isMe ? 'flex-end' : 'flex-start',
                  },
                },
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      gap: '6px',
                      alignItems: 'baseline',
                      flexDirection: isMe ? 'row-reverse' : 'row',
                    },
                  },
                  h(
                    'span',
                    {
                      style: {
                        fontSize: '11px',
                        fontWeight: 600,
                        color: actorColors[type] || actorColors.unknown,
                      },
                    },
                    username,
                  ),
                  h(
                    'span',
                    { style: { fontSize: '10px', color: '#4a4a5a' } },
                    formatTime(msg.ts),
                  ),
                ),
                h(
                  'div',
                  {
                    style: {
                      background: isMe ? '#6366f1' : '#1e1e2e',
                      color: isMe ? '#fff' : '#e2e2e8',
                      padding: '6px 10px',
                      borderRadius: '10px',
                      borderTopRightRadius: isMe ? '2px' : '10px',
                      borderTopLeftRadius: isMe ? '10px' : '2px',
                      fontSize: '13px',
                      lineHeight: 1.4,
                      maxWidth: '240px',
                      wordBreak: 'break-word',
                    },
                  },
                  msg.message,
                ),
              );
            }),
      ),
      // Typing indicator
      typingUsers.length > 0
        ? h(
            'div',
            {
              style: {
                padding: '4px 12px',
                fontSize: '11px',
                color: '#6b6b80',
                fontStyle: 'italic',
              },
            },
            typingUsers
              .map((id: string) => parseActorId(id).username)
              .join(', ') + (typingUsers.length === 1 ? ' is typing...' : ' are typing...'),
          )
        : null,
      // Input area
      h(
        'div',
        {
          style: {
            padding: '8px 12px',
            borderTop: '1px solid #1e1e24',
            display: 'flex',
            gap: '8px',
          },
        },
        h('input', {
          type: 'text',
          value: inputValue,
          onChange: handleInputChange,
          onKeyDown: handleKeyDown,
          placeholder: 'Type a message...',
          disabled: sending,
          style: {
            flex: 1,
            padding: '6px 10px',
            fontSize: '13px',
            border: '1px solid #334155',
            borderRadius: '6px',
            background: '#1e293b',
            color: '#fff',
            outline: 'none',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          },
        }),
        h(
          'button',
          {
            onClick: handleSend,
            disabled: sending || !inputValue.trim(),
            style: {
              padding: '6px 12px',
              borderRadius: '6px',
              background: '#6366f1',
              color: '#fff',
              border: 'none',
              fontSize: '13px',
              cursor: sending || !inputValue.trim() ? 'not-allowed' : 'pointer',
              opacity: sending || !inputValue.trim() ? 0.5 : 1,
              fontWeight: 500,
            },
          },
          'Send',
        ),
      ),
    ),
  );
}

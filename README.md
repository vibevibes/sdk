# @vibevibes/sdk

The primitives for building agent-native experiences — shared interactive apps where humans and AI collaborate in real-time through a shared state, shared tools, and a shared canvas.

## Install

```bash
npm install @vibevibes/sdk
```

Peer dependencies: `react` (18 or 19), `zod`. Optional: `yjs`.

## Quick Start

```tsx
import { defineExperience, defineTool } from "@vibevibes/sdk";
import { z } from "zod";

const tools = [
  defineTool({
    name: "counter.increment",
    description: "Add to the counter",
    input_schema: z.object({
      amount: z.number().default(1).describe("Amount to add"),
    }),
    handler: async (ctx, input) => {
      const count = (ctx.state.count || 0) + input.amount;
      ctx.setState({ ...ctx.state, count });
      return { count };
    },
  }),
];

function Canvas({ sharedState, callTool }) {
  return (
    <div>
      <h1>{sharedState.count || 0}</h1>
      <button onClick={() => callTool("counter.increment", { amount: 1 })}>
        +1
      </button>
    </div>
  );
}

export default defineExperience({
  manifest: {
    id: "counter",
    version: "0.0.1",
    title: "Counter",
    description: "A shared counter",
    requested_capabilities: [],
  },
  Canvas,
  tools,
});
```

That's a complete experience. Humans click the button. Agents call the same tool via MCP. Both mutate the same state. Both see the same canvas.

## Core Concepts

**Tools are the only way to mutate state.** Every tool has a Zod schema for validation and a handler that calls `ctx.setState()`. Humans use tools via the Canvas. Agents use the same tools via MCP. No backdoors.

**Canvas is a React component.** It receives the current shared state and a `callTool` function. It re-renders on every state change.

**Agents are actors, not assistants.** They join rooms, watch for events, react with tools, and persist memory. Same participation model as humans.

## Defining Tools

```tsx
import { defineTool, quickTool } from "@vibevibes/sdk";

// Full form
defineTool({
  name: "board.place",
  description: "Place a piece on the board",
  input_schema: z.object({
    x: z.number(),
    y: z.number(),
    piece: z.string(),
  }),
  handler: async (ctx, input) => {
    const board = { ...ctx.state.board };
    board[`${input.x},${input.y}`] = input.piece;
    ctx.setState({ ...ctx.state, board });
    return { placed: true };
  },
});

// Shorthand
quickTool("board.clear", "Clear the board", z.object({}), async (ctx) => {
  ctx.setState({ ...ctx.state, board: {} });
});
```

### Tool Handler Context

```tsx
type ToolCtx = {
  roomId: string;
  actorId: string;                     // Who called this tool
  owner?: string;                      // Owner extracted from actorId
  state: Record<string, any>;          // Current shared state (read)
  setState: (s: Record<string, any>) => void;  // Set new state (write, shallow merge)
  timestamp: number;
  memory: Record<string, any>;         // Agent's persistent memory
  setMemory: (updates: Record<string, any>) => void;
};
```

Always spread existing state: `ctx.setState({ ...ctx.state, key: value })`.

## Canvas Props

```tsx
type CanvasProps = {
  roomId: string;
  actorId: string;
  sharedState: Record<string, any>;
  callTool: (name: string, input: any) => Promise<any>;
  participants: string[];
  ephemeralState: Record<string, Record<string, any>>;
  setEphemeral: (data: Record<string, any>) => void;
};
```

## Hooks

| Hook | Signature | Purpose |
|------|-----------|---------|
| `useToolCall` | `(callTool) => { call, loading, error }` | Wraps callTool with loading/error tracking |
| `useSharedState` | `(sharedState, key, default?) => value` | Typed accessor for a state key |
| `useOptimisticTool` | `(callTool, sharedState) => { call, state, pending }` | Optimistic updates with rollback |
| `useParticipants` | `(participants) => ParsedParticipant[]` | Parse actor IDs into `{ id, username, type, index }` |
| `useAnimationFrame` | `(sharedState, interpolate?) => displayState` | Buffer state updates to animation frames |
| `useFollow` | `(actorId, participants, ephemeral, setEphemeral) => { follow, unfollow, following, followers }` | Follow-mode protocol |
| `useTypingIndicator` | `(actorId, ephemeral, setEphemeral) => { setTyping, typingUsers }` | Typing indicators |
| `useUndo` | `(sharedState, callTool, opts?) => { undo, redo, canUndo, canRedo }` | Undo/redo via state snapshots. Requires `undoTool(z)` in tools array. |
| `useDebounce` | `(callTool, delayMs?) => debouncedCallTool` | Debounced tool calls (search, text input) |
| `useThrottle` | `(callTool, intervalMs?) => throttledCallTool` | Throttled tool calls (cursors, brushes, sliders) |

## Components

Pre-built, inline-styled (no Tailwind needed):

| Component | Key Props |
|-----------|-----------|
| `Button` | `onClick, disabled, variant: 'primary'\|'secondary'\|'danger'\|'ghost', size: 'sm'\|'md'\|'lg'` |
| `Card` | `title, style` |
| `Input` | `value, onChange: (value) => void, placeholder, type, disabled` |
| `Badge` | `color: 'gray'\|'blue'\|'green'\|'red'\|'yellow'\|'purple'` |
| `Stack` | `direction: 'row'\|'column', gap, align, justify` |
| `Grid` | `columns, gap` |
| `Slider` | `value, onChange, min, max, step, label` |
| `Textarea` | `value, onChange, placeholder, rows` |
| `Modal` | `open, onClose, title` |
| `ColorPicker` | `value, onChange, presets: string[]` |
| `Dropdown` | `value, onChange, options: [{value, label}], placeholder` |
| `Tabs` | `tabs: [{id, label}], activeTab, onTabChange` |

## Agent Slots

Define named agent roles for multi-agent experiences:

```tsx
manifest: {
  agentSlots: [
    {
      role: "game-master",
      systemPrompt: "You are the game master. Narrate the world, control NPCs, manage encounters.",
      allowedTools: ["world.narrate", "npc.speak", "combat.enemy_turn"],
      autoSpawn: true,
      maxInstances: 1,
    },
  ],
}
```

## Agent Hints

Declarative guidance for agent behavior:

```tsx
agentHints: [
  {
    trigger: "when a player joins",
    condition: "state.players?.length > state.lastGreetedCount",
    suggestedTools: ["world.narrate"],
    priority: "high",
    cooldownMs: 5000,
  },
]
```

## Room Configuration

Experiences can declare configurable parameters. Rooms are spawned with specific configs:

```tsx
import { defineRoomConfig } from "@vibevibes/sdk";

roomConfig: defineRoomConfig({
  schema: z.object({
    mode: z.enum(["combat", "explore"]).describe("Game mode"),
    difficulty: z.number().min(1).max(10).default(5),
  }),
  presets: {
    "boss-fight": { mode: "combat", difficulty: 10 },
    "peaceful": { mode: "explore", difficulty: 1 },
  },
})
```

## Undo/Redo

```tsx
import { undoTool, useUndo } from "@vibevibes/sdk";

// Add to tools array
const tools = [...yourTools, undoTool(z)];

// In Canvas
const { undo, redo, canUndo, canRedo } = useUndo(sharedState, callTool);
```

## Tests

Inline tests for tool handlers, run with `npm test`:

```tsx
import { defineTest } from "@vibevibes/sdk";

tests: [
  defineTest({
    name: "increment adds to count",
    run: async ({ tool, ctx, expect }) => {
      const inc = tool("counter.increment");
      const c = ctx({ state: { count: 5 } });
      await inc.handler(c, { amount: 3 });
      expect(c.getState().count).toBe(8);
    },
  }),
]
```

## Manifest

```tsx
type ExperienceManifest = {
  id: string;
  version: string;
  title: string;
  description: string;
  requested_capabilities: string[];   // e.g. ["room.spawn"]
  agentSlots?: AgentSlot[];
  category?: string;                  // "games", "productivity", "creative", etc.
  tags?: string[];
  netcode?: "default" | "tick" | "p2p-ephemeral";
  tickRateMs?: number;                // For tick netcode
  hotKeys?: string[];                 // Keys routed through ephemeral channel
};
```

## How It Works

```
Browser (Canvas)  <--WebSocket-->  Server  <--HTTP-->  MCP (Agent)
      |                              |
  callTool(name, input)     validates input (Zod)
                            runs handler(ctx, input)
                            ctx.setState(newState)
                            broadcasts to all clients
```

All state lives on the server. The Canvas renders it. Tools are the only mutation path. Both humans and agents use the same tools.

## License

MIT

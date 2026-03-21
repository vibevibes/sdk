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
```

### Tool Handler Context

```tsx
type ToolCtx = {
  roomId: string;
  actorId: string;                     // Who called this tool
  owner?: string;                      // Owner extracted from actorId
  state: Record<string, any>;          // Current shared state (read)
  setState: (s: Record<string, any>) => void;  // Set new state (write)
  timestamp: number;
  memory: Record<string, any>;         // Agent's persistent memory
  setMemory: (updates: Record<string, any>) => void;
};
```

Always spread existing state: `ctx.setState({ ...ctx.state, key: value })`.

## Canvas Props

```tsx
type CanvasProps = {
  actorId: string;
  sharedState: Record<string, any>;
  callTool: (name: string, input: any) => Promise<any>;
  participants: string[];
  ephemeralState: Record<string, Record<string, any>>;
  setEphemeral: (data: Record<string, any>) => void;
  stream?: (name: string, input: Record<string, unknown>) => void;
};
```

## Agent Slots

Define named agent roles for multi-agent experiences:

```tsx
manifest: {
  agentSlots: [
    {
      role: "game-master",
      systemPrompt: "You are the game master.",
      allowedTools: ["world.narrate", "npc.speak"],
      autoSpawn: true,
      maxInstances: 1,
    },
  ],
}
```

## Tests

Inline tests for tool handlers:

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
  requested_capabilities: string[];
  agentSlots?: AgentSlot[];
  participantSlots?: ParticipantSlot[];
  category?: string;
  tags?: string[];
  netcode?: "default" | "tick" | "p2p-ephemeral";
  tickRateMs?: number;
  hotKeys?: string[];
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

## Ecosystem

| Package | Description |
|---------|-------------|
| **@vibevibes/sdk** (this) | Define experiences — tools, canvas, state |
| [@vibevibes/mcp](https://github.com/vibevibes/mcp) | Runtime server — MCP + WebSocket + browser viewer |
| [create-vibevibes](https://github.com/vibevibes/create) | `npx create-vibevibes my-exp` — scaffold in seconds |
| [experiences](https://github.com/vibevibes/experiences) | Example experiences — fork and remix |

## License

MIT

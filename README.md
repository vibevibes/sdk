# @vibevibes/sdk

Primitives for building shared human-AI experiences — interactive apps where humans and AI agents collaborate in real-time through shared state, shared tools, and a shared canvas.

[![npm](https://img.shields.io/npm/v/@vibevibes/sdk)](https://www.npmjs.com/package/@vibevibes/sdk)
[![license](https://img.shields.io/npm/l/@vibevibes/sdk)](./LICENSE)

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
      amount: z.number().default(1),
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

**Tools are the only way to mutate state.** Every tool has a Zod schema and a handler that calls `ctx.setState()`. Humans use tools via the Canvas. Agents use the same tools via MCP. No backdoors.

**Canvas is a React component.** It receives current shared state and a `callTool` function. Re-renders on every state change.

**Agents are actors, not assistants.** They join rooms, watch for events, react with tools, and persist memory. Same participation model as humans.

## Tool Handler Context

```tsx
type ToolCtx = {
  roomId: string;
  actorId: string;        // Who called this tool
  owner?: string;         // Owner extracted from actorId
  state: Record<string, any>;     // Current shared state (read)
  setState: (s) => void;          // Set new state (write)
  timestamp: number;
  memory: Record<string, any>;    // Agent's persistent memory
  setMemory: (updates) => void;
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

## Hooks

| Hook | Returns | Purpose |
|------|---------|---------|
| `useToolCall(callTool)` | `{ call, loading, error }` | Loading/error tracking |
| `useSharedState(state, key, default?)` | `value` | Typed state accessor |
| `useOptimisticTool(callTool, state)` | `{ call, state, pending }` | Optimistic updates with rollback |
| `useParticipants(participants)` | `ParsedParticipant[]` | Parse actor IDs |
| `useAnimationFrame(state, interpolate?)` | `displayState` | Frame-rate buffering |

## Components

Inline-styled (no Tailwind needed): `Button`, `Card`, `Input`, `Badge`, `Stack`, `Grid`

## Agent Slots

```tsx
manifest: {
  agentSlots: [{
    role: "game-master",
    systemPrompt: "You are the game master.",
    allowedTools: ["world.narrate"],
    autoSpawn: true,
    maxInstances: 1,
  }],
}
```

## Tests

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

## Architecture

```
Browser (Canvas)  <--WebSocket-->  Server  <--HTTP-->  MCP (Agent)
      |                              |
  callTool(name, input)     validates input (Zod)
                            runs handler(ctx, input)
                            ctx.setState(newState)
                            broadcasts to all clients
```

## Ecosystem

| Package | Description |
|---------|-------------|
| **@vibevibes/sdk** | Define experiences — tools, canvas, state |
| [@vibevibes/mcp](https://github.com/vibevibes/mcp) | Runtime engine — MCP server + WebSocket + viewer |
| [@vibevibes/create](https://github.com/vibevibes/create) | `npm create @vibevibes` — scaffold in seconds |
| [experiences](https://github.com/vibevibes/experiences) | Example experiences — fork and remix |

## License

MIT

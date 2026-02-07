/**
 * Experience SDK Types - Simplified state sync
 */

import type React from "react";
import type { z } from "zod";

export type ToolRisk = "low" | "medium" | "high";

/**
 * Netcode mode declaration — experiences declare their sync strategy.
 * The runtime picks the right optimizations automatically.
 */
export type NetcodeMode = "default" | "tick" | "p2p-ephemeral";

/**
 * JSON Patch operation (RFC 6902 subset).
 */
export type JsonPatchOp = {
  op: "add" | "remove" | "replace";
  path: string;
  value?: any;
};

export type ExperienceImport = {
  experienceId: string;
  tools: string[] | '*';
  prefix?: string;
};

/**
 * Event emitted after a tool executes (used by typed event subscriptions).
 */
export type ToolEvent = {
  id: string;
  ts: number;
  actorId: string;
  owner?: string;
  tool: string;
  input: any;
  output?: any;
  error?: string;
};

/**
 * Agent slot definition for multi-agent rooms.
 * Experience authors define named agent roles with system prompts and tool restrictions.
 */
export type AgentSlot = {
  role: string;              // "facilitator", "critic", "scribe"
  systemPrompt: string;      // System prompt for this agent role
  allowedTools?: string[];   // If set, agent can only call these tools
  autoSpawn?: boolean;       // Spawn automatically when room is created (default false)
  maxInstances?: number;     // Max concurrent agents in this role (default 1)
};

export type ExperienceManifest = {
  id: string;
  version: string;
  title: string;
  description: string;
  requested_capabilities: string[];
  imports?: ExperienceImport[];
  agentSlots?: AgentSlot[];
  category?: string;  // "games" | "productivity" | "creative" | "education" | "social"
  tags?: string[];
  /** Sync strategy: 'default' | 'tick' | 'p2p-ephemeral'. Default: 'default'. */
  netcode?: NetcodeMode;
  /** For 'tick' netcode: server tick interval in ms (e.g. 50 = 20Hz). */
  tickRateMs?: number;
  /** State keys routed through fast ephemeral channel (no tool gate). */
  hotKeys?: string[];
};

/**
 * Simplified Tool Context (no yjs, no events array)
 *
 * Use the generic parameter for typed state:
 *   handler: async (ctx: ToolCtx<{ count: number }>, input) => {
 *     const current = ctx.state.count; // typed
 *   }
 */
export type ToolCtx<TState extends Record<string, any> = Record<string, any>> = {
  roomId: string;
  actorId: string;
  owner?: string;  // Who this actor is acting on behalf of (e.g. GitHub username)
  state: TState;  // Current shared state (read-only)
  setState: (newState: TState) => void;  // Mutate shared state
  timestamp: number;
  // Persistent memory: survives across room sessions (keyed by experience + owner)
  memory: Record<string, any>;
  setMemory: (updates: Record<string, any>) => void;
  /**
   * Spawn a child room with a specified experience.
   * Only available when manifest declares "room.spawn" in requested_capabilities.
   * Rate limited to 5 spawns per room per 5 minutes.
   */
  spawnRoom?: (opts: SpawnRoomOpts) => Promise<SpawnRoomResult>;
};

export type ToolDef<TInput = any, TOutput = any> = {
  name: string;
  description: string;
  input_schema: z.ZodTypeAny;
  risk: ToolRisk;
  capabilities_required: string[];
  handler: (ctx: ToolCtx, input: TInput) => Promise<TOutput>;
  // Typed event subscriptions
  emits?: string[];  // Events this tool emits after execution (e.g. ["card.moved"])
  on?: Record<string, (ctx: ToolCtx, event: ToolEvent) => Promise<void>>;  // React to events
  /**
   * If false, skip persisting state + event to DB after execution.
   * State is still broadcast to clients. Use for high-frequency tools
   * like cursor moves, animations, etc. Default: true.
   */
  persist?: boolean;
};

/**
 * Simplified Canvas Props - Hybrid State Model
 *
 * Use the generic parameter for typed sharedState:
 *   const Canvas: React.FC<CanvasProps<{ count: number }>> = ({ sharedState }) => {
 *     const count = sharedState.count; // fully typed
 *   };
 */
export type CanvasProps<TState extends Record<string, any> = Record<string, any>> = {
  roomId: string;
  actorId: string;

  // Persisted state (tool-gated)
  sharedState: TState;
  callTool: (name: string, input: any, predictFn?: (state: TState) => TState) => Promise<any>;

  /** Batch multiple tool calls in a single round-trip. */
  callTools?: (calls: Array<{ name: string; input: any }>) => Promise<any[]>;

  // Ephemeral state (direct updates, not persisted)
  ephemeralState: Record<string, Record<string, any>>; // actorId → data
  setEphemeral: (data: Record<string, any>) => void;

  /** Fire a client-authoritative action via Broadcast (no tool gate, no persistence). */
  dispatchEphemeralAction?: (name: string, input: any) => void;
  /** Subscribe to ephemeral actions from other participants. */
  onEphemeralAction?: (handler: (action: { name: string; input: any; actorId: string; ts: number }) => void) => () => void;

  // Participants
  participants: string[];
};

/**
 * Assertion chain returned by `expect()` in test helpers.
 */
export type ExpectChain<T> = {
  toBe: (expected: T) => void;
  toEqual: (expected: any) => void;
  toBeTruthy: () => void;
  toBeFalsy: () => void;
  toContain: (item: any) => void;
  toHaveProperty: (key: string, value?: any) => void;
  not: ExpectChain<T>;
};

/**
 * Helpers injected into each test's `run` function.
 *
 * - `tool(name)` looks up a tool from the experience's tools array
 * - `ctx(opts?)` creates a mock ToolCtx; call `getState()` after mutations
 * - `expect(actual)` returns an assertion chain for type-safe assertions
 * - `snapshot(label, value)` stores/compares values within a test session
 *
 * Tests signal failure by throwing. If `run` resolves, the test passed.
 */
export type TestHelpers = {
  tool: (name: string) => ToolDef;
  ctx: (opts?: {
    state?: Record<string, any>;
    actorId?: string;
    roomId?: string;
    owner?: string;
  }) => ToolCtx & { getState: () => Record<string, any> };
  expect: <T>(actual: T) => ExpectChain<T>;
  snapshot: (label: string, value: any) => void;
};

/**
 * Inline test for experience tool handlers.
 * Throw to fail; resolve to pass.
 */
export type TestDef = {
  name: string;
  run: (helpers: TestHelpers) => Promise<void>;
};

/**
 * Declarative hint for agents about when to act.
 * Experience authors include these to guide agent behavior.
 */
export type AgentHint = {
  trigger: string;              // "When a new message is posted"
  condition?: string;           // "state.turn === 'ai'"
  suggestedTools: string[];     // ["chat.reply"]
  priority?: 'low' | 'medium' | 'high';
  cooldownMs?: number;
  /** Cross-room agent coordination: follow linked rooms and react to activity there. */
  crossRoom?: {
    linkTypes?: string[];       // which link types to follow: ["spawned", "referenced"]
    watchFor?: string[];        // tool names to watch for in linked rooms
  };
};

/**
 * Client-authoritative action that bypasses the tool gate entirely.
 * Goes through Supabase Broadcast directly — no persistence, no server validation.
 * Use for cursor positions, hover states, drag previews, etc.
 */
export type EphemeralActionDef = {
  name: string;
  description: string;
  input_schema: z.ZodTypeAny;
};

/**
 * Performance metrics exposed by the room sync system.
 */
export type PerfMetrics = {
  toolCallRtts: number[];       // Last N tool call round-trip times (ms)
  broadcastLatencies: number[]; // Last N broadcast receive latencies (ms)
  stateSize: number;            // Current shared state size in bytes
  rendersPerSecond: number;     // Approximate render frequency
  pendingOptimistic: number;    // Number of unconfirmed optimistic updates
};

/**
 * Follow protocol: allows participants to "follow" another user's viewport/actions.
 * Stored in ephemeral state under the `_follow` key.
 */
export type FollowState = {
  targetActorId: string;         // Who you're following
  mode: 'viewport' | 'actions' | 'both';  // What to sync
  since: number;                 // Timestamp when follow started
};

/**
 * Multi-agent message for negotiation protocol.
 * Agents communicate through shared state under the `_agentMessages` key.
 */
export type AgentMessage = {
  id: string;
  from: string;                  // actorId of sender
  to: string | '*';              // actorId of recipient or '*' for broadcast
  type: 'proposal' | 'vote' | 'delegate' | 'inform' | 'request';
  content: string;               // Natural language message
  data?: Record<string, any>;    // Structured payload
  ts: number;
  ttl?: number;                  // Auto-expire after N ms
};

/**
 * State migration function for experience versioning.
 * Called when a room's experience version changes.
 */
export type StateMigration = {
  from: string;                  // semver: version migrating from
  to: string;                    // semver: version migrating to
  migrate: (oldState: Record<string, any>) => Record<string, any>;
};

/**
 * Webhook event types that can be filtered.
 */
export type WebhookEventType =
  | 'tool.executed'
  | 'tool.error'
  | 'participant.joined'
  | 'participant.left'
  | 'state.changed'
  | 'room.created'
  | 'room.reset';

/**
 * Options for spawning a child room from a tool handler.
 * Requires "room.spawn" in manifest.requested_capabilities.
 */
export type SpawnRoomOpts = {
  experienceId: string;
  name?: string;
  initialState?: Record<string, any>;
  /** If true, store parent roomId in child state as _parentRoom */
  linkBack?: boolean;
};

export type SpawnRoomResult = {
  roomId: string;
  url: string;
};

/**
 * A link between two rooms (parent/child relationship).
 */
export type RoomLink = {
  parentRoomId: string;
  childRoomId: string;
  linkType: 'spawned' | 'referenced' | 'forked';
  metadata?: Record<string, any>;
  createdAt: string;
};

export type ExperienceModule = {
  manifest: ExperienceManifest;
  Canvas: React.FC<CanvasProps>;
  tools: ToolDef[];
  tests?: TestDef[];
  agentHints?: AgentHint[];
  /** Client-authoritative actions that bypass the tool gate. */
  ephemeralActions?: EphemeralActionDef[];
  /** State migrations for version upgrades. */
  migrations?: StateMigration[];
};

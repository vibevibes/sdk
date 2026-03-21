/**
 * Experience SDK Types
 */

import type React from "react";
import type { z } from "zod";

export type ToolRisk = "low" | "medium" | "high";

export type CallToolFn = (name: string, input: Record<string, unknown>) => Promise<unknown>;

export type ZodFactory = typeof z;

export type ToolEvent = {
  id: string;
  ts: number;
  actorId: string;
  owner?: string;
  tool: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
};

export type AgentSlot = {
  role: string;
  systemPrompt: string;
  allowedTools?: string[];
  autoSpawn?: boolean;
  maxInstances?: number;
};

export type ParticipantSlot = {
  role: string;
  type?: "human" | "ai" | "any";
  systemPrompt?: string;
  allowedTools?: string[];
  autoSpawn?: boolean;
  maxInstances?: number;
};

export type ParticipantDetail = {
  actorId: string;
  type: "human" | "ai" | "unknown";
  role?: string;
  metadata?: Record<string, string>;
};

export type ExperienceManifest = {
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

export type StreamDef<TInput = any> = {
  name: string;
  description?: string;
  input_schema: z.ZodTypeAny;
  merge: (state: Record<string, any>, input: TInput, actorId: string) => Record<string, any>;
  rateLimit?: number;
};

export type ToolCtx<
  TState extends Record<string, any> = Record<string, any>,
> = {
  roomId: string;
  actorId: string;
  owner?: string;
  state: TState;
  setState: (newState: TState) => void;
  timestamp: number;
  memory: Record<string, any>;
  setMemory: (updates: Record<string, any>) => void;
};

export type ToolDef<TInput = any, TOutput = any> = {
  name: string;
  description: string;
  input_schema: z.ZodTypeAny;
  risk: ToolRisk;
  capabilities_required: string[];
  handler: (ctx: ToolCtx, input: TInput) => Promise<TOutput>;
  emits?: string[];
  on?: Record<string, (ctx: ToolCtx, event: ToolEvent) => Promise<void>>;
  persist?: boolean;
};

export type CanvasProps<
  TState extends Record<string, any> = Record<string, any>,
> = {
  actorId: string;
  sharedState: TState;
  callTool: (name: string, input: Record<string, unknown>, predictFn?: (state: TState) => TState) => Promise<unknown>;
  callTools?: (calls: Array<{ name: string; input: Record<string, unknown> }>) => Promise<unknown[]>;
  ephemeralState: Record<string, Record<string, any>>;
  setEphemeral: (data: Record<string, any>) => void;
  stream?: (name: string, input: Record<string, unknown>) => void;
  participants: string[];
  participantDetails?: ParticipantDetail[];
  role?: "spectator" | "player";
};

export type ExpectChain<T> = {
  toBe: (expected: T) => void;
  toEqual: (expected: unknown) => void;
  toBeTruthy: () => void;
  toBeFalsy: () => void;
  toContain: (item: unknown) => void;
  toHaveProperty: (key: string, value?: unknown) => void;
  toBeGreaterThan: (expected: number) => void;
  toBeLessThan: (expected: number) => void;
  not: ExpectChain<T>;
};

export type TestHelpers = {
  tool: (name: string) => ToolDef;
  ctx: (opts?: {
    state?: Record<string, any>;
    actorId?: string;
    roomId?: string;
    owner?: string;
  }) => ToolCtx & { getState: () => Record<string, any> };
  expect: <T>(actual: T) => ExpectChain<T>;
  snapshot: (label: string, value: unknown) => void;
  observe: (state: Record<string, any>, actorId?: string) => Record<string, any>;
  agentSlots: () => Array<{ role: string; systemPrompt?: string; allowedTools?: string[]; [k: string]: unknown }>;
};

export type TestDef = {
  name: string;
  run: (helpers: TestHelpers) => Promise<void>;
};

export type RegistryEntry = {
  path: string;
};

export type ExperienceRegistry = {
  experiences: Record<string, RegistryEntry>;
};

export type ExperienceModule = {
  manifest: ExperienceManifest;
  Canvas: React.FC<CanvasProps>;
  tools: ToolDef[];
  tests?: TestDef[];
  stateSchema?: z.ZodTypeAny;
  streams?: StreamDef[];
  observe?: (state: Record<string, any>, event: ToolEvent | null, actorId: string) => Record<string, any>;
};

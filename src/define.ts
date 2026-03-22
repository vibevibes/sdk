import type { z } from "zod";
import type {
  ToolDef,
  ToolRisk,
  TestDef,
  ExperienceModule,
  ExperienceManifest,
  StreamDef,
  AgentSlot,
  ParticipantSlot,
  ZodFactory,
} from "./types.js";

export function defineTool<TInput, TOutput>(config: {
  name: string;
  description: string;
  input_schema: z.ZodType<TInput>;
  risk?: ToolRisk;
  capabilities_required?: string[];
  handler: ToolDef<TInput, TOutput>["handler"];
}): ToolDef<TInput, TOutput> {
  return {
    name: config.name,
    description: config.description,
    input_schema: config.input_schema,
    risk: config.risk ?? "low",
    capabilities_required: config.capabilities_required ?? [],
    handler: config.handler,
  };
}

export function defineTest(config: {
  name: string;
  run: TestDef["run"];
}): TestDef {
  return { name: config.name, run: config.run };
}

export function defineStream<TInput>(config: {
  name: string;
  description?: string;
  input_schema: z.ZodType<TInput>;
  merge: (state: Record<string, any>, input: TInput, actorId: string) => Record<string, any>;
  rateLimit?: number;
}): StreamDef<TInput> {
  return {
    name: config.name,
    description: config.description,
    input_schema: config.input_schema,
    merge: config.merge,
    rateLimit: config.rateLimit,
  };
}

export function defineExperience(module: ExperienceModule & {
  initialState?: Record<string, any>;
  agents?: Array<{
    role: string;
    systemPrompt: string;
    allowedTools?: string[];
    autoSpawn?: boolean;
    maxInstances?: number;
  }>;
  participants?: ParticipantSlot[];
  name?: string;
}): ExperienceModule & { initialState?: Record<string, any> } {
  const m = module.manifest ?? ({} as Partial<ExperienceManifest>);

  let initialState = module.initialState;
  if (module.stateSchema && !initialState) {
    try {
      initialState = module.stateSchema.parse(undefined);
    } catch {
      try {
        initialState = module.stateSchema.parse({});
      } catch {
        // Schema has required fields with no defaults
      }
    }
  }

  if (module.stateSchema && initialState) {
    try {
      module.stateSchema.parse(initialState);
    } catch (err: unknown) {
      console.warn(
        `[vibevibes] initialState does not match stateSchema: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  const rawParticipantSlots: ParticipantSlot[] | undefined =
    module.participants ??
    m.participantSlots ??
    (module.agents || m.agentSlots)?.map((a) => ({ ...a, type: "ai" as const }));

  const hasOrchestrator = rawParticipantSlots?.some((s) => s.role === "orchestrator");
  const participantSlots: ParticipantSlot[] | undefined = rawParticipantSlots
    ? hasOrchestrator
      ? rawParticipantSlots
      : [...rawParticipantSlots, { role: "orchestrator", type: "ai" as const, maxInstances: 1 }]
    : [{ role: "orchestrator", type: "ai" as const, maxInstances: 1 }];

  const agentSlots = (participantSlots?.filter(
    (s) => s.type === "ai" || s.type === undefined || s.type === "any"
  ) as AgentSlot[]) ?? m.agentSlots ?? module.agents;

  return {
    ...module,
    initialState,
    manifest: {
      ...m,
      title: m.title || module.name || m.id,
      version: m.version || "0.0.1",
      requested_capabilities: m.requested_capabilities || ["state.write"],
      participantSlots: participantSlots ?? m.participantSlots,
      agentSlots: agentSlots ?? m.agentSlots,
    },
  };
}

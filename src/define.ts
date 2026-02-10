import type { z } from "zod";
import type {
  ToolDef,
  ToolRisk,
  TestDef,
  ExperienceModule,
  EphemeralActionDef,
  RoomConfigDef,
  StreamDef,
} from "./types";

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

export function defineEphemeralAction(config: {
  name: string;
  description: string;
  input_schema: z.ZodTypeAny;
}): EphemeralActionDef {
  return {
    name: config.name,
    description: config.description,
    input_schema: config.input_schema,
  };
}

/**
 * Reduced-boilerplate tool definition.
 * Auto-derives defaults: risk="low", capabilities=["state.write"],
 * and spreads input into state if no handler is provided.
 *
 * Usage:
 *   quickTool("counter.increment", "Add 1 to count", z.object({}), async (ctx) => {
 *     ctx.setState({ ...ctx.state, count: (ctx.state.count ?? 0) + 1 });
 *   })
 */
export function quickTool<TInput>(
  name: string,
  description: string,
  input_schema: z.ZodType<TInput>,
  handler: ToolDef<TInput, any>["handler"],
): ToolDef<TInput, any> {
  return {
    name,
    description,
    input_schema,
    risk: "low",
    capabilities_required: ["state.write"],
    handler,
  };
}

/**
 * Pre-built tool that restores shared state to a previous snapshot.
 * Required for useUndo/useRedo to work. Add it to your tools array:
 *
 *   tools: [...yourTools, undoTool(z)]
 */
export function undoTool(zod: any): ToolDef<{ state: Record<string, any> }, { restored: boolean }> {
  return {
    name: "_state.restore",
    description: "Restore shared state to a previous snapshot (used by undo/redo)",
    input_schema: zod.object({
      state: zod.record(zod.any()).describe("The state snapshot to restore"),
    }),
    risk: "low",
    capabilities_required: ["state.write"],
    handler: async (ctx: any, input: { state: Record<string, any> }) => {
      ctx.setState(input.state);
      return { restored: true };
    },
  };
}

/**
 * Pre-built tool for phase transitions. Required for usePhase to work.
 * Add it to your tools array:
 *
 *   tools: [...yourTools, phaseTool(z)]
 *
 * Optionally pass the list of valid phases for validation:
 *   phaseTool(z, ["setup", "playing", "scoring", "finished"])
 */
export function phaseTool(zod: any, validPhases?: readonly string[]): ToolDef<{ phase: string }, { phase: string }> {
  const phaseSchema = validPhases
    ? zod.enum(validPhases as [string, ...string[]])
    : zod.string();

  return {
    name: "_phase.set",
    description: "Transition to a new phase/stage of the experience",
    input_schema: zod.object({
      phase: phaseSchema.describe("The phase to transition to"),
    }),
    risk: "low" as ToolRisk,
    capabilities_required: ["state.write"],
    handler: async (ctx: any, input: { phase: string }) => {
      ctx.setState({ ...ctx.state, phase: input.phase });
      return { phase: input.phase };
    },
  };
}

/**
 * Define a room configuration schema.
 * Rooms spawned with this experience will be validated against this schema.
 *
 * Usage:
 *   import { defineRoomConfig } from "@vibevibes/sdk";
 *   import { z } from "zod";
 *
 *   const roomConfig = defineRoomConfig({
 *     schema: z.object({
 *       mode: z.enum(["combat", "explore", "dialogue"]),
 *       difficulty: z.number().min(1).max(10).default(5),
 *     }),
 *     defaults: { mode: "explore", difficulty: 5 },
 *     presets: {
 *       "boss-fight": { mode: "combat", difficulty: 10 },
 *       "peaceful":   { mode: "explore", difficulty: 1 },
 *     },
 *     description: "Configure the room's game mode and difficulty",
 *   });
 */
export function defineRoomConfig<TConfig extends Record<string, any>>(
  config: RoomConfigDef<TConfig>,
): RoomConfigDef<TConfig> {
  return config;
}

/**
 * Define a continuous state stream for high-frequency human input.
 * Streams bypass the full tool handler pipeline but still validate input
 * and persist to shared state via a pure merge function.
 *
 * Usage:
 *   import { defineStream } from "@vibevibes/sdk";
 *   import { z } from "zod";
 *
 *   const brushStream = defineStream({
 *     name: "brush.stroke",
 *     description: "Continuous brush stroke data",
 *     input_schema: z.object({
 *       x: z.number(),
 *       y: z.number(),
 *       pressure: z.number().min(0).max(1),
 *       color: z.string(),
 *     }),
 *     merge: (state, input, actorId) => ({
 *       ...state,
 *       strokes: [...(state.strokes || []), { ...input, actorId, ts: Date.now() }],
 *     }),
 *     rateLimit: 60, // max 60 inputs/sec/actor
 *   });
 */
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
  /** Initial state for the experience. If stateSchema is provided and initialState is not,
   *  defaults are extracted from the schema automatically. */
  initialState?: Record<string, any>;
  /** Agent slot configurations. */
  agents?: Array<{
    role: string;
    systemPrompt: string;
    allowedTools?: string[];
    autoSpawn?: boolean;
    maxInstances?: number;
  }>;
  /** Display name (convenience, copied to manifest.title if manifest.title is missing). */
  name?: string;
}): ExperienceModule & { initialState?: Record<string, any> } {
  // Apply manifest defaults (manifest is optional for local dev)
  const m = module.manifest ?? {} as any;

  // If stateSchema provided, extract defaults for initialState
  let initialState = module.initialState;
  if (module.stateSchema && !initialState) {
    try {
      // Parse undefined through the schema to extract all .default() values
      initialState = module.stateSchema.parse(undefined);
    } catch {
      try {
        // If the schema doesn't accept undefined, try parsing empty object
        initialState = module.stateSchema.parse({});
      } catch {
        // Schema has required fields with no defaults — initialState must be provided manually
      }
    }
  }

  // Validate initialState against schema if both are provided
  if (module.stateSchema && initialState) {
    try {
      module.stateSchema.parse(initialState);
    } catch (err: any) {
      console.warn(
        `[vibevibes] initialState does not match stateSchema: ${err.message ?? err}`
      );
    }
  }

  // Copy agents into manifest.agentSlots if provided at top level
  const agentSlots = m.agentSlots ?? module.agents;

  return {
    ...module,
    initialState,
    manifest: {
      ...m,
      title: m.title || module.name || m.id,
      version: m.version || "0.0.1",
      requested_capabilities: m.requested_capabilities || ["state.write"],
      agentSlots: agentSlots ?? m.agentSlots,
    },
  };
}

export function validateExperience(module: ExperienceModule & { initialState?: Record<string, any> }): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!module.manifest?.id) {
    errors.push("manifest.id is required");
  }
  if (!module.manifest?.version) {
    errors.push("manifest.version is required");
  }
  if (!module.manifest?.title) {
    errors.push("manifest.title is required");
  }
  if (!module.Canvas) {
    errors.push("Canvas component is required");
  }
  if (!Array.isArray(module.tools)) {
    errors.push("tools must be an array");
  } else {
    module.tools.forEach((tool, idx) => {
      if (!tool.name) {
        errors.push(`tools[${idx}].name is required`);
      }
      if (!tool.input_schema) {
        errors.push(`tools[${idx}].input_schema is required`);
      }
      if (typeof tool.handler !== "function") {
        errors.push(`tools[${idx}].handler must be a function`);
      }
    });
  }

  // Validate stateSchema if provided
  if (module.stateSchema) {
    if (!module.initialState) {
      // Try to extract defaults
      try {
        module.stateSchema.parse({});
      } catch {
        warnings.push("stateSchema has required fields without defaults — provide initialState explicitly");
      }
    } else {
      try {
        module.stateSchema.parse(module.initialState);
      } catch (err: any) {
        errors.push(`initialState does not match stateSchema: ${err.message ?? err}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

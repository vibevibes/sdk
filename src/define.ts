import type { z } from "zod";
import type {
  ToolDef,
  ToolRisk,
  TestDef,
  ExperienceModule,
  EphemeralActionDef,
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

export function defineExperience(module: ExperienceModule): ExperienceModule {
  // Apply manifest defaults
  const m = module.manifest;
  return {
    ...module,
    manifest: {
      ...m,
      version: m.version || "0.0.1",
      requested_capabilities: m.requested_capabilities || ["state.write"],
    },
  };
}

export function validateExperience(module: ExperienceModule): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

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

  return {
    valid: errors.length === 0,
    errors,
  };
}

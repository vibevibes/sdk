import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  defineTool,
  defineTest,
  defineExperience,
  defineEphemeralAction,
  quickTool,
  validateExperience,
} from "../define";
import type { ExperienceModule, ToolCtx } from "../types";

// ─── defineTool ──────────────────────────────────────────────────────────────

describe("defineTool", () => {
  it("returns a tool with all required fields", () => {
    const tool = defineTool({
      name: "test.action",
      description: "A test action",
      input_schema: z.object({ value: z.number() }),
      risk: "medium",
      capabilities_required: ["state.write"],
      handler: async (ctx, input) => {
        ctx.setState({ ...ctx.state, v: input.value });
        return { ok: true };
      },
    });

    expect(tool.name).toBe("test.action");
    expect(tool.description).toBe("A test action");
    expect(tool.risk).toBe("medium");
    expect(tool.capabilities_required).toEqual(["state.write"]);
    expect(typeof tool.handler).toBe("function");
    expect(tool.input_schema).toBeDefined();
  });

  it("defaults risk to 'low' when omitted", () => {
    const tool = defineTool({
      name: "test.low",
      description: "Low risk",
      input_schema: z.object({}),
      handler: async () => ({ ok: true }),
    });

    expect(tool.risk).toBe("low");
  });

  it("defaults capabilities_required to empty array when omitted", () => {
    const tool = defineTool({
      name: "test.nocaps",
      description: "No caps",
      input_schema: z.object({}),
      handler: async () => ({ ok: true }),
    });

    expect(tool.capabilities_required).toEqual([]);
  });

  it("handler executes and mutates state via ctx.setState", async () => {
    const tool = defineTool({
      name: "counter.increment",
      description: "Increment counter",
      input_schema: z.object({ amount: z.number() }),
      handler: async (ctx, input) => {
        const count = (ctx.state.count ?? 0) + input.amount;
        ctx.setState({ ...ctx.state, count });
        return { count };
      },
    });

    let capturedState: Record<string, any> = {};
    const ctx: ToolCtx = {
      roomId: "room-1",
      actorId: "user-1",
      state: { count: 5 },
      setState: (s) => { capturedState = s; },
      timestamp: Date.now(),
      memory: {},
      setMemory: () => {},
    };

    const result = await tool.handler(ctx, { amount: 3 });
    expect(result).toEqual({ count: 8 });
    expect(capturedState.count).toBe(8);
  });
});

// ─── quickTool ───────────────────────────────────────────────────────────────

describe("quickTool", () => {
  it("creates a tool with low risk and state.write capability", () => {
    const tool = quickTool(
      "quick.action",
      "A quick action",
      z.object({}),
      async (ctx) => {
        ctx.setState({ ...ctx.state, done: true });
      },
    );

    expect(tool.name).toBe("quick.action");
    expect(tool.risk).toBe("low");
    expect(tool.capabilities_required).toEqual(["state.write"]);
  });
});

// ─── defineTest ──────────────────────────────────────────────────────────────

describe("defineTest", () => {
  it("returns a test with name and run function", () => {
    const test = defineTest({
      name: "my test",
      run: async () => {},
    });

    expect(test.name).toBe("my test");
    expect(typeof test.run).toBe("function");
  });
});

// ─── defineEphemeralAction ──────────────────────────────────────────────────

describe("defineEphemeralAction", () => {
  it("returns an ephemeral action with required fields", () => {
    const action = defineEphemeralAction({
      name: "cursor.move",
      description: "Move cursor",
      input_schema: z.object({ x: z.number(), y: z.number() }),
    });

    expect(action.name).toBe("cursor.move");
    expect(action.description).toBe("Move cursor");
    expect(action.input_schema).toBeDefined();
  });
});

// ─── defineExperience ────────────────────────────────────────────────────────

describe("defineExperience", () => {
  const makeModule = (overrides: Partial<ExperienceModule> = {}): ExperienceModule => ({
    manifest: {
      id: "test-exp",
      version: "1.0.0",
      title: "Test Experience",
      description: "A test",
      requested_capabilities: ["state.write"],
    },
    Canvas: (() => null) as any,
    tools: [],
    ...overrides,
  });

  it("returns the module with manifest defaults applied", () => {
    const mod = defineExperience(makeModule());
    expect(mod.manifest.id).toBe("test-exp");
    expect(mod.manifest.version).toBe("1.0.0");
    expect(mod.Canvas).toBeDefined();
    expect(mod.tools).toEqual([]);
  });

  it("defaults version to 0.0.1 when empty string", () => {
    const mod = defineExperience(makeModule({
      manifest: {
        id: "test",
        version: "",
        title: "Test",
        description: "Test",
        requested_capabilities: [],
      },
    }));
    expect(mod.manifest.version).toBe("0.0.1");
  });

  it("defaults requested_capabilities when falsy", () => {
    const mod = defineExperience(makeModule({
      manifest: {
        id: "test",
        version: "1.0.0",
        title: "Test",
        description: "Test",
        requested_capabilities: undefined as any,
      },
    }));
    expect(mod.manifest.requested_capabilities).toEqual(["state.write"]);
  });

  it("preserves optional fields like tests and agentHints", () => {
    const testDef = defineTest({ name: "t", run: async () => {} });
    const mod = defineExperience(makeModule({
      tests: [testDef],
      agentHints: [{ trigger: "test", suggestedTools: ["foo"] }],
    }));
    expect(mod.tests).toHaveLength(1);
    expect(mod.agentHints).toHaveLength(1);
  });
});

// ─── validateExperience ─────────────────────────────────────────────────────

describe("validateExperience", () => {
  const makeValid = (): ExperienceModule => ({
    manifest: {
      id: "test",
      version: "1.0.0",
      title: "Test",
      description: "Test",
      requested_capabilities: ["state.write"],
    },
    Canvas: (() => null) as any,
    tools: [
      defineTool({
        name: "test.action",
        description: "Test",
        input_schema: z.object({}),
        handler: async () => ({ ok: true }),
      }),
    ],
  });

  it("validates a correct experience", () => {
    const result = validateExperience(makeValid());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects missing manifest.id", () => {
    const mod = makeValid();
    (mod.manifest as any).id = "";
    const result = validateExperience(mod);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("manifest.id is required");
  });

  it("rejects missing manifest.version", () => {
    const mod = makeValid();
    (mod.manifest as any).version = "";
    const result = validateExperience(mod);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("manifest.version is required");
  });

  it("rejects missing Canvas", () => {
    const mod = makeValid();
    (mod as any).Canvas = null;
    const result = validateExperience(mod);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Canvas component is required");
  });

  it("rejects non-array tools", () => {
    const mod = makeValid();
    (mod as any).tools = "not-an-array";
    const result = validateExperience(mod);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("tools must be an array");
  });

  it("rejects tool without name", () => {
    const mod = makeValid();
    (mod.tools[0] as any).name = "";
    const result = validateExperience(mod);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name is required"))).toBe(true);
  });

  it("rejects tool without handler", () => {
    const mod = makeValid();
    (mod.tools[0] as any).handler = "not-a-function";
    const result = validateExperience(mod);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("handler must be a function"))).toBe(true);
  });

  it("rejects tool without input_schema", () => {
    const mod = makeValid();
    (mod.tools[0] as any).input_schema = undefined;
    const result = validateExperience(mod);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("input_schema is required"))).toBe(true);
  });
});

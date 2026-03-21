import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  defineTool,
  defineTest,
  defineExperience,
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
      roomId: "local",
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

  it("preserves optional fields like tests", () => {
    const testDef = defineTest({ name: "t", run: async () => {} });
    const mod = defineExperience(makeModule({
      tests: [testDef],
    }));
    expect(mod.tests).toHaveLength(1);
  });
});


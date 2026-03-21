import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineStream, defineExperience } from "../define";
import type { StreamDef, ExperienceModule } from "../types";

// ─── defineStream ─────────────────────────────────────────────────────────────

describe("defineStream", () => {
  it("returns a StreamDef with all required fields", () => {
    const stream = defineStream({
      name: "brush.stroke",
      description: "Continuous brush stroke data",
      input_schema: z.object({
        x: z.number(),
        y: z.number(),
        pressure: z.number().min(0).max(1),
      }),
      merge: (state, input, actorId) => ({
        ...state,
        strokes: [...(state.strokes || []), { ...input, actorId }],
      }),
      rateLimit: 60,
    });

    expect(stream.name).toBe("brush.stroke");
    expect(stream.description).toBe("Continuous brush stroke data");
    expect(stream.input_schema).toBeDefined();
    expect(typeof stream.merge).toBe("function");
    expect(stream.rateLimit).toBe(60);
  });

  it("allows omitting optional fields", () => {
    const stream = defineStream({
      name: "slider.move",
      input_schema: z.object({ value: z.number() }),
      merge: (state, input) => ({ ...state, slider: input.value }),
    });

    expect(stream.name).toBe("slider.move");
    expect(stream.description).toBeUndefined();
    expect(stream.rateLimit).toBeUndefined();
  });

  it("merge function correctly transforms state", () => {
    const stream = defineStream({
      name: "counter.tick",
      input_schema: z.object({ delta: z.number() }),
      merge: (state, input, actorId) => ({
        ...state,
        count: (state.count || 0) + input.delta,
        lastActor: actorId,
      }),
    });

    const initialState = { count: 10 };
    const result = stream.merge(initialState, { delta: 5 }, "user-1");

    expect(result.count).toBe(15);
    expect(result.lastActor).toBe("user-1");
  });

  it("merge function preserves existing state keys", () => {
    const stream = defineStream({
      name: "position.update",
      input_schema: z.object({ x: z.number(), y: z.number() }),
      merge: (state, input) => ({
        ...state,
        position: { x: input.x, y: input.y },
      }),
    });

    const state = { name: "player", hp: 100 };
    const result = stream.merge(state, { x: 10, y: 20 }, "user-1");

    expect(result.name).toBe("player");
    expect(result.hp).toBe(100);
    expect(result.position).toEqual({ x: 10, y: 20 });
  });

  it("input_schema validates correctly", () => {
    const schema = z.object({
      x: z.number(),
      y: z.number(),
    });

    const stream = defineStream({
      name: "drag",
      input_schema: schema,
      merge: (state, input) => ({ ...state, pos: input }),
    });

    // Valid input
    const valid = stream.input_schema.safeParse({ x: 1, y: 2 });
    expect(valid.success).toBe(true);

    // Invalid input
    const invalid = stream.input_schema.safeParse({ x: "not a number" });
    expect(invalid.success).toBe(false);
  });
});

// ─── defineExperience with streams ────────────────────────────────────────────

describe("defineExperience with streams", () => {
  it("preserves streams in the experience module", () => {
    const brushStream = defineStream({
      name: "brush.stroke",
      input_schema: z.object({ x: z.number(), y: z.number() }),
      merge: (state, input) => ({ ...state, lastStroke: input }),
    });

    const mod = defineExperience({
      manifest: {
        id: "paint-app",
        version: "1.0.0",
        title: "Paint App",
        description: "A painting experience",
        requested_capabilities: ["state.write"],
      },
      Canvas: (() => null) as any,
      tools: [],
      streams: [brushStream],
    });

    expect(mod.streams).toHaveLength(1);
    expect(mod.streams![0].name).toBe("brush.stroke");
  });

  it("allows multiple streams on one experience", () => {
    const stream1 = defineStream({
      name: "brush.stroke",
      input_schema: z.object({ x: z.number() }),
      merge: (s) => s,
    });

    const stream2 = defineStream({
      name: "slider.value",
      input_schema: z.object({ v: z.number() }),
      merge: (s) => s,
    });

    const mod = defineExperience({
      manifest: {
        id: "multi-stream",
        version: "1.0.0",
        title: "Multi Stream",
        description: "Multiple streams",
        requested_capabilities: [],
      },
      Canvas: (() => null) as any,
      tools: [],
      streams: [stream1, stream2],
    });

    expect(mod.streams).toHaveLength(2);
    expect(mod.streams!.map(s => s.name)).toEqual(["brush.stroke", "slider.value"]);
  });
});

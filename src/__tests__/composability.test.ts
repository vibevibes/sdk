import { describe, it, expect } from "vitest";
import { z } from "zod";
import { importTools } from "../composability";
import { defineTool } from "../define";
import type { ToolDef } from "../types";

// ─── importTools ──────────────────────────────────────────────────────────────

describe("importTools", () => {
  const mockTools: ToolDef[] = [
    defineTool({
      name: "chat.send",
      description: "Send a chat message",
      input_schema: z.object({ message: z.string() }),
      handler: async () => ({ ok: true }),
    }),
    defineTool({
      name: "chat.clear",
      description: "Clear chat history",
      input_schema: z.object({}),
      handler: async () => ({ ok: true }),
    }),
    defineTool({
      name: "chat.react",
      description: "React to a message",
      input_schema: z.object({ messageId: z.string(), emoji: z.string() }),
      handler: async () => ({ ok: true }),
    }),
  ];

  const mockExperience = { tools: mockTools };

  it("imports all tools with '*'", () => {
    const imported = importTools(mockExperience, "*");
    expect(imported).toHaveLength(3);
    expect(imported.map(t => t.name)).toEqual(["chat.send", "chat.clear", "chat.react"]);
  });

  it("imports specific tools by name", () => {
    const imported = importTools(mockExperience, ["chat.send", "chat.clear"]);
    expect(imported).toHaveLength(2);
    expect(imported.map(t => t.name)).toEqual(["chat.send", "chat.clear"]);
  });

  it("imports a single tool", () => {
    const imported = importTools(mockExperience, ["chat.send"]);
    expect(imported).toHaveLength(1);
    expect(imported[0].name).toBe("chat.send");
  });

  it("adds prefix to all imported tools", () => {
    const imported = importTools(mockExperience, "*", "embedded");
    expect(imported.map(t => t.name)).toEqual([
      "embedded.chat.send",
      "embedded.chat.clear",
      "embedded.chat.react",
    ]);
  });

  it("adds prefix to specific imported tools", () => {
    const imported = importTools(mockExperience, ["chat.send"], "ns");
    expect(imported).toHaveLength(1);
    expect(imported[0].name).toBe("ns.chat.send");
  });

  it("preserves tool properties when importing", () => {
    const imported = importTools(mockExperience, ["chat.send"]);
    const original = mockTools[0];

    expect(imported[0].description).toBe(original.description);
    expect(imported[0].input_schema).toBe(original.input_schema);
    expect(imported[0].handler).toBe(original.handler);
    expect(imported[0].risk).toBe(original.risk);
  });

  it("preserves tool properties when prefixed", () => {
    const imported = importTools(mockExperience, ["chat.send"], "ns");
    const original = mockTools[0];

    expect(imported[0].description).toBe(original.description);
    expect(imported[0].handler).toBe(original.handler);
  });

  it("throws when requesting non-existent tools", () => {
    expect(() =>
      importTools(mockExperience, ["chat.send", "chat.nonexistent"])
    ).toThrow("importTools: tools not found: chat.nonexistent");
  });

  it("throws when requesting multiple non-existent tools", () => {
    expect(() =>
      importTools(mockExperience, ["foo", "bar"])
    ).toThrow("importTools: tools not found: foo, bar");
  });

  it("throws when experience module has no tools", () => {
    expect(() =>
      importTools({} as any, "*")
    ).toThrow("importTools: experience module has no tools array");
  });

  it("throws when experience module tools is null", () => {
    expect(() =>
      importTools({ tools: null } as any, "*")
    ).toThrow("importTools: experience module has no tools array");
  });

  it("returns a new array (does not mutate source)", () => {
    const imported = importTools(mockExperience, "*");
    expect(imported).not.toBe(mockTools);
    imported.push(defineTool({
      name: "extra",
      description: "Extra tool",
      input_schema: z.object({}),
      handler: async () => ({}),
    }));
    expect(mockExperience.tools).toHaveLength(3);
  });

  it("handles empty tools array with '*'", () => {
    const imported = importTools({ tools: [] }, "*");
    expect(imported).toEqual([]);
  });

  it("handles empty selection array", () => {
    const imported = importTools(mockExperience, []);
    expect(imported).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { createAgentProtocolHints } from "../agent-hints";

describe("createAgentProtocolHints", () => {
  it("creates 5 agent hints", () => {
    const hints = createAgentProtocolHints("myexp");
    expect(hints).toHaveLength(5);
  });

  it("namespaces tool names with the provided namespace", () => {
    const hints = createAgentProtocolHints("chat");
    for (const hint of hints) {
      for (const tool of hint.suggestedTools) {
        expect(tool).toMatch(/^chat\./);
      }
    }
  });

  it("includes all required fields", () => {
    const hints = createAgentProtocolHints("test");
    for (const hint of hints) {
      expect(hint.trigger).toBeDefined();
      expect(typeof hint.trigger).toBe("string");
      expect(hint.suggestedTools).toBeDefined();
      expect(Array.isArray(hint.suggestedTools)).toBe(true);
      expect(hint.suggestedTools.length).toBeGreaterThan(0);
    }
  });

  it("has at least one high-priority hint", () => {
    const hints = createAgentProtocolHints("test");
    const highPri = hints.filter((h) => h.priority === "high");
    expect(highPri.length).toBeGreaterThan(0);
  });

  it("all hints have cooldown values", () => {
    const hints = createAgentProtocolHints("test");
    for (const hint of hints) {
      expect(hint.cooldownMs).toBeDefined();
      expect(hint.cooldownMs).toBeGreaterThan(0);
    }
  });
});

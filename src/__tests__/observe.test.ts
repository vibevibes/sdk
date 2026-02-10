import { describe, it, expect } from "vitest";
import { defineExperience } from "../define";
import type { ExperienceModule, ToolEvent } from "../types";

// ─── observe function ─────────────────────────────────────────────────────────

describe("observe function on ExperienceModule", () => {
  const makeModule = (
    observe?: ExperienceModule["observe"],
  ): ExperienceModule => ({
    manifest: {
      id: "test-observe",
      version: "1.0.0",
      title: "Test Observe",
      description: "Testing observe",
      requested_capabilities: ["state.write"],
    },
    Canvas: (() => null) as any,
    tools: [],
    observe,
  });

  it("defineExperience preserves observe function", () => {
    const observe = (state: Record<string, any>) => ({ summary: true });
    const mod = defineExperience(makeModule(observe));
    expect(mod.observe).toBe(observe);
  });

  it("observe function receives state and returns curated view", () => {
    const observe = (
      state: Record<string, any>,
      event: ToolEvent | null,
      actorId: string,
    ) => ({
      boardSize: (state.cells || []).length,
      currentPlayer: state.turn,
      isMyTurn: state.turn === actorId,
    });

    const state = {
      cells: new Array(64).fill(null),
      turn: "agent-1",
      moveHistory: [{ from: "e2", to: "e4" }],
      timers: { white: 300, black: 295 },
      internalCache: { evaluation: 0.5 },
    };

    const result = observe(state, null, "agent-1");

    expect(result.boardSize).toBe(64);
    expect(result.currentPlayer).toBe("agent-1");
    expect(result.isMyTurn).toBe(true);
    // Should NOT include raw state keys
    expect(result).not.toHaveProperty("cells");
    expect(result).not.toHaveProperty("moveHistory");
    expect(result).not.toHaveProperty("internalCache");
  });

  it("observe function receives event context", () => {
    const observe = (
      state: Record<string, any>,
      event: ToolEvent | null,
      actorId: string,
    ) => {
      if (event && event.tool === "card.play") {
        return {
          lastPlay: event.input,
          handSize: (state.hands?.[actorId] || []).length,
        };
      }
      return { handSize: (state.hands?.[actorId] || []).length };
    };

    const state = {
      hands: {
        "agent-1": ["ace", "king", "queen"],
        "user-1": ["2", "3"],
      },
    };

    const event: ToolEvent = {
      id: "evt-1",
      ts: Date.now(),
      actorId: "user-1",
      tool: "card.play",
      input: { card: "ace" },
    };

    const withEvent = observe(state, event, "agent-1");
    expect(withEvent.lastPlay).toEqual({ card: "ace" });
    expect(withEvent.handSize).toBe(3);

    const withoutEvent = observe(state, null, "agent-1");
    expect(withoutEvent).not.toHaveProperty("lastPlay");
    expect(withoutEvent.handSize).toBe(3);
  });

  it("observe returns different views for different actors", () => {
    const observe = (
      state: Record<string, any>,
      _event: ToolEvent | null,
      actorId: string,
    ) => ({
      myHand: state.hands?.[actorId] || [],
      opponentCardCount: Object.entries(state.hands || {})
        .filter(([id]) => id !== actorId)
        .reduce((sum, [, cards]) => sum + (cards as any[]).length, 0),
    });

    const state = {
      hands: {
        "player-1": ["a", "b", "c"],
        "player-2": ["x", "y"],
      },
    };

    const view1 = observe(state, null, "player-1");
    expect(view1.myHand).toEqual(["a", "b", "c"]);
    expect(view1.opponentCardCount).toBe(2);

    const view2 = observe(state, null, "player-2");
    expect(view2.myHand).toEqual(["x", "y"]);
    expect(view2.opponentCardCount).toBe(3);
  });

  it("module without observe is valid", () => {
    const mod = defineExperience(makeModule(undefined));
    expect(mod.observe).toBeUndefined();
  });

  it("observe can return empty object", () => {
    const observe = () => ({});
    const mod = defineExperience(makeModule(observe));
    const result = mod.observe!({}, null, "agent-1");
    expect(result).toEqual({});
  });

  it("observe handles empty state gracefully", () => {
    const observe = (
      state: Record<string, any>,
      _event: ToolEvent | null,
      actorId: string,
    ) => ({
      playerCount: Object.keys(state.players || {}).length,
      ready: !!state.ready,
    });

    const result = observe({}, null, "agent-1");
    expect(result.playerCount).toBe(0);
    expect(result.ready).toBe(false);
  });
});

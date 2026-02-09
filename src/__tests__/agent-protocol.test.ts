import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createAgentProtocolTools } from "../agent-protocol";
import type { ToolCtx } from "../types";

function mockCtx(overrides: Partial<ToolCtx> = {}): ToolCtx & { getState: () => Record<string, any> } {
  let state: Record<string, any> = overrides.state || {};
  return {
    roomId: "room-1",
    actorId: "agent-1",
    state,
    setState: (s) => { state = s; },
    timestamp: Date.now(),
    memory: {},
    setMemory: () => {},
    roomConfig: {},
    getState: () => state,
    ...overrides,
    // Keep setState/getState functional
  };
}

describe("createAgentProtocolTools", () => {
  const tools = createAgentProtocolTools("test", z);

  it("creates 6 agent protocol tools", () => {
    expect(tools).toHaveLength(6);
    const names = tools.map((t) => t.name);
    expect(names).toContain("test.agent.propose");
    expect(names).toContain("test.agent.vote");
    expect(names).toContain("test.agent.delegate");
    expect(names).toContain("test.agent.inform");
    expect(names).toContain("test.agent.request");
    expect(names).toContain("test.agent.respond");
  });

  it("all tools have low risk", () => {
    for (const tool of tools) {
      expect(tool.risk).toBe("low");
    }
  });

  it("propose creates a proposal and message", async () => {
    const propose = tools.find((t) => t.name === "test.agent.propose")!;
    const ctx = mockCtx();

    const result = await propose.handler(ctx, {
      proposal: "Let's do X",
      data: { detail: true },
    });

    expect(result.proposalId).toBeDefined();
    const state = ctx.getState();
    expect(state._agentProposals[result.proposalId]).toBeDefined();
    expect(state._agentProposals[result.proposalId].status).toBe("pending");
    expect(state._agentProposals[result.proposalId].proposal).toBe("Let's do X");
    expect(state._agentMessages).toHaveLength(1);
    expect(state._agentMessages[0].type).toBe("proposal");
  });

  it("vote approves a proposal when threshold met", async () => {
    const propose = tools.find((t) => t.name === "test.agent.propose")!;
    const vote = tools.find((t) => t.name === "test.agent.vote")!;

    const ctx = mockCtx();
    const { proposalId } = await propose.handler(ctx, {
      proposal: "Do Y",
      requiresVotes: 1,
    });

    // Vote from a different actor
    const ctx2 = mockCtx({ actorId: "agent-2", state: ctx.getState() });
    const result = await vote.handler(ctx2, {
      proposalId,
      vote: "approve",
      reason: "Looks good",
    });

    expect(result.status).toBe("approved");
    expect(result.voteCount).toBe(1);
  });

  it("vote rejects duplicate votes", async () => {
    const propose = tools.find((t) => t.name === "test.agent.propose")!;
    const vote = tools.find((t) => t.name === "test.agent.vote")!;

    const ctx = mockCtx();
    const { proposalId } = await propose.handler(ctx, { proposal: "Z", requiresVotes: 3 });

    const ctx2 = mockCtx({ actorId: "agent-2", state: ctx.getState() });
    await vote.handler(ctx2, { proposalId, vote: "approve" });

    // Same actor tries to vote again
    const ctx3 = mockCtx({ actorId: "agent-2", state: ctx2.getState() });
    await expect(
      vote.handler(ctx3, { proposalId, vote: "reject" })
    ).rejects.toThrow("Already voted");
  });

  it("delegate adds a delegation message", async () => {
    const delegate = tools.find((t) => t.name === "test.agent.delegate")!;
    const ctx = mockCtx();

    const result = await delegate.handler(ctx, {
      targetActorId: "agent-2",
      task: "Handle this",
    });

    expect(result.messageId).toBeDefined();
    const state = ctx.getState();
    expect(state._agentMessages).toHaveLength(1);
    expect(state._agentMessages[0].type).toBe("delegate");
    expect(state._agentMessages[0].to).toBe("agent-2");
  });

  it("inform adds an inform message", async () => {
    const inform = tools.find((t) => t.name === "test.agent.inform")!;
    const ctx = mockCtx();

    const result = await inform.handler(ctx, {
      to: "agent-2",
      message: "FYI something happened",
    });

    expect(result.messageId).toBeDefined();
    const state = ctx.getState();
    expect(state._agentMessages[0].type).toBe("inform");
  });

  it("caps messages at 100", async () => {
    const inform = tools.find((t) => t.name === "test.agent.inform")!;

    // Start with 99 existing messages
    const existingMessages = Array.from({ length: 99 }, (_, i) => ({
      id: `msg-${i}`,
      from: "old",
      to: "*",
      type: "inform",
      content: `msg ${i}`,
      ts: i,
    }));

    const ctx = mockCtx({ state: { _agentMessages: existingMessages } });

    // Add 2 more (should cap at 100)
    await inform.handler(ctx, { to: "*", message: "msg 100" });
    const ctx2 = mockCtx({ actorId: "agent-1", state: ctx.getState() });
    await inform.handler(ctx2, { to: "*", message: "msg 101" });

    const state = ctx2.getState();
    expect(state._agentMessages.length).toBeLessThanOrEqual(100);
  });
});

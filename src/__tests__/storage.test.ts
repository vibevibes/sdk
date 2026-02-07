import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "../storage";

describe("InMemoryAdapter", () => {
  it("saves and loads room state", async () => {
    const adapter = new InMemoryAdapter();
    const state = {
      roomId: "room-1",
      experienceId: "exp-1",
      sharedState: { count: 42 },
      updatedAt: Date.now(),
    };

    await adapter.saveRoomState("room-1", state);
    const loaded = await adapter.loadRoomState("room-1");
    expect(loaded).toEqual(state);
  });

  it("returns null for unknown room", async () => {
    const adapter = new InMemoryAdapter();
    const loaded = await adapter.loadRoomState("nonexistent");
    expect(loaded).toBeNull();
  });

  it("appends and loads events", async () => {
    const adapter = new InMemoryAdapter();
    const event1 = { id: "e1", ts: 1000, actor_id: "user-1", tool: "test.action", input: {}, output: {} };
    const event2 = { id: "e2", ts: 2000, actor_id: "user-2", tool: "test.other", input: {}, output: {} };

    await adapter.appendEvent("room-1", event1);
    await adapter.appendEvent("room-1", event2);

    const events = await adapter.loadEvents("room-1");
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("e1");
    expect(events[1].id).toBe("e2");
  });

  it("limits events when limit parameter provided", async () => {
    const adapter = new InMemoryAdapter();
    for (let i = 0; i < 10; i++) {
      await adapter.appendEvent("room-1", {
        id: `e${i}`, ts: i * 1000, actor_id: "user-1", tool: "test", input: {}, output: {},
      });
    }

    const events = await adapter.loadEvents("room-1", 3);
    expect(events).toHaveLength(3);
    // Should return the last 3 events
    expect(events[0].id).toBe("e7");
    expect(events[2].id).toBe("e9");
  });

  it("returns empty array for unknown room events", async () => {
    const adapter = new InMemoryAdapter();
    const events = await adapter.loadEvents("nonexistent");
    expect(events).toEqual([]);
  });

  it("returns empty array for listExperiences", async () => {
    const adapter = new InMemoryAdapter();
    const experiences = await adapter.listExperiences();
    expect(experiences).toEqual([]);
  });

  it("saves and loads user profiles", async () => {
    const adapter = new InMemoryAdapter();
    const profile = { name: "Alice", bio: "Developer" };

    await adapter.saveUserProfile!("user-1", profile);
    const loaded = await adapter.loadUserProfile!("user-1");
    expect(loaded).toEqual(profile);
  });

  it("returns null for unknown user profile", async () => {
    const adapter = new InMemoryAdapter();
    const loaded = await adapter.loadUserProfile!("nonexistent");
    expect(loaded).toBeNull();
  });
});

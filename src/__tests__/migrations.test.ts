import { describe, it, expect } from "vitest";
import {
  compareSemver,
  getStateVersion,
  migrateState,
} from "../migrations";
import type { StateMigration } from "../types";

// ─── compareSemver ───────────────────────────────────────────────────────────

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("0.0.1", "0.0.1")).toBe(0);
  });

  it("returns -1 when a < b", () => {
    expect(compareSemver("0.0.1", "0.0.2")).toBe(-1);
    expect(compareSemver("0.1.0", "0.2.0")).toBe(-1);
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("1.9.9", "2.0.0")).toBe(-1);
  });

  it("returns 1 when a > b", () => {
    expect(compareSemver("0.0.2", "0.0.1")).toBe(1);
    expect(compareSemver("1.0.0", "0.99.99")).toBe(1);
  });

  it("handles versions with different segment counts", () => {
    expect(compareSemver("1.0", "1.0.0")).toBe(0);
    expect(compareSemver("1", "1.0.0")).toBe(0);
    expect(compareSemver("1.0.1", "1.0")).toBe(1);
  });

  it("handles non-numeric segments gracefully (defaults to 0)", () => {
    expect(compareSemver("1.x.0", "1.0.0")).toBe(0);
  });
});

// ─── getStateVersion ────────────────────────────────────────────────────────

describe("getStateVersion", () => {
  it("returns _version if present", () => {
    expect(getStateVersion({ _version: "1.2.3" })).toBe("1.2.3");
  });

  it("returns 0.0.0 when _version is absent", () => {
    expect(getStateVersion({})).toBe("0.0.0");
    expect(getStateVersion({ count: 5 })).toBe("0.0.0");
  });

  it("returns 0.0.0 when _version is not a string", () => {
    expect(getStateVersion({ _version: 123 })).toBe("0.0.0");
    expect(getStateVersion({ _version: null })).toBe("0.0.0");
  });
});

// ─── migrateState ────────────────────────────────────────────────────────────

describe("migrateState", () => {
  it("returns unmigrated result when state is already at current version", () => {
    const state = { _version: "1.0.0", count: 5 };
    const result = migrateState(state, [], "1.0.0");
    expect(result.migrated).toBe(false);
    expect(result.state).toBe(state); // same reference
    expect(result.fromVersion).toBe("1.0.0");
    expect(result.toVersion).toBe("1.0.0");
  });

  it("returns unmigrated result when state is beyond current version", () => {
    const state = { _version: "2.0.0", count: 5 };
    const result = migrateState(state, [], "1.0.0");
    expect(result.migrated).toBe(false);
  });

  it("stamps version when no migrations are defined", () => {
    const state = { count: 5 };
    const result = migrateState(state, [], "1.0.0");
    expect(result.migrated).toBe(false);
    expect(result.state._version).toBe("1.0.0");
    expect(result.state.count).toBe(5);
  });

  it("does not mutate the input state", () => {
    const state = { count: 5 };
    const original = { ...state };
    migrateState(state, [], "1.0.0");
    expect(state).toEqual(original);
  });

  it("applies a single migration", () => {
    const migrations: StateMigration[] = [
      {
        from: "0.0.0",
        to: "1.0.0",
        migrate: (s) => ({ ...s, newField: "added" }),
      },
    ];

    const result = migrateState({}, migrations, "1.0.0");
    expect(result.migrated).toBe(true);
    expect(result.state.newField).toBe("added");
    expect(result.state._version).toBe("1.0.0");
  });

  it("applies migrations in order (ascending semver)", () => {
    const order: string[] = [];
    const migrations: StateMigration[] = [
      {
        from: "1.0.0",
        to: "2.0.0",
        migrate: (s) => { order.push("2.0.0"); return { ...s, v2: true }; },
      },
      {
        from: "0.0.0",
        to: "1.0.0",
        migrate: (s) => { order.push("1.0.0"); return { ...s, v1: true }; },
      },
    ];

    const result = migrateState({}, migrations, "2.0.0");
    expect(result.migrated).toBe(true);
    expect(order).toEqual(["1.0.0", "2.0.0"]);
    expect(result.state.v1).toBe(true);
    expect(result.state.v2).toBe(true);
    expect(result.state._version).toBe("2.0.0");
  });

  it("skips migrations that are beyond the current version", () => {
    const migrations: StateMigration[] = [
      {
        from: "0.0.0",
        to: "1.0.0",
        migrate: (s) => ({ ...s, v1: true }),
      },
      {
        from: "1.0.0",
        to: "3.0.0",
        migrate: (s) => ({ ...s, v3: true }),
      },
    ];

    const result = migrateState({}, migrations, "2.0.0");
    expect(result.migrated).toBe(true);
    expect(result.state.v1).toBe(true);
    expect(result.state.v3).toBeUndefined();
  });

  it("skips migrations already applied (state version >= migration.to)", () => {
    const migrations: StateMigration[] = [
      {
        from: "0.0.0",
        to: "1.0.0",
        migrate: (s) => ({ ...s, v1: true }),
      },
      {
        from: "1.0.0",
        to: "2.0.0",
        migrate: (s) => ({ ...s, v2: true }),
      },
    ];

    const state = { _version: "1.0.0", existing: true };
    const result = migrateState(state, migrations, "2.0.0");
    expect(result.migrated).toBe(true);
    expect(result.state.v1).toBeUndefined(); // skipped
    expect(result.state.v2).toBe(true); // applied
    expect(result.state.existing).toBe(true); // preserved
  });
});

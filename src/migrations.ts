/**
 * State migration runner for experience versioning.
 *
 * Pure functions (no side effects, no async) so they can run in Edge Functions,
 * Node.js, or the browser.
 */

import type { StateMigration } from "./types";

export interface MigrationResult {
  migrated: boolean;
  fromVersion: string;
  toVersion: string;
  state: Record<string, any>;
}

/**
 * Get the state version from a state object.
 * Stored in state._version, defaults to "0.0.0" if absent.
 */
export function getStateVersion(state: Record<string, any>): string {
  return typeof state._version === "string" ? state._version : "0.0.0";
}

/**
 * Compare two semver strings.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 *
 * Handles standard major.minor.patch format. Missing segments default to 0.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);

  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Run all applicable migrations on a state object.
 *
 * - Reads state._version (default "0.0.0") as the starting version
 * - Sorts migrations by their to version (ascending semver)
 * - Applies each migration where migration.to > stateVersion and migration.to <= currentVersion
 * - Sets state._version = currentVersion after all migrations
 * - Returns a MigrationResult indicating whether any migrations were applied
 *
 * The migration runner is pure: it does not mutate the input state object.
 * It returns a new state object with migrations applied.
 */
export function migrateState(
  state: Record<string, any>,
  migrations: StateMigration[],
  currentVersion: string
): MigrationResult {
  const fromVersion = getStateVersion(state);

  // No migrations needed if state is already at or beyond the current version
  if (compareSemver(fromVersion, currentVersion) >= 0) {
    return {
      migrated: false,
      fromVersion,
      toVersion: fromVersion,
      state,
    };
  }

  // No migrations defined - just stamp the version
  if (!migrations || migrations.length === 0) {
    return {
      migrated: false,
      fromVersion,
      toVersion: currentVersion,
      state: { ...state, _version: currentVersion },
    };
  }

  // Sort migrations by their target version (ascending)
  const sorted = [...migrations].sort((a, b) => compareSemver(a.to, b.to));

  // Filter to applicable migrations:
  // migration.to must be > stateVersion AND <= currentVersion
  const applicable = sorted.filter(
    (m) =>
      compareSemver(m.to, fromVersion) > 0 &&
      compareSemver(m.to, currentVersion) <= 0
  );

  if (applicable.length === 0) {
    // No applicable migrations - just stamp the version
    return {
      migrated: false,
      fromVersion,
      toVersion: currentVersion,
      state: { ...state, _version: currentVersion },
    };
  }

  // Apply migrations sequentially
  let migratedState = { ...state };
  for (const migration of applicable) {
    migratedState = migration.migrate(migratedState);
  }

  // Stamp the final version
  migratedState._version = currentVersion;

  return {
    migrated: true,
    fromVersion,
    toVersion: currentVersion,
    state: migratedState,
  };
}

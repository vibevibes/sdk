/**
 * Rule Engine for declarative client-side simulation.
 *
 * The agent writes rules as JSON via tool calls. The client evaluates them
 * at ~10 ticks/sec via useRuleTick. Rules are a delegation mechanism — the
 * agent teaches the client how to run parts of the simulation at tick speed
 * so the agent can focus on high-level world design and evolution.
 *
 * Exports:
 *   Types:     Rule, WorldMeta, RuleStats
 *   Hook:      useRuleTick(scene, rules, worldMeta, callTool)
 *   Matching:  nodeMatchesSelector(node, selector)
 *   Tools:     createRuleTools(z) → ToolDef[]
 *   Shorthand: ruleTools(z) → ToolDef[]
 */

import type { SceneGraph, SceneNode, GroupNode, Vec2 } from './types';
import type { ToolDef, ToolCtx } from '../types';
import { walkNodes, cloneScene } from './helpers';

// ─── Lazy React ──────────────────────────────────────────────────────────────

function getReact(): typeof import("react") {
  const R = (globalThis as any).React;
  if (!R) throw new Error("React not available");
  return R;
}

const React = new Proxy({} as typeof import("react"), {
  get(_target, prop) {
    return (getReact() as any)[prop];
  },
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type Rule = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: "tick" | "interaction" | "proximity" | "timer";
  condition: {
    selector: string;
    proximity?: { target: string; distance: number };
    state?: Record<string, any>;
    cooldownMs?: number;
    probability?: number;
  };
  effect: {
    type:
      | "transform"
      | "style"
      | "data"
      | "counter"
      | "spawn"
      | "remove"
      | "tween";
    dx?: number;
    dy?: number;
    dRotation?: number;
    styleUpdates?: Record<string, any>;
    dataUpdates?: Record<string, any>;
    field?: string;
    delta?: number;
    spawnNode?: any;
    spawnOffset?: { x: number; y: number };
    tween?: {
      property: string;
      from: number;
      to: number;
      duration: number;
      easing?: string;
      repeat?: number;
      yoyo?: boolean;
    };
    variance?: number;
    probability?: number;
  };
};

export type WorldMeta = {
  name: string;
  description: string;
  paused: boolean;
  tickSpeed: number;
};

export type RuleStats = {
  rulesEvaluated: number;
  rulesFired: number;
  nodesAffected: number;
  ticksElapsed: number;
};

// ─── Selector Matching ───────────────────────────────────────────────────────

/**
 * Check if a scene node matches a selector string.
 *
 * Selector syntax:
 *   "*"               — any node with data.entityType
 *   "entityType:fish" — data.entityType === "fish"
 *   "tag:swimming"    — data.tags includes "swimming"
 *   "name:hero"       — node.name === "hero"
 *   "type:circle"     — node.type === "circle"
 */
export function nodeMatchesSelector(node: any, selector: string): boolean {
  const s = selector.trim();
  if (s === "*") return !!(node as any).data?.entityType;

  const colon = s.indexOf(":");
  if (colon === -1) return false;

  const prefix = s.slice(0, colon);
  const value = s.slice(colon + 1);

  switch (prefix) {
    case "entityType":
      return node.data?.entityType === value;
    case "tag": {
      const tags = node.data?.tags;
      return Array.isArray(tags) && tags.includes(value);
    }
    case "name":
      return node.name === value;
    case "type":
      return node.type === value;
    default:
      return false;
  }
}

// ─── Internal Utilities ──────────────────────────────────────────────────────

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function nodePos(node: any): Vec2 {
  return { x: node.transform?.x ?? 0, y: node.transform?.y ?? 0 };
}

function applyVariance(v: number, variance: number): number {
  if (variance <= 0) return v;
  return v * (1 + (Math.random() * 2 - 1) * variance);
}

function collectNodes(root: GroupNode): SceneNode[] {
  const out: SceneNode[] = [];
  walkNodes(root, (n) => out.push(n));
  return out;
}

// ─── Condition Check ─────────────────────────────────────────────────────────

function checkCondition(
  rule: Rule,
  node: SceneNode,
  allNodes: SceneNode[],
  now: number,
  cooldowns: Map<string, Record<string, number>>
): boolean {
  const cond = rule.condition;

  if (!nodeMatchesSelector(node, cond.selector)) return false;

  // State matching
  if (cond.state) {
    for (const [k, v] of Object.entries(cond.state)) {
      if ((node as any).data?.[k] !== v) return false;
    }
  }

  // Proximity
  if (cond.proximity) {
    const pos = nodePos(node);
    const inRange = allNodes.some(
      (n) =>
        n.id !== node.id &&
        nodeMatchesSelector(n, cond.proximity!.target) &&
        dist(pos, nodePos(n)) <= cond.proximity!.distance
    );
    if (!inRange) return false;
  }

  // Cooldown
  if (cond.cooldownMs) {
    const perNode = cooldowns.get(rule.id);
    const last = perNode?.[node.id] ?? 0;
    if (now - last < cond.cooldownMs) return false;
  }

  // Probability
  if (cond.probability != null && Math.random() > cond.probability) return false;

  return true;
}

// ─── Apply Effect ────────────────────────────────────────────────────────────

type PendingOp =
  | { op: "spawn"; node: any; parentPos: Vec2 }
  | { op: "remove"; nodeId: string };

function applyEffect(
  rule: Rule,
  node: any,
  pending: PendingOp[]
): any | null {
  const eff = rule.effect;

  if (eff.probability != null && Math.random() > eff.probability) return null;

  const variance = eff.variance ?? 0;
  let modified: any = null;

  switch (eff.type) {
    case "transform": {
      const t = { ...(node.transform ?? {}) };
      let changed = false;
      if (eff.dx != null) {
        t.x = (t.x ?? 0) + applyVariance(eff.dx, variance);
        changed = true;
      }
      if (eff.dy != null) {
        t.y = (t.y ?? 0) + applyVariance(eff.dy, variance);
        changed = true;
      }
      if (eff.dRotation != null) {
        t.rotation = (t.rotation ?? 0) + applyVariance(eff.dRotation, variance);
        changed = true;
      }
      if (changed) modified = { ...node, transform: t };
      break;
    }

    case "style": {
      if (eff.styleUpdates) {
        modified = {
          ...node,
          style: { ...(node.style ?? {}), ...eff.styleUpdates },
        };
      }
      break;
    }

    case "data": {
      if (eff.dataUpdates) {
        modified = {
          ...node,
          data: { ...(node.data ?? {}), ...eff.dataUpdates },
        };
      }
      break;
    }

    case "counter": {
      if (eff.field && eff.delta != null) {
        const cur = node.data?.[eff.field] ?? 0;
        const delta = applyVariance(eff.delta, variance);
        modified = {
          ...node,
          data: { ...(node.data ?? {}), [eff.field]: cur + delta },
        };
      }
      break;
    }

    case "tween": {
      if (eff.tween) {
        modified = {
          ...node,
          tween: { ...eff.tween, startedAt: Date.now() },
        };
      }
      break;
    }

    case "spawn": {
      if (eff.spawnNode) {
        pending.push({
          op: "spawn",
          node: { ...eff.spawnNode },
          parentPos: nodePos(node),
        });
      }
      break;
    }

    case "remove": {
      pending.push({ op: "remove", nodeId: node.id });
      break;
    }
  }

  return modified;
}

// ─── Scene Mutation Helpers ──────────────────────────────────────────────────

function replaceNode(group: GroupNode, id: string, replacement: any): boolean {
  if (!group.children) return false;
  for (let i = 0; i < group.children.length; i++) {
    if (group.children[i].id === id) {
      group.children[i] = replacement;
      return true;
    }
    if (
      group.children[i].type === "group" &&
      replaceNode(group.children[i] as GroupNode, id, replacement)
    ) {
      return true;
    }
  }
  return false;
}

// ─── useRuleTick Hook ────────────────────────────────────────────────────────

type CallToolFn = (name: string, input: any) => Promise<any>;

/**
 * Client-side tick engine. Evaluates enabled tick rules against the scene
 * graph at ~tickSpeed ms intervals using requestAnimationFrame.
 *
 * Transform/style/data/counter/tween effects are applied locally for instant
 * visual feedback. Spawn/remove effects are batched and flushed through
 * scene.batch tool calls (debounced 300ms) so they persist in shared state.
 */
export function useRuleTick(
  scene: SceneGraph,
  rules: Rule[],
  worldMeta: WorldMeta,
  callTool: CallToolFn
): { simulatedScene: SceneGraph; stats: RuleStats } {
  const [simScene, setSimScene] = React.useState(scene as SceneGraph);
  const [stats, setStats] = React.useState({
    rulesEvaluated: 0,
    rulesFired: 0,
    nodesAffected: 0,
    ticksElapsed: 0,
  } as RuleStats);

  const rafRef = React.useRef(null as number | null);
  const lastTickRef = React.useRef(0 as number);
  const tickCountRef = React.useRef(0 as number);
  const cooldownsRef = React.useRef(new Map() as Map<string, Record<string, number>>);

  // Batch queue for spawn/remove (debounced)
  const pendingOpsRef = React.useRef([] as PendingOp[]);
  const batchTimerRef = React.useRef(null as ReturnType<typeof setTimeout> | null);

  const flushPending = React.useCallback(() => {
    const ops = pendingOpsRef.current;
    if (ops.length === 0) return;
    pendingOpsRef.current = [];

    const batchOps: any[] = [];
    for (const op of ops) {
      if (op.op === "spawn") {
        const id =
          Math.random().toString(36).slice(2, 10) +
          Date.now().toString(36);
        const spawnX =
          op.parentPos.x + (op.node.spawnOffset?.x ?? (Math.random() - 0.5) * 60);
        const spawnY =
          op.parentPos.y + (op.node.spawnOffset?.y ?? (Math.random() - 0.5) * 60);
        const { spawnOffset: _so, ...nodeProps } = op.node;
        batchOps.push({
          op: "add",
          node: {
            ...nodeProps,
            id,
            transform: {
              ...(nodeProps.transform ?? {}),
              x: spawnX,
              y: spawnY,
            },
          },
        });
      } else if (op.op === "remove") {
        batchOps.push({ op: "remove", nodeIds: [op.nodeId] });
      }
    }

    if (batchOps.length > 0) {
      callTool("scene.batch", { operations: batchOps }).catch(() => {});
    }
  }, [callTool]);

  const scheduleBatchFlush = React.useCallback(() => {
    if (batchTimerRef.current) return;
    batchTimerRef.current = setTimeout(() => {
      batchTimerRef.current = null;
      flushPending();
    }, 300);
  }, [flushPending]);

  // Sync scene from props when it changes
  React.useEffect(() => {
    setSimScene(scene);
  }, [scene]);

  React.useEffect(() => {
    if (worldMeta.paused) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const tickRules = rules.filter(
      (r) => r.enabled && r.trigger === "tick"
    );

    if (tickRules.length === 0) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const tick = (now: number) => {
      if (now - lastTickRef.current < worldMeta.tickSpeed) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastTickRef.current = now;
      tickCountRef.current++;

      setSimScene((prevScene) => {
        const working = cloneScene(prevScene);
        const allNodes = collectNodes(working.root);
        const pending: PendingOp[] = [];
        let rulesEvaluated = 0;
        let rulesFired = 0;
        let nodesAffected = 0;

        for (const rule of tickRules) {
          // Ensure cooldown map exists for this rule
          if (!cooldownsRef.current.has(rule.id)) {
            cooldownsRef.current.set(rule.id, {});
          }

          rulesEvaluated++;
          let fired = false;

          for (const node of allNodes) {
            if (checkCondition(rule, node, allNodes, now, cooldownsRef.current)) {
              const modified = applyEffect(rule, node, pending);
              if (modified) {
                replaceNode(working.root, node.id, modified);
                nodesAffected++;
                fired = true;

                // Update cooldown
                const cd = cooldownsRef.current.get(rule.id)!;
                cd[node.id] = now;
              } else if (
                rule.effect.type === "spawn" ||
                rule.effect.type === "remove"
              ) {
                fired = true;
              }
            }
          }

          if (fired) rulesFired++;
        }

        // Queue structural changes
        if (pending.length > 0) {
          pendingOpsRef.current.push(...pending);
          scheduleBatchFlush();
        }

        setStats({
          rulesEvaluated,
          rulesFired,
          nodesAffected,
          ticksElapsed: tickCountRef.current,
        });

        return working;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    lastTickRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [rules, worldMeta.paused, worldMeta.tickSpeed, scheduleBatchFlush]);

  // Cleanup batch timer
  React.useEffect(() => {
    return () => {
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
    };
  }, []);

  return { simulatedScene: simScene, stats };
}

// ─── Tool Factory ────────────────────────────────────────────────────────────

/**
 * Create rule management tools for an experience.
 *
 * Returns 3 tools:
 *   _rules.set    — create or update a rule
 *   _rules.remove — delete a rule by ID
 *   _rules.world  — set world metadata (name, description, paused, tickSpeed)
 */
export function createRuleTools(z: any): ToolDef[] {
  return [
    // ── _rules.set ──────────────────────────────────────────────
    {
      name: "_rules.set",
      description: `Create or update a simulation rule. Rules run client-side at tick speed (~10/sec) for emergent behavior.

Entity convention: scene nodes with data.entityType and data.tags are "entities" that rules can target.

Selector syntax:
  "entityType:fish"  — matches nodes where data.entityType === "fish"
  "tag:alive"        — matches nodes where data.tags includes "alive"
  "name:hero"        — matches nodes where name === "hero"
  "type:circle"      — matches nodes where type === "circle"
  "*"                — matches any node with data.entityType

Effect types:
  transform — move/rotate nodes each tick (dx, dy, dRotation)
  style     — update visual style (styleUpdates)
  data      — update node metadata (dataUpdates)
  counter   — increment/decrement a data field (field, delta)
  spawn     — create new nodes near matched nodes (spawnNode)
  remove    — delete matched nodes
  tween     — start a tween animation on matched nodes

Example — fish swim right:
{ id: "fish-swim", name: "Fish Swim", description: "Fish drift right", enabled: true,
  trigger: "tick", condition: { selector: "entityType:fish" },
  effect: { type: "transform", dx: 2, variance: 0.3 } }

Example — predator eats prey:
{ id: "predator-eat", name: "Predator Eats", description: "Remove prey near predator", enabled: true,
  trigger: "tick", condition: { selector: "entityType:prey", proximity: { target: "entityType:predator", distance: 30 } },
  effect: { type: "remove" } }`,
      input_schema: z.object({
        id: z.string().describe("Unique rule ID"),
        name: z.string().describe("Human-readable name"),
        description: z.string().optional().describe("What this rule does"),
        enabled: z.boolean().optional().describe("Whether rule is active (default true)"),
        trigger: z.enum(["tick", "interaction", "proximity", "timer"]).optional().describe("When to evaluate (default tick)"),
        condition: z.object({
          selector: z.string().describe("Entity selector: entityType:X, tag:X, name:X, type:X, or *"),
          proximity: z.object({
            target: z.string().describe("Selector for proximity target"),
            distance: z.number().describe("Max distance in pixels"),
          }).optional(),
          state: z.record(z.any()).optional().describe("Match nodes where data[key] === value"),
          cooldownMs: z.number().optional().describe("Minimum ms between firings per node"),
          probability: z.number().min(0).max(1).optional().describe("Chance of evaluating (0-1)"),
        }),
        effect: z.object({
          type: z.enum(["transform", "style", "data", "counter", "spawn", "remove", "tween"]),
          dx: z.number().optional().describe("X movement per tick"),
          dy: z.number().optional().describe("Y movement per tick"),
          dRotation: z.number().optional().describe("Rotation per tick (degrees)"),
          styleUpdates: z.record(z.any()).optional().describe("Style properties to set"),
          dataUpdates: z.record(z.any()).optional().describe("Data properties to set"),
          field: z.string().optional().describe("Counter field name"),
          delta: z.number().optional().describe("Counter increment per tick"),
          spawnNode: z.record(z.any()).optional().describe("Node template to spawn"),
          spawnOffset: z.object({ x: z.number(), y: z.number() }).optional(),
          tween: z.object({
            property: z.string(),
            from: z.number(),
            to: z.number(),
            duration: z.number(),
            easing: z.string().optional(),
            repeat: z.number().optional(),
            yoyo: z.boolean().optional(),
          }).optional(),
          variance: z.number().min(0).max(1).optional().describe("Random variance (0-1)"),
          probability: z.number().min(0).max(1).optional().describe("Chance effect fires (0-1)"),
        }),
      }),
      risk: "low" as const,
      capabilities_required: ["state.write"],
      handler: async (ctx: ToolCtx, input: any) => {
        const rules: Rule[] = [...(ctx.state._rules || [])];
        const rule: Rule = {
          id: input.id,
          name: input.name,
          description: input.description ?? "",
          enabled: input.enabled ?? true,
          trigger: input.trigger ?? "tick",
          condition: input.condition,
          effect: input.effect,
        };

        const idx = rules.findIndex((r) => r.id === input.id);
        if (idx !== -1) {
          rules[idx] = rule;
        } else {
          rules.push(rule);
        }

        ctx.setState({ ...ctx.state, _rules: rules });
        return { ruleId: rule.id, total: rules.length, action: idx !== -1 ? "updated" : "created" };
      },
    },

    // ── _rules.remove ───────────────────────────────────────────
    {
      name: "_rules.remove",
      description: "Remove a simulation rule by ID.",
      input_schema: z.object({
        id: z.string().describe("ID of the rule to remove"),
      }),
      risk: "low" as const,
      capabilities_required: ["state.write"],
      handler: async (ctx: ToolCtx, input: { id: string }) => {
        const rules: Rule[] = (ctx.state._rules || []).filter(
          (r: Rule) => r.id !== input.id
        );
        ctx.setState({ ...ctx.state, _rules: rules });
        return { removed: input.id, remaining: rules.length };
      },
    },

    // ── _rules.world ────────────────────────────────────────────
    {
      name: "_rules.world",
      description: `Set world metadata — name, description, paused state, tick speed.

Examples:
- Name the world: { name: "The Reef", description: "An underwater ecosystem" }
- Pause: { paused: true }
- Speed up: { tickSpeed: 50 }
- Slow down: { tickSpeed: 200 }`,
      input_schema: z.object({
        name: z.string().optional().describe("World name"),
        description: z.string().optional().describe("World description"),
        paused: z.boolean().optional().describe("Pause/resume simulation"),
        tickSpeed: z.number().min(16).max(2000).optional().describe("Ms between ticks (16=60fps, 100=10fps, default 100)"),
      }),
      risk: "low" as const,
      capabilities_required: ["state.write"],
      handler: async (ctx: ToolCtx, input: any) => {
        const meta: WorldMeta = {
          ...(ctx.state._worldMeta || {
            name: "Untitled",
            description: "",
            paused: false,
            tickSpeed: 100,
          }),
        };
        if (input.name != null) meta.name = input.name;
        if (input.description != null) meta.description = input.description;
        if (input.paused != null) meta.paused = input.paused;
        if (input.tickSpeed != null) meta.tickSpeed = input.tickSpeed;

        ctx.setState({ ...ctx.state, _worldMeta: meta });
        return { worldMeta: meta };
      },
    },
  ];
}

// ─── Convenience Shorthand ───────────────────────────────────────────────────

/**
 * Return all pre-built rule tools ready to spread into defineExperience.
 *
 * Usage:
 *   import { ruleTools } from "@vibevibes/sdk";
 *   export default defineExperience({
 *     tools: [...sceneTools(z), ...ruleTools(z)],
 *   });
 */
export function ruleTools(z: any): ToolDef[] {
  return createRuleTools(z);
}

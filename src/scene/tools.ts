/**
 * Pre-built scene manipulation tools.
 *
 * Factory function createSceneTools(namespace, z) returns ToolDef[] ready to
 * spread into defineExperience({ tools: [...sceneTools(z)] }).
 *
 * Follows the same pattern as createAgentProtocolTools in agent-protocol.ts.
 *
 * 5 tools total — minimal surface area, maximum expressiveness:
 *   scene.add     — add nodes
 *   scene.update  — update any node (props, transform, style, tween)
 *   scene.remove  — remove nodes
 *   scene.set     — scene-level settings (camera, background, gradients, clear)
 *   scene.batch   — multiple operations in one state update
 */

import type { ToolDef, ToolCtx } from '../types';
import type { SceneGraph, GroupNode, SceneNode } from './types';
import { createSceneSchemas } from './schema';

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function getScene(ctx: ToolCtx): SceneGraph {
  return ctx.state._scene ?? {
    _sceneVersion: 1,
    root: { id: 'root', type: 'group', children: [] },
    camera: { x: 400, y: 300, zoom: 1 },
    background: '#1a1a2e',
    gradients: [],
    filters: [],
    width: 800,
    height: 600,
  };
}

function cloneScene(scene: SceneGraph): SceneGraph {
  return JSON.parse(JSON.stringify(scene));
}

function findNode(node: SceneNode, id: string): SceneNode | null {
  if (node.id === id) return node;
  if (node.type === 'group' && (node as GroupNode).children) {
    for (const child of (node as GroupNode).children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

function removeNode(root: GroupNode, id: string): boolean {
  if (!root.children) return false;
  const idx = root.children.findIndex(c => c.id === id);
  if (idx !== -1) {
    root.children.splice(idx, 1);
    return true;
  }
  for (const child of root.children) {
    if (child.type === 'group' && removeNode(child as GroupNode, id)) return true;
  }
  return false;
}

function findGroup(root: GroupNode, id: string): GroupNode | null {
  const node = findNode(root, id);
  if (node && node.type === 'group') return node as GroupNode;
  return null;
}

export function createSceneTools(namespace: string, z: any): ToolDef[] {
  const schemas = createSceneSchemas(z);

  return [
    // ── scene.add ──────────────────────────────────────────────────────
    {
      name: `${namespace}.add`,
      description: `Add a visual node to the scene. Returns the node's ID.

Node types: rect, circle, ellipse, line, polyline, polygon, path, text, image, group, sprite, tilemap, particles.

Each node can have: transform (position/rotation/scale), style (fill/stroke/opacity), name, interactive, data (metadata).

For visually rich scenes: prefer "path" nodes with cubic bezier curves (C commands) over basic shapes for organic forms, compose entities as "group" nodes with layered children, and use gradients (defined via scene.set) for depth.

Examples:
- Curved path: { node: { type: "path", d: "M 0 0 C 8 -18 30 -22 50 -12 C 60 -6 60 6 50 12 C 30 22 8 18 0 0 Z", style: { fill: "url(#my-gradient)", stroke: "#0e7490", strokeWidth: 0.8 } } }
- Composed entity: { node: { type: "group", name: "creature", data: { entityType: "fish" }, transform: { x: 300, y: 200 }, children: [{ type: "path", d: "M 0 0 C 8 -18 30 -22 50 -12 C 60 -6 60 6 50 12 C 30 22 8 18 0 0 Z", style: { fill: "url(#body-grad)" } }, { type: "circle", radius: 3, transform: { x: 40, y: -3 }, style: { fill: "#0f172a" } }] } }
- Rectangle: { node: { type: "rect", width: 100, height: 50, transform: { x: 200, y: 100 }, style: { fill: "#ef4444" } } }
- Text: { node: { type: "text", text: "Hello", transform: { x: 100, y: 50 }, style: { fill: "#fff", fontSize: 24, textAnchor: "middle" } } }
- Image: { node: { type: "image", href: "https://example.com/img.png", width: 200, height: 150 } }`,
      input_schema: z.object({
        node: schemas.nodeSchema.describe('Scene node to add'),
        parentId: z.string().optional().describe('Parent group ID. Defaults to root.'),
      }),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx, input: { node: any; parentId?: string }) => {
        const scene = cloneScene(getScene(ctx));
        const nodeId = input.node.id ?? uid();
        const node = { ...input.node, id: nodeId };
        if (node.type === 'group' && !node.children) node.children = [];

        const parent = input.parentId
          ? findGroup(scene.root, input.parentId)
          : scene.root;
        if (!parent) throw new Error(`Parent group "${input.parentId}" not found`);

        parent.children.push(node);
        ctx.setState({ ...ctx.state, _scene: scene });
        return { nodeId };
      },
    },

    // ── scene.update ───────────────────────────────────────────────────
    {
      name: `${namespace}.update`,
      description: `Update an existing scene node. Merges transform, style, and any other properties.

Use this for ALL node modifications: moving, resizing, recoloring, animating, renaming, etc.

To animate: include a "tween" object with { property, from, to, duration, easing?, repeat?, yoyo? }.
Easing options: linear, ease-in, ease-out, ease-in-out, ease-in-quad, ease-out-quad, ease-in-cubic, ease-out-cubic, ease-in-elastic, ease-out-elastic, ease-in-bounce, ease-out-bounce.

Examples:
- Move: { nodeId: "abc", transform: { x: 200, y: 100 } }
- Restyle: { nodeId: "abc", style: { fill: "#22c55e", opacity: 0.8 } }
- Resize: { nodeId: "abc", width: 200, height: 100 }
- Change text: { nodeId: "abc", text: "New text" }
- Animate slide: { nodeId: "abc", tween: { property: "transform.x", from: 0, to: 300, duration: 1000, easing: "ease-out" } }
- Animate pulse: { nodeId: "abc", tween: { property: "transform.scaleX", from: 1, to: 1.2, duration: 400, repeat: -1, yoyo: true } }
- Animate fade: { nodeId: "abc", tween: { property: "style.opacity", from: 0, to: 1, duration: 500 } }`,
      input_schema: z.object({
        nodeId: z.string().describe('ID of the node to update'),
        transform: schemas.transform.describe('Position, rotation, scale'),
        style: schemas.style.describe('Fill, stroke, opacity, etc.'),
        tween: z.object({
          property: z.string().describe('Dot-path: transform.x, style.opacity, etc.'),
          from: z.number(),
          to: z.number(),
          duration: z.number().describe('Milliseconds'),
          easing: z.string().optional(),
          delay: z.number().optional(),
          repeat: z.number().optional().describe('-1 = infinite'),
          yoyo: z.boolean().optional(),
        }).optional().describe('Tween animation'),
        // Type-specific props (all optional)
        width: z.number().optional(),
        height: z.number().optional(),
        radius: z.number().optional(),
        rx: z.number().optional(),
        ry: z.number().optional(),
        text: z.string().optional(),
        href: z.string().optional(),
        d: z.string().optional(),
        points: z.array(schemas.vec2).optional(),
        x2: z.number().optional(),
        y2: z.number().optional(),
        name: z.string().optional(),
        interactive: z.boolean().optional(),
        data: z.record(z.any()).optional(),
        frame: z.number().optional(),
      }).passthrough(),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx, input: any) => {
        const scene = cloneScene(getScene(ctx));
        const node = findNode(scene.root, input.nodeId);
        if (!node) throw new Error(`Node "${input.nodeId}" not found`);

        const { nodeId: _, ...props } = input;

        // Merge transform
        if (props.transform) {
          node.transform = { ...(node.transform ?? {}), ...props.transform };
          delete props.transform;
        }

        // Merge style
        if (props.style) {
          node.style = { ...(node.style ?? {}), ...props.style };
          delete props.style;
        }

        // Handle tween — set startedAt
        if (props.tween) {
          node.tween = { ...props.tween, startedAt: ctx.timestamp };
          delete props.tween;
        }

        // Merge remaining props (don't overwrite id or type)
        const { id: _id, type: _type, ...safeProps } = props;
        Object.assign(node, safeProps);

        ctx.setState({ ...ctx.state, _scene: scene });
        return { updated: true };
      },
    },

    // ── scene.remove ───────────────────────────────────────────────────
    {
      name: `${namespace}.remove`,
      description: `Remove one or more nodes from the scene by ID. Removes all children if a node is a group.

Examples:
- Single: { nodeIds: ["abc123"] }
- Multiple: { nodeIds: ["node1", "node2", "node3"] }
- Clear all: { clear: true }`,
      input_schema: z.object({
        nodeIds: z.array(z.string()).optional().describe('IDs of nodes to remove'),
        clear: z.boolean().optional().describe('If true, remove ALL nodes'),
      }),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx, input: { nodeIds?: string[]; clear?: boolean }) => {
        const scene = cloneScene(getScene(ctx));

        if (input.clear) {
          scene.root.children = [];
          ctx.setState({ ...ctx.state, _scene: scene });
          return { removed: 'all' };
        }

        const removed: string[] = [];
        for (const id of (input.nodeIds ?? [])) {
          if (removeNode(scene.root, id)) removed.push(id);
        }

        ctx.setState({ ...ctx.state, _scene: scene });
        return { removed };
      },
    },

    // ── scene.set ──────────────────────────────────────────────────────
    {
      name: `${namespace}.set`,
      description: `Set scene-level properties: camera position/zoom, background color, gradients, dimensions.

Define gradients early — natural scenes should have 3-5 gradients (water, sky, foliage, light sources). Reference them in node styles with fill: "url(#gradientId)". Gradients add depth and richness that flat colors cannot.

Examples:
- Background: { background: "#0f172a" }
- Camera pan: { camera: { x: 500, y: 300 } }
- Camera zoom: { camera: { zoom: 2 } }
- Linear gradient: { gradient: { type: "linear", id: "sunset", x1: 0, y1: 0, x2: 1, y2: 1, stops: [{ offset: 0, color: "#f97316" }, { offset: 0.5, color: "#ec4899" }, { offset: 1, color: "#8b5cf6" }] } }
- Radial gradient: { gradient: { type: "radial", id: "glow", cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: "#fef3c7" }, { offset: 1, color: "transparent" }] } }
  Then use in style: { fill: "url(#sunset)" } or { fill: "url(#glow)" }
- Resize: { width: 1024, height: 768 }`,
      input_schema: z.object({
        background: z.string().optional().describe('CSS background color'),
        camera: z.object({
          x: z.number().optional(),
          y: z.number().optional(),
          zoom: z.number().optional().describe('1 = 100%, 2 = zoomed in, 0.5 = zoomed out'),
          rotation: z.number().optional(),
        }).optional(),
        gradient: schemas.gradient.optional().describe('Add/update a reusable gradient definition'),
        width: z.number().optional(),
        height: z.number().optional(),
      }),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx, input: any) => {
        const scene = cloneScene(getScene(ctx));

        if (input.background != null) scene.background = input.background;
        if (input.width != null) scene.width = input.width;
        if (input.height != null) scene.height = input.height;

        if (input.camera) {
          scene.camera = { ...(scene.camera ?? { x: 400, y: 300, zoom: 1 }), ...input.camera };
        }

        if (input.gradient) {
          if (!scene.gradients) scene.gradients = [];
          const idx = scene.gradients.findIndex((g: any) => g.id === input.gradient.id);
          if (idx !== -1) {
            scene.gradients[idx] = input.gradient;
          } else {
            scene.gradients.push(input.gradient);
          }
        }

        ctx.setState({ ...ctx.state, _scene: scene });
        return { updated: true };
      },
    },

    // ── scene.batch ────────────────────────────────────────────────────
    {
      name: `${namespace}.batch`,
      description: `Execute multiple scene operations in a single state update. More efficient than individual tool calls for building complex scenes.

Each operation has an "op" field: "add", "update", "remove", "set".

Best practice: define gradients first (op: "set"), then add entities that reference them. Compose organic entities as groups with path children using cubic bezier curves.

Example — build a rich scene in one call:
{ operations: [
  { op: "set", background: "#0f172a" },
  { op: "set", gradient: { type: "linear", id: "creature-grad", x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: "#a78bfa" }, { offset: 1, color: "#4c1d95" }] } },
  { op: "add", node: { type: "group", id: "creature", transform: { x: 400, y: 300 }, data: { entityType: "creature" }, children: [
    { type: "path", d: "M 0 0 C 10 -20 35 -25 55 -10 C 65 0 65 10 55 18 C 35 28 10 20 0 0 Z", style: { fill: "url(#creature-grad)", stroke: "#7c3aed", strokeWidth: 0.8 } },
    { type: "circle", radius: 3, transform: { x: 42, y: -2 }, style: { fill: "#1e1b4b" } },
    { type: "path", d: "M 15 -8 C 25 -16 40 -15 50 -6", style: { fill: "none", stroke: "rgba(255,255,255,0.2)", strokeWidth: 2 } }
  ] } },
  { op: "add", node: { type: "text", text: "Welcome", transform: { x: 400, y: 80 }, style: { fill: "#fff", fontSize: 32, textAnchor: "middle" } } },
  { op: "update", nodeId: "creature", tween: { property: "transform.y", from: 300, to: 290, duration: 2000, repeat: -1, yoyo: true, easing: "ease-in-out" } }
] }`,
      input_schema: z.object({
        operations: z.array(z.record(z.any())).describe('Operations with "op" field: add, update, remove, set'),
      }),
      risk: 'low' as const,
      capabilities_required: ['state.write'],
      handler: async (ctx: ToolCtx, input: { operations: any[] }) => {
        const scene = cloneScene(getScene(ctx));
        const results: any[] = [];

        for (const op of input.operations) {
          try {
            switch (op.op) {
              case 'add': {
                const nodeId = op.node?.id ?? op.id ?? uid();
                const node = { ...op.node, id: nodeId };
                if (node.type === 'group' && !node.children) node.children = [];
                const parent = op.parentId ? findGroup(scene.root, op.parentId) : scene.root;
                if (!parent) throw new Error(`Parent "${op.parentId}" not found`);
                parent.children.push(node);
                results.push({ op: 'add', nodeId });
                break;
              }
              case 'update': {
                const node = findNode(scene.root, op.nodeId);
                if (!node) throw new Error(`Node "${op.nodeId}" not found`);
                const { nodeId: _n, op: _o, ...props } = op;
                if (props.transform) {
                  node.transform = { ...(node.transform ?? {}), ...props.transform };
                  delete props.transform;
                }
                if (props.style) {
                  node.style = { ...(node.style ?? {}), ...props.style };
                  delete props.style;
                }
                if (props.tween) {
                  node.tween = { ...props.tween, startedAt: ctx.timestamp };
                  delete props.tween;
                }
                const { id: _id, type: _type, ...safeProps } = props;
                Object.assign(node, safeProps);
                results.push({ op: 'update', nodeId: op.nodeId });
                break;
              }
              case 'remove': {
                if (op.clear) {
                  scene.root.children = [];
                  results.push({ op: 'remove', cleared: true });
                } else if (op.nodeIds) {
                  for (const id of op.nodeIds) removeNode(scene.root, id);
                  results.push({ op: 'remove', nodeIds: op.nodeIds });
                } else if (op.nodeId) {
                  removeNode(scene.root, op.nodeId);
                  results.push({ op: 'remove', nodeId: op.nodeId });
                }
                break;
              }
              case 'set': {
                const { op: _o, ...setProps } = op;
                if (setProps.background != null) scene.background = setProps.background;
                if (setProps.width != null) scene.width = setProps.width;
                if (setProps.height != null) scene.height = setProps.height;
                if (setProps.camera) {
                  scene.camera = { ...(scene.camera ?? { x: 400, y: 300, zoom: 1 }), ...setProps.camera };
                }
                if (setProps.gradient) {
                  if (!scene.gradients) scene.gradients = [];
                  const idx = scene.gradients.findIndex((g: any) => g.id === setProps.gradient.id);
                  if (idx !== -1) scene.gradients[idx] = setProps.gradient;
                  else scene.gradients.push(setProps.gradient);
                }
                results.push({ op: 'set' });
                break;
              }
              default:
                results.push({ op: op.op, error: `Unknown operation: ${op.op}` });
            }
          } catch (err: any) {
            results.push({ op: op.op, error: err.message });
          }
        }

        ctx.setState({ ...ctx.state, _scene: scene });
        return { applied: results.length, results };
      },
    },
  ];
}

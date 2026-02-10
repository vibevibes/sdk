/**
 * Scene graph utility functions.
 *
 * These are pure functions that operate on the SceneGraph type.
 * Used by tool handlers, experience authors, and hooks.
 */

import type { SceneGraph, SceneNode, SceneNodeType, GroupNode, Camera } from './types';
import type { ToolDef, AgentHint } from '../types';
import { createSceneTools } from './tools';
import { createSceneHints } from './hints';

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Create an empty scene graph with sensible defaults.
 */
export function createScene(opts?: {
  width?: number;
  height?: number;
  background?: string;
}): SceneGraph {
  const w = opts?.width ?? 800;
  const h = opts?.height ?? 600;
  return {
    _sceneVersion: 1,
    root: { id: 'root', type: 'group', children: [] },
    camera: { x: w / 2, y: h / 2, zoom: 1 },
    background: opts?.background ?? '#1a1a2e',
    gradients: [],
    filters: [],
    width: w,
    height: h,
  };
}

/**
 * Create a new scene node with an auto-generated ID.
 *
 * Usage:
 *   createNode('rect', { width: 100, height: 50, style: { fill: '#f00' } })
 *   createNode('circle', { radius: 30 })
 *   createNode('text', { text: 'Hello' })
 */
export function createNode(
  type: SceneNodeType,
  props: Omit<any, 'id' | 'type'> & { id?: string },
): SceneNode {
  return {
    id: props.id ?? uid(),
    type,
    ...props,
  } as SceneNode;
}

/**
 * Find a node by ID anywhere in the scene graph.
 * Returns null if not found.
 */
export function nodeById(scene: SceneGraph, id: string): SceneNode | null {
  return findNodeInGroup(scene.root, id);
}

function findNodeInGroup(node: SceneNode, id: string): SceneNode | null {
  if (node.id === id) return node;
  if (node.type === 'group' && (node as GroupNode).children) {
    for (const child of (node as GroupNode).children) {
      const found = findNodeInGroup(child, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find all nodes matching a predicate.
 */
export function findNodes(scene: SceneGraph, predicate: (node: SceneNode) => boolean): SceneNode[] {
  const results: SceneNode[] = [];
  walkNodes(scene.root, (node) => {
    if (predicate(node)) results.push(node);
  });
  return results;
}

/**
 * Walk all nodes in the scene graph, calling the visitor for each.
 */
export function walkNodes(node: SceneNode, visitor: (node: SceneNode) => void): void {
  visitor(node);
  if (node.type === 'group' && (node as GroupNode).children) {
    for (const child of (node as GroupNode).children) {
      walkNodes(child, visitor);
    }
  }
}

/**
 * Get a flat list of all node IDs in the scene.
 */
export function allNodeIds(scene: SceneGraph): string[] {
  const ids: string[] = [];
  walkNodes(scene.root, (node) => ids.push(node.id));
  return ids;
}

/**
 * Count total nodes in the scene graph.
 */
export function nodeCount(scene: SceneGraph): number {
  let count = 0;
  walkNodes(scene.root, () => count++);
  return count;
}

/**
 * Deep clone a scene graph (JSON round-trip).
 */
export function cloneScene(scene: SceneGraph): SceneGraph {
  return JSON.parse(JSON.stringify(scene));
}

/**
 * Remove a node from the scene graph by ID. Returns true if found and removed.
 */
export function removeNodeById(root: GroupNode, id: string): boolean {
  if (!root.children) return false;
  const idx = root.children.findIndex(c => c.id === id);
  if (idx !== -1) {
    root.children.splice(idx, 1);
    return true;
  }
  for (const child of root.children) {
    if (child.type === 'group' && removeNodeById(child as GroupNode, id)) {
      return true;
    }
  }
  return false;
}

/**
 * Find a node's parent group. Returns null if node is the root or not found.
 */
export function findParent(root: GroupNode, nodeId: string): GroupNode | null {
  if (!root.children) return null;
  for (const child of root.children) {
    if (child.id === nodeId) return root;
    if (child.type === 'group') {
      const parent = findParent(child as GroupNode, nodeId);
      if (parent) return parent;
    }
  }
  return null;
}

/**
 * Return all pre-built scene tools ready to spread into defineExperience.
 *
 * Usage:
 *   import { sceneTools } from "@vibevibes/sdk";
 *   export default defineExperience({
 *     tools: [...myTools, ...sceneTools(z)],
 *   });
 */
export function sceneTools(z: any, namespace?: string): ToolDef[] {
  return createSceneTools(namespace ?? 'scene', z);
}

/**
 * Return pre-built agent hints for scene interaction.
 */
export function sceneHints(namespace?: string): AgentHint[] {
  return createSceneHints(namespace ?? 'scene');
}

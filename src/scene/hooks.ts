/**
 * Scene-specific React hooks.
 *
 * These hooks handle client-side concerns: interaction tracking, drag,
 * selection, viewport pan/zoom, tween interpolation, and particle simulation.
 *
 * Uses the same lazy React access pattern as sdk/src/hooks.ts.
 */

import type {
  SceneGraph, SceneNode, GroupNode, Vec2, Camera, TweenDef, ParticlesNode,
} from './types';
import { interpolateTween, setPath, getPath } from './tweens';
import { tickParticleNode } from './particles';

function getReact(): typeof import('react') {
  const R = (globalThis as any).React;
  if (!R) throw new Error('React is not available. Hooks must be used inside a Canvas component.');
  return R;
}

const React = new Proxy({} as typeof import('react'), {
  get(_target, prop) {
    return (getReact() as any)[prop];
  },
});

type CallToolFn = (name: string, input: any) => Promise<any>;

// ─── useSceneInteraction ─────────────────────────────────────────────────────

export type SceneInteractionEvent = {
  type: 'click' | 'hover' | 'hoverEnd';
  nodeId: string;
  x: number;
  y: number;
};

export type UseSceneInteractionReturn = {
  lastEvent: SceneInteractionEvent | null;
  hoveredNodeId: string | null;
  onNodeClick: (nodeId: string, event: { x: number; y: number }) => void;
  onNodeHover: (nodeId: string | null) => void;
};

/**
 * Track click/hover events on scene nodes.
 * Returns callbacks to wire into SceneRenderer props.
 */
export function useSceneInteraction(): UseSceneInteractionReturn {
  const [lastEvent, setLastEvent] = React.useState<SceneInteractionEvent | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null);

  const onNodeClick = React.useCallback((nodeId: string, event: { x: number; y: number }) => {
    setLastEvent({ type: 'click', nodeId, x: event.x, y: event.y });
  }, []);

  const onNodeHover = React.useCallback((nodeId: string | null) => {
    setHoveredNodeId(nodeId);
    if (nodeId) {
      setLastEvent({ type: 'hover', nodeId, x: 0, y: 0 });
    }
  }, []);

  return { lastEvent, hoveredNodeId, onNodeClick, onNodeHover };
}

// ─── useSceneDrag ────────────────────────────────────────────────────────────

export type UseSceneDragReturn = {
  dragging: string | null;
  dragOffset: Vec2 | null;
  onNodeDragStart: (nodeId: string, pos: Vec2) => void;
  onNodeDrag: (nodeId: string, pos: Vec2) => void;
  onNodeDragEnd: (nodeId: string, pos: Vec2) => void;
};

/**
 * Drag scene nodes. On drag end, commits position via scene.transform tool call.
 */
export function useSceneDrag(
  callTool: CallToolFn,
  toolNamespace: string = 'scene',
): UseSceneDragReturn {
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [dragOffset, setDragOffset] = React.useState<Vec2 | null>(null);
  const startRef = React.useRef<Vec2 | null>(null);

  const onNodeDragStart = React.useCallback((nodeId: string, pos: Vec2) => {
    setDragging(nodeId);
    startRef.current = pos;
    setDragOffset({ x: 0, y: 0 });
  }, []);

  const onNodeDrag = React.useCallback((nodeId: string, pos: Vec2) => {
    if (!startRef.current) return;
    setDragOffset({
      x: pos.x - startRef.current.x,
      y: pos.y - startRef.current.y,
    });
  }, []);

  const onNodeDragEnd = React.useCallback((nodeId: string, pos: Vec2) => {
    if (!startRef.current) return;
    const dx = pos.x - startRef.current.x;
    const dy = pos.y - startRef.current.y;
    setDragging(null);
    setDragOffset(null);
    startRef.current = null;

    // Commit via tool
    callTool(`${toolNamespace}.update`, {
      nodeId,
      transform: { x: dx, y: dy },
    }).catch(() => {});
  }, [callTool, toolNamespace]);

  return { dragging, dragOffset, onNodeDragStart, onNodeDrag, onNodeDragEnd };
}

// ─── useSceneSelection ───────────────────────────────────────────────────────

export type UseSceneSelectionReturn = {
  selectedIds: string[];
  select: (nodeId: string) => void;
  deselect: (nodeId: string) => void;
  toggle: (nodeId: string) => void;
  clear: () => void;
  isSelected: (nodeId: string) => boolean;
};

/**
 * Local multi-select state for scene nodes.
 */
export function useSceneSelection(): UseSceneSelectionReturn {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  const select = React.useCallback((nodeId: string) => {
    setSelectedIds((prev: string[]) => prev.includes(nodeId) ? prev : [...prev, nodeId]);
  }, []);

  const deselect = React.useCallback((nodeId: string) => {
    setSelectedIds((prev: string[]) => prev.filter((id: string) => id !== nodeId));
  }, []);

  const toggle = React.useCallback((nodeId: string) => {
    setSelectedIds((prev: string[]) =>
      prev.includes(nodeId)
        ? prev.filter((id: string) => id !== nodeId)
        : [...prev, nodeId],
    );
  }, []);

  const clear = React.useCallback(() => setSelectedIds([]), []);

  const isSelected = React.useCallback(
    (nodeId: string) => selectedIds.includes(nodeId),
    [selectedIds],
  );

  return { selectedIds, select, deselect, toggle, clear, isSelected };
}

// ─── useSceneViewport ────────────────────────────────────────────────────────

export type UseSceneViewportReturn = {
  camera: Camera;
  onViewportPan: (delta: Vec2) => void;
  onViewportZoom: (newZoom: number, center: Vec2) => void;
};

/**
 * Pan/zoom the scene camera. Debounces tool calls to persist camera changes.
 */
export function useSceneViewport(
  callTool: CallToolFn,
  scene: SceneGraph,
  toolNamespace: string = 'scene',
): UseSceneViewportReturn {
  const camera = scene.camera ?? { x: 400, y: 300, zoom: 1 };
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitCamera = React.useCallback((cam: Partial<Camera>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      callTool(`${toolNamespace}.set`, { camera: cam }).catch(() => {});
    }, 200);
  }, [callTool, toolNamespace]);

  const onViewportPan = React.useCallback((delta: Vec2) => {
    commitCamera({ x: camera.x + delta.x, y: camera.y + delta.y });
  }, [camera, commitCamera]);

  const onViewportZoom = React.useCallback((newZoom: number, _center: Vec2) => {
    commitCamera({ zoom: Math.max(0.1, Math.min(10, newZoom)) });
  }, [commitCamera]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { camera, onViewportPan, onViewportZoom };
}

// ─── useSceneTweens ──────────────────────────────────────────────────────────

/**
 * Client-side tween interpolation at 60fps.
 * Walks the scene graph, finds nodes with active tweens, interpolates
 * their values, and returns a new SceneGraph with interpolated properties.
 *
 * Does NOT modify shared state — purely display-side.
 */
export function useSceneTweens(scene: SceneGraph): SceneGraph {
  const [, forceRender] = React.useState(0);
  const rafRef = React.useRef<number | null>(null);
  const hasTweens = React.useRef(false);

  // Check if any nodes have active tweens
  hasTweens.current = false;
  const checkTweens = (node: any) => {
    if (node.tween?.startedAt != null) hasTweens.current = true;
    if (node.type === 'group' && node.children) {
      for (const child of node.children) checkTweens(child);
    }
  };
  checkTweens(scene.root);

  React.useEffect(() => {
    if (!hasTweens.current) return;

    const tick = () => {
      forceRender((n: number) => n + 1);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scene]); // Re-run when scene changes

  if (!hasTweens.current) return scene;

  // Apply tween interpolation
  const now = Date.now();
  return applyTweens(scene, now);
}

function applyTweens(scene: SceneGraph, now: number): SceneGraph {
  const newRoot = applyTweensToNode(scene.root, now);
  if (newRoot === scene.root) return scene;
  return { ...scene, root: newRoot as any };
}

function applyTweensToNode(node: SceneNode, now: number): SceneNode {
  let modified = false;
  let result: any = node;

  // Apply tween to this node
  if (node.tween?.startedAt != null) {
    const value = interpolateTween(node.tween, now);
    if (value != null) {
      result = setPath({ ...node }, node.tween.property, value);
      modified = true;
    }
  }

  // Recurse into children for groups
  if (node.type === 'group' && (node as GroupNode).children) {
    const children = (node as GroupNode).children;
    const newChildren = children.map(child => applyTweensToNode(child, now));
    const childrenChanged = newChildren.some((c, i) => c !== children[i]);
    if (childrenChanged) {
      result = { ...result, children: newChildren };
      modified = true;
    }
  }

  return modified ? result : node;
}

// ─── useParticleTick ─────────────────────────────────────────────────────────

/**
 * Client-side particle simulation at 60fps.
 * Finds ParticlesNode nodes, spawns and ticks particles, returns scene
 * with updated _particles arrays.
 *
 * Does NOT modify shared state — purely display-side.
 */
export function useParticleTick(scene: SceneGraph): SceneGraph {
  const [, forceRender] = React.useState(0);
  const rafRef = React.useRef<number | null>(null);
  const lastTimeRef = React.useRef<number>(Date.now());
  const particleStateRef = React.useRef<Map<string, any[]>>(new Map());
  const hasParticles = React.useRef(false);

  // Check if any particles nodes exist
  hasParticles.current = false;
  const checkParticles = (node: any) => {
    if (node.type === 'particles') hasParticles.current = true;
    if (node.type === 'group' && node.children) {
      for (const child of node.children) checkParticles(child);
    }
  };
  checkParticles(scene.root);

  React.useEffect(() => {
    if (!hasParticles.current) return;

    const tick = () => {
      const now = Date.now();
      const dt = Math.min(now - lastTimeRef.current, 100); // Cap at 100ms
      lastTimeRef.current = now;

      // Tick all particle nodes
      const updateNode = (node: any) => {
        if (node.type === 'particles') {
          const current = particleStateRef.current.get(node.id) ?? [];
          const fakeNode = { ...node, _particles: current };
          const updated = tickParticleNode(fakeNode, dt);
          particleStateRef.current.set(node.id, updated);
        }
        if (node.type === 'group' && node.children) {
          for (const child of node.children) updateNode(child);
        }
      };
      updateNode(scene.root);

      forceRender((n: number) => n + 1);
      rafRef.current = requestAnimationFrame(tick);
    };

    lastTimeRef.current = Date.now();
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scene]);

  if (!hasParticles.current) return scene;

  // Inject particle state into scene
  return injectParticles(scene, particleStateRef.current);
}

function injectParticles(scene: SceneGraph, particleState: Map<string, any[]>): SceneGraph {
  const newRoot = injectParticlesInNode(scene.root, particleState);
  if (newRoot === scene.root) return scene;
  return { ...scene, root: newRoot as any };
}

function injectParticlesInNode(node: SceneNode, particleState: Map<string, any[]>): SceneNode {
  if (node.type === 'particles') {
    const particles = particleState.get(node.id);
    if (particles) {
      return { ...node, _particles: particles } as ParticlesNode;
    }
  }

  if (node.type === 'group' && (node as GroupNode).children) {
    const children = (node as GroupNode).children;
    const newChildren = children.map(child => injectParticlesInNode(child, particleState));
    const changed = newChildren.some((c, i) => c !== children[i]);
    if (changed) return { ...node, children: newChildren } as GroupNode;
  }

  return node;
}

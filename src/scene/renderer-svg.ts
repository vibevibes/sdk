/**
 * SVG Scene Renderer.
 *
 * Takes a SceneGraph and renders it as SVG using React createElement calls.
 * Uses the same getReact()/h() pattern as components.ts — no JSX, no import.
 */

import type {
  SceneGraph, SceneNode, SceneRendererProps, GroupNode,
  Transform, Style, TextStyle, Camera, Gradient,
  LinearGradient, RadialGradient, FilterDef,
  RectNode, CircleNode, EllipseNode, LineNode,
  PolylineNode, PolygonNode, PathNode, TextNode,
  ImageNode, SpriteNode, TilemapNode, ParticlesNode,
  Vec2,
} from './types';

function getReact(): any {
  const R = (globalThis as any).React;
  if (!R) throw new Error('React is not available.');
  return R;
}

function h(type: string | Function, props: any, ...children: any[]) {
  return getReact().createElement(type, props, ...children);
}

// ─── Transform helpers ───────────────────────────────────────────────────────

function buildTransformString(t?: Transform): string | undefined {
  if (!t) return undefined;
  const parts: string[] = [];
  if (t.x != null || t.y != null) {
    parts.push(`translate(${t.x ?? 0}, ${t.y ?? 0})`);
  }
  if (t.rotation != null && t.rotation !== 0) {
    parts.push(`rotate(${t.rotation})`);
  }
  if ((t.scaleX != null && t.scaleX !== 1) || (t.scaleY != null && t.scaleY !== 1)) {
    parts.push(`scale(${t.scaleX ?? 1}, ${t.scaleY ?? 1})`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

// ─── Style helpers ───────────────────────────────────────────────────────────

function buildStyleAttrs(s?: Style): Record<string, any> {
  if (!s) return {};
  const attrs: Record<string, any> = {};
  if (s.fill != null) attrs.fill = s.fill;
  if (s.stroke != null) attrs.stroke = s.stroke;
  if (s.strokeWidth != null) attrs.strokeWidth = s.strokeWidth;
  if (s.strokeDasharray != null) attrs.strokeDasharray = s.strokeDasharray;
  if (s.strokeLinecap != null) attrs.strokeLinecap = s.strokeLinecap;
  if (s.strokeLinejoin != null) attrs.strokeLinejoin = s.strokeLinejoin;
  if (s.opacity != null) attrs.opacity = s.opacity;
  if (s.fillOpacity != null) attrs.fillOpacity = s.fillOpacity;
  if (s.strokeOpacity != null) attrs.strokeOpacity = s.strokeOpacity;
  if (s.filter != null) attrs.filter = s.filter;
  if (s.cursor != null) attrs.style = { ...attrs.style, cursor: s.cursor };
  if (s.pointerEvents != null) attrs.pointerEvents = s.pointerEvents;
  return attrs;
}

function buildTextAttrs(s?: TextStyle): Record<string, any> {
  if (!s) return {};
  const attrs = buildStyleAttrs(s);
  if (s.fontSize != null) attrs.fontSize = s.fontSize;
  if (s.fontFamily != null) attrs.fontFamily = s.fontFamily;
  if (s.fontWeight != null) attrs.fontWeight = s.fontWeight;
  if (s.textAnchor != null) attrs.textAnchor = s.textAnchor;
  if (s.dominantBaseline != null) attrs.dominantBaseline = s.dominantBaseline;
  if (s.letterSpacing != null) attrs.letterSpacing = s.letterSpacing;
  return attrs;
}

// ─── Gradient rendering ──────────────────────────────────────────────────────

function renderGradient(g: Gradient): any {
  if (g.type === 'linear') {
    const lg = g as LinearGradient;
    return h('linearGradient', {
      key: lg.id,
      id: lg.id,
      x1: lg.x1, y1: lg.y1, x2: lg.x2, y2: lg.y2,
      gradientUnits: 'objectBoundingBox',
    },
      ...lg.stops.map((s, i) =>
        h('stop', { key: i, offset: s.offset, stopColor: s.color })
      ),
    );
  }
  const rg = g as RadialGradient;
  return h('radialGradient', {
    key: rg.id,
    id: rg.id,
    cx: rg.cx, cy: rg.cy, r: rg.r,
    fx: rg.fx, fy: rg.fy,
    gradientUnits: 'objectBoundingBox',
  },
    ...rg.stops.map((s, i) =>
      h('stop', { key: i, offset: s.offset, stopColor: s.color })
    ),
  );
}

// ─── Filter rendering ────────────────────────────────────────────────────────

function renderFilter(f: FilterDef): any {
  const children: any[] = [];
  switch (f.type) {
    case 'blur':
      children.push(h('feGaussianBlur', { key: 'blur', stdDeviation: f.params.radius ?? 4 }));
      break;
    case 'shadow':
      children.push(
        h('feDropShadow', {
          key: 'shadow',
          dx: f.params.dx ?? 2,
          dy: f.params.dy ?? 2,
          stdDeviation: f.params.blur ?? 3,
          floodColor: f.params.color ?? '#000',
          floodOpacity: f.params.opacity ?? 0.5,
        }),
      );
      break;
    case 'glow':
      children.push(
        h('feGaussianBlur', { key: 'blur', stdDeviation: f.params.radius ?? 4, result: 'blur' }),
        h('feMerge', { key: 'merge' },
          h('feMergeNode', { key: 'n1', in: 'blur' }),
          h('feMergeNode', { key: 'n2', in: 'SourceGraphic' }),
        ),
      );
      break;
    default:
      break;
  }
  return h('filter', { key: f.id, id: f.id }, ...children);
}

// ─── Node renderers ──────────────────────────────────────────────────────────

type RenderContext = {
  onNodeClick?: (nodeId: string, event: { x: number; y: number }) => void;
  onNodeHover?: (nodeId: string | null) => void;
  onNodeDragStart?: (nodeId: string, pos: Vec2) => void;
  onNodeDrag?: (nodeId: string, pos: Vec2) => void;
  onNodeDragEnd?: (nodeId: string, pos: Vec2) => void;
  selectedNodeIds?: string[];
  debug?: boolean;
  svgRef?: any;
};

function interactionHandlers(node: SceneNode, rctx: RenderContext): Record<string, any> {
  if (!node.interactive) return {};
  const handlers: Record<string, any> = {};

  if (rctx.onNodeClick) {
    handlers.onClick = (e: any) => {
      e.stopPropagation();
      const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
      rctx.onNodeClick!(node.id, {
        x: rect ? e.clientX - rect.left : e.clientX,
        y: rect ? e.clientY - rect.top : e.clientY,
      });
    };
  }

  if (rctx.onNodeHover) {
    handlers.onMouseEnter = () => rctx.onNodeHover!(node.id);
    handlers.onMouseLeave = () => rctx.onNodeHover!(null);
  }

  if (rctx.onNodeDragStart) {
    handlers.onMouseDown = (e: any) => {
      e.stopPropagation();
      const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
      const pos = {
        x: rect ? e.clientX - rect.left : e.clientX,
        y: rect ? e.clientY - rect.top : e.clientY,
      };
      rctx.onNodeDragStart!(node.id, pos);
    };
  }

  return handlers;
}

function renderNode(node: SceneNode, rctx: RenderContext): any {
  if (node.style?.visible === false) return null;

  const transform = buildTransformString(node.transform);
  const handlers = interactionHandlers(node, rctx);
  const isSelected = rctx.selectedNodeIds?.includes(node.id);

  let element: any = null;

  switch (node.type) {
    case 'rect': {
      const n = node as RectNode;
      element = h('rect', {
        x: -n.width / 2,
        y: -n.height / 2,
        width: n.width,
        height: n.height,
        rx: n.rx,
        ry: n.ry,
        ...buildStyleAttrs(n.style),
        ...handlers,
      });
      break;
    }
    case 'circle': {
      const n = node as CircleNode;
      element = h('circle', {
        r: n.radius,
        ...buildStyleAttrs(n.style),
        ...handlers,
      });
      break;
    }
    case 'ellipse': {
      const n = node as EllipseNode;
      element = h('ellipse', {
        rx: n.rx,
        ry: n.ry,
        ...buildStyleAttrs(n.style),
        ...handlers,
      });
      break;
    }
    case 'line': {
      const n = node as LineNode;
      element = h('line', {
        x1: 0,
        y1: 0,
        x2: n.x2,
        y2: n.y2,
        ...buildStyleAttrs(n.style),
        ...handlers,
      });
      break;
    }
    case 'polyline': {
      const n = node as PolylineNode;
      element = h('polyline', {
        points: n.points.map(p => `${p.x},${p.y}`).join(' '),
        fill: 'none',
        ...buildStyleAttrs(n.style),
        ...handlers,
      });
      break;
    }
    case 'polygon': {
      const n = node as PolygonNode;
      element = h('polygon', {
        points: n.points.map(p => `${p.x},${p.y}`).join(' '),
        ...buildStyleAttrs(n.style),
        ...handlers,
      });
      break;
    }
    case 'path': {
      const n = node as PathNode;
      element = h('path', {
        d: n.d,
        ...buildStyleAttrs(n.style),
        ...handlers,
      });
      break;
    }
    case 'text': {
      const n = node as TextNode;
      element = h('text', {
        ...buildTextAttrs(n.style as TextStyle),
        ...handlers,
      }, n.text);
      break;
    }
    case 'image': {
      const n = node as ImageNode;
      element = h('image', {
        href: n.href,
        x: -n.width / 2,
        y: -n.height / 2,
        width: n.width,
        height: n.height,
        preserveAspectRatio: n.preserveAspectRatio ?? 'xMidYMid meet',
        ...handlers,
      });
      break;
    }
    case 'group': {
      const n = node as GroupNode;
      element = h('g', {},
        ...n.children.map(child => renderNode(child, rctx)),
      );
      break;
    }
    case 'sprite': {
      const n = node as SpriteNode;
      const cols = n.columns ?? Math.floor(1000 / n.frameWidth); // Rough default
      const frame = n.frame ?? 0;
      const col = frame % cols;
      const row = Math.floor(frame / cols);
      const clipId = `sprite-clip-${n.id}`;

      element = h('g', {},
        h('defs', {},
          h('clipPath', { id: clipId },
            h('rect', { x: 0, y: 0, width: n.frameWidth, height: n.frameHeight }),
          ),
        ),
        h('g', { clipPath: `url(#${clipId})` },
          h('image', {
            href: n.href,
            x: -col * n.frameWidth,
            y: -row * n.frameHeight,
            width: cols * n.frameWidth,
            height: Math.ceil(1000 / cols) * n.frameHeight, // Approximate
            ...handlers,
          }),
        ),
      );
      break;
    }
    case 'tilemap': {
      const n = node as TilemapNode;
      const tiles: any[] = [];
      for (let row = 0; row < n.height; row++) {
        for (let col = 0; col < n.width; col++) {
          const tileIdx = n.data[row]?.[col];
          if (tileIdx == null || tileIdx < 0) continue;

          const srcCol = tileIdx % n.columns;
          const srcRow = Math.floor(tileIdx / n.columns);
          const clipId = `tile-${n.id}-${row}-${col}`;

          tiles.push(
            h('g', {
              key: `${row}-${col}`,
              transform: `translate(${col * n.tileWidth}, ${row * n.tileHeight})`,
            },
              h('defs', {},
                h('clipPath', { id: clipId },
                  h('rect', { x: 0, y: 0, width: n.tileWidth, height: n.tileHeight }),
                ),
              ),
              h('g', { clipPath: `url(#${clipId})` },
                h('image', {
                  href: n.href,
                  x: -srcCol * n.tileWidth,
                  y: -srcRow * n.tileHeight,
                  width: n.columns * n.tileWidth,
                  height: Math.ceil(256 / n.columns) * n.tileHeight,
                }),
              ),
            ),
          );
        }
      }
      element = h('g', {}, ...tiles);
      break;
    }
    case 'particles': {
      const n = node as ParticlesNode;
      const particles = n._particles ?? [];
      element = h('g', {},
        ...particles.map((p, i) => {
          const alpha = n.emitters[0]?.fadeOut !== false
            ? Math.max(0, 1 - p.age / p.lifetime)
            : 1;
          const shape = n.emitters[0]?.shape ?? 'circle';
          if (shape === 'square') {
            return h('rect', {
              key: i,
              x: p.x - p.size / 2,
              y: p.y - p.size / 2,
              width: p.size,
              height: p.size,
              fill: p.color,
              opacity: alpha,
            });
          }
          return h('circle', {
            key: i,
            cx: p.x,
            cy: p.y,
            r: p.size / 2,
            fill: p.color,
            opacity: alpha,
          });
        }),
      );
      break;
    }
    default:
      return null;
  }

  if (!element) return null;

  // Wrap in group with transform and key
  const wrapperProps: any = { key: node.id };
  if (transform) wrapperProps.transform = transform;

  const children = [element];

  // Selection highlight
  if (isSelected && node.type !== 'group') {
    children.push(
      h('rect', {
        key: 'selection',
        x: -getBoundsWidth(node) / 2 - 4,
        y: -getBoundsHeight(node) / 2 - 4,
        width: getBoundsWidth(node) + 8,
        height: getBoundsHeight(node) + 8,
        fill: 'none',
        stroke: '#6366f1',
        strokeWidth: 2,
        strokeDasharray: '4,2',
        pointerEvents: 'none',
      }),
    );
  }

  // Debug label
  if (rctx.debug) {
    children.push(
      h('text', {
        key: 'debug-label',
        y: -getBoundsHeight(node) / 2 - 8,
        fontSize: 10,
        fill: '#94a3b8',
        textAnchor: 'middle',
        pointerEvents: 'none',
      }, node.id),
    );
  }

  return h('g', wrapperProps, ...children);
}

// Rough bounding box estimates for selection/debug
function getBoundsWidth(node: SceneNode): number {
  switch (node.type) {
    case 'rect': return (node as RectNode).width;
    case 'circle': return (node as CircleNode).radius * 2;
    case 'ellipse': return (node as EllipseNode).rx * 2;
    case 'image': return (node as ImageNode).width;
    case 'text': return 100; // Approximate
    default: return 50;
  }
}

function getBoundsHeight(node: SceneNode): number {
  switch (node.type) {
    case 'rect': return (node as RectNode).height;
    case 'circle': return (node as CircleNode).radius * 2;
    case 'ellipse': return (node as EllipseNode).ry * 2;
    case 'image': return (node as ImageNode).height;
    case 'text': return 24; // Approximate
    default: return 50;
  }
}

// ─── Main SVG Renderer ───────────────────────────────────────────────────────

export function SvgSceneRenderer(props: SceneRendererProps) {
  const {
    scene,
    width = scene.width ?? 800,
    height = scene.height ?? 600,
    className,
    style: containerStyle,
    onNodeClick,
    onNodeHover,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragEnd,
    onViewportClick,
    onViewportPan,
    onViewportZoom,
    selectedNodeIds,
    debug,
  } = props;

  const React = getReact();

  // Camera → viewBox calculation
  const camera = scene.camera ?? { x: width / 2, y: height / 2, zoom: 1 };
  const zoom = camera.zoom || 1;
  const vbW = width / zoom;
  const vbH = height / zoom;
  const vbX = camera.x - vbW / 2;
  const vbY = camera.y - vbH / 2;
  const viewBox = `${vbX} ${vbY} ${vbW} ${vbH}`;

  // Drag state for viewport panning
  const dragRef = React.useRef(null as { startX: number; startY: number; camX: number; camY: number } | null);

  const rctx: RenderContext = {
    onNodeClick,
    onNodeHover,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragEnd,
    selectedNodeIds,
    debug,
  };

  // SVG event handlers
  const svgHandlers: Record<string, any> = {};

  if (onViewportClick) {
    svgHandlers.onClick = (e: any) => {
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const x = vbX + ((e.clientX - rect.left) / rect.width) * vbW;
      const y = vbY + ((e.clientY - rect.top) / rect.height) * vbH;
      onViewportClick({ x, y });
    };
  }

  if (onViewportZoom) {
    svgHandlers.onWheel = (e: any) => {
      e.preventDefault();
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const cx = vbX + ((e.clientX - rect.left) / rect.width) * vbW;
      const cy = vbY + ((e.clientY - rect.top) / rect.height) * vbH;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      onViewportZoom(zoom * factor, { x: cx, y: cy });
    };
  }

  if (onViewportPan) {
    svgHandlers.onMouseDown = (e: any) => {
      if (e.target === e.currentTarget || e.target.tagName === 'rect') {
        dragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          camX: camera.x,
          camY: camera.y,
        };
      }
    };
    svgHandlers.onMouseMove = (e: any) => {
      if (!dragRef.current) return;
      const dx = (e.clientX - dragRef.current.startX) / zoom;
      const dy = (e.clientY - dragRef.current.startY) / zoom;
      onViewportPan({ x: -dx, y: -dy });
    };
    svgHandlers.onMouseUp = () => {
      dragRef.current = null;
    };
    svgHandlers.onMouseLeave = () => {
      dragRef.current = null;
    };
  }

  // Build defs (gradients + filters)
  const defs: any[] = [];
  if (scene.gradients?.length) {
    for (const g of scene.gradients) {
      defs.push(renderGradient(g));
    }
  }
  if (scene.filters?.length) {
    for (const f of scene.filters) {
      defs.push(renderFilter(f));
    }
  }

  return h('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox,
    width,
    height,
    className,
    style: {
      backgroundColor: scene.background ?? '#1a1a2e',
      display: 'block',
      ...containerStyle,
    },
    ...svgHandlers,
  },
    defs.length > 0 ? h('defs', { key: 'defs' }, ...defs) : null,
    renderNode(scene.root, rctx),
  );
}

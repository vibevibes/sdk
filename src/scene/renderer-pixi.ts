/**
 * PixiJS WebGL Scene Renderer.
 *
 * Takes a SceneGraph and renders it to a WebGL canvas using PixiJS v8.
 * Uses retained-mode rendering: on scene change, diffs and updates Pixi display objects
 * rather than recreating the tree. Implements the same SceneRendererProps interface
 * as SvgSceneRenderer.
 *
 * PixiJS is an optional dependency. If not available, the component renders a fallback
 * message instructing the user to install pixi.js.
 *
 * Uses the getReact()/h() pattern — no JSX, no import React.
 */

import type {
  SceneGraph, SceneNode, SceneRendererProps, GroupNode,
  Transform, Style, TextStyle, Camera, Gradient,
  LinearGradient, RadialGradient,
  RectNode, CircleNode, EllipseNode, LineNode,
  PolylineNode, PolygonNode, PathNode, TextNode,
  ImageNode, SpriteNode, TilemapNode, ParticlesNode,
  Vec2, TweenDef, EasingType, Particle, ParticleEmitter,
} from './types';
import { easingFunctions, interpolateTween, getPath } from './tweens';

// ─── React access ─────────────────────────────────────────────────────────────

function getReact(): any {
  const R = (globalThis as any).React;
  if (!R) throw new Error('React is not available.');
  return R;
}

function h(type: string | Function, props: any, ...children: any[]) {
  return getReact().createElement(type, props, ...children);
}

// ─── PixiJS dynamic access ───────────────────────────────────────────────────

let _PIXI: any = null;
let _pixiLoadAttempted = false;
let _pixiLoadPromise: Promise<any> | null = null;

function getPixi(): any {
  if (_PIXI) return _PIXI;
  // Try globalThis first
  if ((globalThis as any).__PIXI) {
    _PIXI = (globalThis as any).__PIXI;
    return _PIXI;
  }
  if ((globalThis as any).PIXI) {
    _PIXI = (globalThis as any).PIXI;
    return _PIXI;
  }
  return null;
}

async function loadPixi(): Promise<any> {
  if (_PIXI) return _PIXI;
  if (_pixiLoadPromise) return _pixiLoadPromise;

  _pixiLoadPromise = (async () => {
    // Try globalThis first
    const g = getPixi();
    if (g) return g;

    if (_pixiLoadAttempted) return null;
    _pixiLoadAttempted = true;

    try {
      // Dynamic import
      // @ts-ignore - pixi.js may not have type declarations installed
      const mod = await import(/* webpackIgnore: true */ 'pixi.js');
      _PIXI = mod.default || mod;
      return _PIXI;
    } catch {
      try {
        // Try alternate module name
        const mod = await import(/* webpackIgnore: true */ 'pixi' as any);
        _PIXI = mod.default || mod;
        return _PIXI;
      } catch {
        return null;
      }
    }
  })();

  const result = await _pixiLoadPromise;
  _pixiLoadPromise = null;
  return result;
}

// ─── Color helpers ──────────────────────────────────────────────────────────

/** Convert CSS color string to a number PixiJS can use, or return the string for Pixi v8 */
function resolveColor(color: string | undefined, gradients?: Gradient[]): string | number {
  if (!color) return 0x000000;

  // Handle gradient references: url(#id) — extract first stop color as fallback
  const gradRef = color.match(/^url\(#(.+)\)$/);
  if (gradRef && gradients) {
    const grad = gradients.find(g => g.id === gradRef[1]);
    if (grad && grad.stops.length > 0) {
      return grad.stops[0].color;
    }
  }

  // PixiJS v8 accepts CSS color strings directly
  return color;
}

/** Parse a gradient definition into a PixiJS FillGradient if available, else return first stop color */
function resolveGradientFill(color: string | undefined, gradients?: Gradient[], PIXI?: any): any {
  if (!color) return undefined;

  const gradRef = color.match(/^url\(#(.+)\)$/);
  if (!gradRef || !gradients) return color;

  const grad = gradients.find(g => g.id === gradRef[1]);
  if (!grad || grad.stops.length === 0) return color;

  // Try PixiJS FillGradient (v8+)
  if (PIXI && PIXI.FillGradient) {
    try {
      if (grad.type === 'linear') {
        const lg = grad as LinearGradient;
        const fg = new PIXI.FillGradient({
          type: 'linear',
          start: { x: lg.x1, y: lg.y1 },
          end: { x: lg.x2, y: lg.y2 },
          colorStops: lg.stops.map((s: any) => ({ offset: s.offset, color: s.color })),
        });
        return fg;
      }
      // Radial gradient support in Pixi FillGradient varies; fall back to first stop
    } catch {
      // FillGradient API may differ; fall back
    }
  }

  // Fallback: first stop color
  return grad.stops[0].color;
}

// ─── SVG Path Parser (basic M, L, C, Q, Z) ─────────────────────────────────

type PathCommand =
  | { cmd: 'M'; x: number; y: number }
  | { cmd: 'L'; x: number; y: number }
  | { cmd: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { cmd: 'Q'; x1: number; y1: number; x: number; y: number }
  | { cmd: 'Z' };

function parseSvgPath(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  // Tokenize: split on command letters, keeping the letter
  const re = /([MmLlHhVvCcSsQqTtAaZz])/;
  const tokens = d.split(re).filter(s => s.trim().length > 0);

  let i = 0;
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;

  while (i < tokens.length) {
    const cmd = tokens[i];
    i++;
    const nums: number[] = [];
    if (i < tokens.length && !re.test(tokens[i])) {
      const raw = tokens[i].trim()
        .replace(/,/g, ' ')
        .replace(/-/g, ' -')
        .replace(/\s+/g, ' ')
        .trim();
      if (raw.length > 0) {
        nums.push(...raw.split(' ').filter(s => s.length > 0).map(Number));
      }
      i++;
    }

    switch (cmd) {
      case 'M':
        for (let j = 0; j < nums.length; j += 2) {
          curX = nums[j]; curY = nums[j + 1];
          if (j === 0) { startX = curX; startY = curY; }
          commands.push({ cmd: 'M', x: curX, y: curY });
        }
        break;
      case 'm':
        for (let j = 0; j < nums.length; j += 2) {
          curX += nums[j]; curY += nums[j + 1];
          if (j === 0) { startX = curX; startY = curY; }
          commands.push({ cmd: 'M', x: curX, y: curY });
        }
        break;
      case 'L':
        for (let j = 0; j < nums.length; j += 2) {
          curX = nums[j]; curY = nums[j + 1];
          commands.push({ cmd: 'L', x: curX, y: curY });
        }
        break;
      case 'l':
        for (let j = 0; j < nums.length; j += 2) {
          curX += nums[j]; curY += nums[j + 1];
          commands.push({ cmd: 'L', x: curX, y: curY });
        }
        break;
      case 'H':
        for (let j = 0; j < nums.length; j++) {
          curX = nums[j];
          commands.push({ cmd: 'L', x: curX, y: curY });
        }
        break;
      case 'h':
        for (let j = 0; j < nums.length; j++) {
          curX += nums[j];
          commands.push({ cmd: 'L', x: curX, y: curY });
        }
        break;
      case 'V':
        for (let j = 0; j < nums.length; j++) {
          curY = nums[j];
          commands.push({ cmd: 'L', x: curX, y: curY });
        }
        break;
      case 'v':
        for (let j = 0; j < nums.length; j++) {
          curY += nums[j];
          commands.push({ cmd: 'L', x: curX, y: curY });
        }
        break;
      case 'C':
        for (let j = 0; j < nums.length; j += 6) {
          commands.push({ cmd: 'C', x1: nums[j], y1: nums[j+1], x2: nums[j+2], y2: nums[j+3], x: nums[j+4], y: nums[j+5] });
          curX = nums[j+4]; curY = nums[j+5];
        }
        break;
      case 'c':
        for (let j = 0; j < nums.length; j += 6) {
          commands.push({ cmd: 'C', x1: curX + nums[j], y1: curY + nums[j+1], x2: curX + nums[j+2], y2: curY + nums[j+3], x: curX + nums[j+4], y: curY + nums[j+5] });
          curX += nums[j+4]; curY += nums[j+5];
        }
        break;
      case 'Q':
        for (let j = 0; j < nums.length; j += 4) {
          commands.push({ cmd: 'Q', x1: nums[j], y1: nums[j+1], x: nums[j+2], y: nums[j+3] });
          curX = nums[j+2]; curY = nums[j+3];
        }
        break;
      case 'q':
        for (let j = 0; j < nums.length; j += 4) {
          commands.push({ cmd: 'Q', x1: curX + nums[j], y1: curY + nums[j+1], x: curX + nums[j+2], y: curY + nums[j+3] });
          curX += nums[j+2]; curY += nums[j+3];
        }
        break;
      case 'S':
      case 's': {
        // Smooth cubic: reflect last control point (approximate as C with mirrored cp)
        for (let j = 0; j < nums.length; j += 4) {
          const abs = cmd === 'S';
          const x2 = abs ? nums[j] : curX + nums[j];
          const y2 = abs ? nums[j+1] : curY + nums[j+1];
          const x = abs ? nums[j+2] : curX + nums[j+2];
          const y = abs ? nums[j+3] : curY + nums[j+3];
          // Use current point as reflected control point (simplified)
          commands.push({ cmd: 'C', x1: curX, y1: curY, x2, y2, x, y });
          curX = x; curY = y;
        }
        break;
      }
      case 'T':
      case 't': {
        // Smooth quadratic
        for (let j = 0; j < nums.length; j += 2) {
          const abs = cmd === 'T';
          const x = abs ? nums[j] : curX + nums[j];
          const y = abs ? nums[j+1] : curY + nums[j+1];
          commands.push({ cmd: 'Q', x1: curX, y1: curY, x, y });
          curX = x; curY = y;
        }
        break;
      }
      case 'A':
      case 'a': {
        // Arc commands: approximate as line to endpoint for simplicity
        for (let j = 0; j < nums.length; j += 7) {
          const abs = cmd === 'A';
          const ex = abs ? nums[j+5] : curX + nums[j+5];
          const ey = abs ? nums[j+6] : curY + nums[j+6];
          commands.push({ cmd: 'L', x: ex, y: ey });
          curX = ex; curY = ey;
        }
        break;
      }
      case 'Z':
      case 'z':
        commands.push({ cmd: 'Z' });
        curX = startX; curY = startY;
        break;
    }
  }

  return commands;
}

function drawSvgPath(g: any, d: string): void {
  const cmds = parseSvgPath(d);
  for (const c of cmds) {
    switch (c.cmd) {
      case 'M': g.moveTo(c.x, c.y); break;
      case 'L': g.lineTo(c.x, c.y); break;
      case 'C': g.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y); break;
      case 'Q': g.quadraticCurveTo(c.x1, c.y1, c.x, c.y); break;
      case 'Z': g.closePath(); break;
    }
  }
}

// ─── Bounding box estimates ─────────────────────────────────────────────────

function getBoundsWidth(node: SceneNode): number {
  switch (node.type) {
    case 'rect': return (node as RectNode).width;
    case 'circle': return (node as CircleNode).radius * 2;
    case 'ellipse': return (node as EllipseNode).rx * 2;
    case 'image': return (node as ImageNode).width;
    case 'text': return 100;
    default: return 50;
  }
}

function getBoundsHeight(node: SceneNode): number {
  switch (node.type) {
    case 'rect': return (node as RectNode).height;
    case 'circle': return (node as CircleNode).radius * 2;
    case 'ellipse': return (node as EllipseNode).ry * 2;
    case 'image': return (node as ImageNode).height;
    case 'text': return 24;
    default: return 50;
  }
}

// ─── Display Object Pool ────────────────────────────────────────────────────

/**
 * Metadata we attach to Pixi display objects for diffing and event handling.
 * Stored as `displayObject.__vv` to avoid conflicts.
 */
type DisplayObjectMeta = {
  nodeId: string;
  nodeType: string;
  /** Serialized snapshot of the SceneNode data for diffing */
  snapshot: string;
};

function getMeta(obj: any): DisplayObjectMeta | undefined {
  return obj?.__vv;
}

function setMeta(obj: any, meta: DisplayObjectMeta): void {
  obj.__vv = meta;
}

/** Create a serializable snapshot key for a node (excluding children for groups). */
function nodeSnapshot(node: SceneNode): string {
  if (node.type === 'group') {
    // For groups, don't include children in the snapshot — they're diffed recursively
    const { children, ...rest } = node as GroupNode;
    return JSON.stringify(rest);
  }
  return JSON.stringify(node);
}

// ─── Interaction context ────────────────────────────────────────────────────

type PixiRenderContext = {
  PIXI: any;
  app: any;
  gradients?: Gradient[];
  onNodeClick?: (nodeId: string, event: { x: number; y: number }) => void;
  onNodeHover?: (nodeId: string | null) => void;
  onNodeDragStart?: (nodeId: string, pos: Vec2) => void;
  onNodeDrag?: (nodeId: string, pos: Vec2) => void;
  onNodeDragEnd?: (nodeId: string, pos: Vec2) => void;
  selectedNodeIds?: string[];
  debug?: boolean;
  /** Map from node id to its display object for fast lookup */
  nodeMap: Map<string, any>;
  /** Texture cache for images */
  textureCache: Map<string, any>;
  /** Selection overlay container */
  selectionLayer: any;
  /** Debug label container */
  debugLayer: any;
};

// ─── Apply transform to a Pixi display object ──────────────────────────────

function applyTransform(obj: any, t?: Transform): void {
  if (!t) {
    obj.position.set(0, 0);
    obj.rotation = 0;
    obj.scale.set(1, 1);
    return;
  }
  obj.position.set(t.x ?? 0, t.y ?? 0);
  obj.rotation = ((t.rotation ?? 0) * Math.PI) / 180;
  obj.scale.set(t.scaleX ?? 1, t.scaleY ?? 1);
  // Pixi pivot corresponds to transform origin
  // For shapes drawn centered, pivot is typically 0,0
  // We handle origin via drawing offset rather than pivot for most shapes
}

function applyStyle(obj: any, s?: Style): void {
  if (!obj) return;
  obj.alpha = s?.opacity ?? 1;
  obj.visible = s?.visible !== false;
  if (s?.cursor && obj.cursor !== undefined) {
    obj.cursor = s.cursor;
  }
}

// ─── Node creation / update ─────────────────────────────────────────────────

function applyGraphicsStyle(g: any, style: Style | undefined, gradients: Gradient[] | undefined, PIXI: any): void {
  const fill = style?.fill;
  const stroke = style?.stroke;
  const strokeWidth = style?.strokeWidth ?? 1;

  if (fill && fill !== 'none') {
    const resolved = resolveGradientFill(fill, gradients, PIXI);
    if (typeof resolved === 'object' && resolved !== null && resolved.constructor && resolved.constructor.name === 'FillGradient') {
      g.fill(resolved);
    } else {
      const fillAlpha = style?.fillOpacity ?? 1;
      g.fill({ color: resolved, alpha: fillAlpha });
    }
  }

  if (stroke && stroke !== 'none') {
    const strokeAlpha = style?.strokeOpacity ?? 1;
    const strokeOpts: any = {
      width: strokeWidth,
      color: resolveColor(stroke, gradients),
      alpha: strokeAlpha,
    };
    if (style?.strokeLinecap) strokeOpts.cap = mapLinecap(style.strokeLinecap);
    if (style?.strokeLinejoin) strokeOpts.join = mapLinejoin(style.strokeLinejoin);
    g.stroke(strokeOpts);
  }
}

function mapLinecap(cap: string): string {
  switch (cap) {
    case 'round': return 'round';
    case 'square': return 'square';
    default: return 'butt';
  }
}

function mapLinejoin(join: string): string {
  switch (join) {
    case 'round': return 'round';
    case 'bevel': return 'bevel';
    default: return 'miter';
  }
}

function createDisplayObject(node: SceneNode, ctx: PixiRenderContext): any {
  const PIXI = ctx.PIXI;
  let obj: any;

  switch (node.type) {
    case 'rect': {
      const n = node as RectNode;
      const g = new PIXI.Graphics();
      if (n.rx || n.ry) {
        g.roundRect(-n.width / 2, -n.height / 2, n.width, n.height, n.rx ?? n.ry ?? 0);
      } else {
        g.rect(-n.width / 2, -n.height / 2, n.width, n.height);
      }
      applyGraphicsStyle(g, n.style, ctx.gradients, PIXI);
      obj = g;
      break;
    }

    case 'circle': {
      const n = node as CircleNode;
      const g = new PIXI.Graphics();
      g.circle(0, 0, n.radius);
      applyGraphicsStyle(g, n.style, ctx.gradients, PIXI);
      obj = g;
      break;
    }

    case 'ellipse': {
      const n = node as EllipseNode;
      const g = new PIXI.Graphics();
      g.ellipse(0, 0, n.rx, n.ry);
      applyGraphicsStyle(g, n.style, ctx.gradients, PIXI);
      obj = g;
      break;
    }

    case 'line': {
      const n = node as LineNode;
      const g = new PIXI.Graphics();
      g.moveTo(0, 0);
      g.lineTo(n.x2, n.y2);
      // Lines typically only have stroke
      const style = { ...(n.style ?? {}), fill: undefined };
      applyGraphicsStyle(g, style as Style, ctx.gradients, PIXI);
      // If no stroke was set, draw a default
      if (!n.style?.stroke) {
        g.stroke({ width: n.style?.strokeWidth ?? 1, color: 0xffffff });
      }
      obj = g;
      break;
    }

    case 'polyline': {
      const n = node as PolylineNode;
      const g = new PIXI.Graphics();
      if (n.points.length > 0) {
        g.moveTo(n.points[0].x, n.points[0].y);
        for (let i = 1; i < n.points.length; i++) {
          g.lineTo(n.points[i].x, n.points[i].y);
        }
      }
      // Polylines default to no fill
      const style = { ...(n.style ?? {}), fill: n.style?.fill ?? 'none' };
      applyGraphicsStyle(g, style as Style, ctx.gradients, PIXI);
      if (!n.style?.stroke) {
        g.stroke({ width: n.style?.strokeWidth ?? 1, color: 0xffffff });
      }
      obj = g;
      break;
    }

    case 'polygon': {
      const n = node as PolygonNode;
      const g = new PIXI.Graphics();
      if (n.points.length > 0) {
        const flat: number[] = [];
        for (const p of n.points) {
          flat.push(p.x, p.y);
        }
        g.poly(flat, true);
      }
      applyGraphicsStyle(g, n.style, ctx.gradients, PIXI);
      obj = g;
      break;
    }

    case 'path': {
      const n = node as PathNode;
      const g = new PIXI.Graphics();
      drawSvgPath(g, n.d);
      applyGraphicsStyle(g, n.style, ctx.gradients, PIXI);
      obj = g;
      break;
    }

    case 'text': {
      const n = node as TextNode;
      const ts = n.style as TextStyle | undefined;
      const pixiStyle: any = {
        fontSize: ts?.fontSize ?? 16,
        fontFamily: ts?.fontFamily ?? 'Arial',
        fontWeight: ts?.fontWeight != null ? String(ts.fontWeight) : 'normal',
        fill: resolveColor(ts?.fill ?? '#ffffff', ctx.gradients),
        letterSpacing: ts?.letterSpacing ?? 0,
      };

      if (ts?.stroke && ts.stroke !== 'none') {
        pixiStyle.stroke = {
          color: resolveColor(ts.stroke, ctx.gradients),
          width: ts.strokeWidth ?? 1,
        };
      }

      const text = new PIXI.Text({ text: n.text, style: pixiStyle });

      // Handle text anchor
      const anchor = ts?.textAnchor ?? 'start';
      switch (anchor) {
        case 'middle': text.anchor.set(0.5, 0.5); break;
        case 'end': text.anchor.set(1, 0.5); break;
        default: text.anchor.set(0, 0.5); break;
      }

      // Handle dominant baseline
      const baseline = ts?.dominantBaseline ?? 'auto';
      switch (baseline) {
        case 'middle': text.anchor.y = 0.5; break;
        case 'hanging': text.anchor.y = 0; break;
        case 'text-top': text.anchor.y = 0; break;
        default: text.anchor.y = 0.8; break; // approximate 'auto' baseline
      }

      obj = text;
      break;
    }

    case 'image': {
      const n = node as ImageNode;
      let texture: any;
      if (ctx.textureCache.has(n.href)) {
        texture = ctx.textureCache.get(n.href);
      } else {
        try {
          texture = PIXI.Texture.from(n.href);
          ctx.textureCache.set(n.href, texture);
        } catch {
          // Fallback: create a placeholder
          const g = new PIXI.Graphics();
          g.rect(-n.width / 2, -n.height / 2, n.width, n.height);
          g.fill({ color: 0x333333 });
          g.stroke({ width: 1, color: 0x666666 });
          obj = g;
          break;
        }
      }
      const sprite = new PIXI.Sprite(texture);
      sprite.width = n.width;
      sprite.height = n.height;
      sprite.anchor.set(0.5, 0.5);
      obj = sprite;
      break;
    }

    case 'group': {
      const container = new PIXI.Container();
      const n = node as GroupNode;
      for (const child of n.children) {
        const childObj = createDisplayObject(child, ctx);
        if (childObj) {
          applyTransform(childObj, child.transform);
          applyStyle(childObj, child.style);
          setupInteraction(childObj, child, ctx);
          setMeta(childObj, { nodeId: child.id, nodeType: child.type, snapshot: nodeSnapshot(child) });
          ctx.nodeMap.set(child.id, childObj);
          container.addChild(childObj);
        }
      }
      obj = container;
      break;
    }

    case 'sprite': {
      const n = node as SpriteNode;
      let texture: any;
      if (ctx.textureCache.has(n.href)) {
        texture = ctx.textureCache.get(n.href);
      } else {
        try {
          texture = PIXI.Texture.from(n.href);
          ctx.textureCache.set(n.href, texture);
        } catch {
          const g = new PIXI.Graphics();
          g.rect(0, 0, n.frameWidth, n.frameHeight);
          g.fill({ color: 0x333333 });
          obj = g;
          break;
        }
      }
      const cols = n.columns ?? Math.floor(1000 / n.frameWidth);
      const frame = n.frame ?? 0;
      const col = frame % cols;
      const row = Math.floor(frame / cols);

      // Create a sprite with a frame rectangle from the spritesheet
      try {
        const frameTexture = new PIXI.Texture({
          source: texture.source,
          frame: new PIXI.Rectangle(
            col * n.frameWidth,
            row * n.frameHeight,
            n.frameWidth,
            n.frameHeight
          ),
        });
        const sprite = new PIXI.Sprite(frameTexture);
        obj = sprite;
      } catch {
        // Fallback: render full texture
        const sprite = new PIXI.Sprite(texture);
        sprite.width = n.frameWidth;
        sprite.height = n.frameHeight;
        obj = sprite;
      }
      break;
    }

    case 'tilemap': {
      const n = node as TilemapNode;
      const container = new PIXI.Container();

      let baseTexture: any;
      if (ctx.textureCache.has(n.href)) {
        baseTexture = ctx.textureCache.get(n.href);
      } else {
        try {
          baseTexture = PIXI.Texture.from(n.href);
          ctx.textureCache.set(n.href, baseTexture);
        } catch {
          // Can't load tileset; render empty
          obj = container;
          break;
        }
      }

      for (let row = 0; row < n.height; row++) {
        for (let col = 0; col < n.width; col++) {
          const tileIdx = n.data[row]?.[col];
          if (tileIdx == null || tileIdx < 0) continue;

          const srcCol = tileIdx % n.columns;
          const srcRow = Math.floor(tileIdx / n.columns);

          try {
            const tileTexture = new PIXI.Texture({
              source: baseTexture.source,
              frame: new PIXI.Rectangle(
                srcCol * n.tileWidth,
                srcRow * n.tileHeight,
                n.tileWidth,
                n.tileHeight
              ),
            });
            const tileSprite = new PIXI.Sprite(tileTexture);
            tileSprite.position.set(col * n.tileWidth, row * n.tileHeight);
            container.addChild(tileSprite);
          } catch {
            // Skip tile if texture frame fails
          }
        }
      }

      obj = container;
      break;
    }

    case 'particles': {
      const n = node as ParticlesNode;
      const container = new PIXI.Container();
      const particles = n._particles ?? [];

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const emitter = n.emitters[0];
        const fadeOut = emitter?.fadeOut !== false;
        const alpha = fadeOut ? Math.max(0, 1 - p.age / p.lifetime) : 1;
        const shape = emitter?.shape ?? 'circle';

        const g = new PIXI.Graphics();
        if (shape === 'square') {
          g.rect(-p.size / 2, -p.size / 2, p.size, p.size);
        } else {
          g.circle(0, 0, p.size / 2);
        }
        g.fill({ color: p.color, alpha });
        g.position.set(p.x, p.y);
        container.addChild(g);
      }

      obj = container;
      break;
    }

    default:
      return null;
  }

  return obj;
}

// ─── Interaction setup ──────────────────────────────────────────────────────

function setupInteraction(obj: any, node: SceneNode, ctx: PixiRenderContext): void {
  if (!node.interactive) {
    obj.eventMode = 'auto';
    return;
  }

  obj.eventMode = 'static';
  if (node.style?.cursor) {
    obj.cursor = node.style.cursor;
  } else {
    obj.cursor = 'pointer';
  }

  // Remove existing listeners to prevent double-binding on update
  obj.removeAllListeners?.();

  if (ctx.onNodeClick) {
    obj.on('pointerdown', (e: any) => {
      const global = e.global || e.data?.global;
      if (global) {
        ctx.onNodeClick!(node.id, { x: global.x, y: global.y });
      }
    });
  }

  if (ctx.onNodeHover) {
    obj.on('pointerenter', () => ctx.onNodeHover!(node.id));
    obj.on('pointerleave', () => ctx.onNodeHover!(null));
  }

  if (ctx.onNodeDragStart || ctx.onNodeDrag || ctx.onNodeDragEnd) {
    let dragging = false;

    obj.on('pointerdown', (e: any) => {
      dragging = true;
      const global = e.global || e.data?.global;
      if (global && ctx.onNodeDragStart) {
        ctx.onNodeDragStart(node.id, { x: global.x, y: global.y });
      }
      e.stopPropagation?.();
    });

    obj.on('globalpointermove', (e: any) => {
      if (!dragging) return;
      const global = e.global || e.data?.global;
      if (global && ctx.onNodeDrag) {
        ctx.onNodeDrag(node.id, { x: global.x, y: global.y });
      }
    });

    obj.on('pointerup', (e: any) => {
      if (!dragging) return;
      dragging = false;
      const global = e.global || e.data?.global;
      if (global && ctx.onNodeDragEnd) {
        ctx.onNodeDragEnd(node.id, { x: global.x, y: global.y });
      }
    });

    obj.on('pointerupoutside', (e: any) => {
      if (!dragging) return;
      dragging = false;
      const global = e.global || e.data?.global;
      if (global && ctx.onNodeDragEnd) {
        ctx.onNodeDragEnd(node.id, { x: global.x, y: global.y });
      }
    });
  }
}

// ─── Scene Diffing ──────────────────────────────────────────────────────────

function syncNode(node: SceneNode, parent: any, ctx: PixiRenderContext): void {
  const existing = ctx.nodeMap.get(node.id);
  const snap = nodeSnapshot(node);

  if (existing) {
    const meta = getMeta(existing);

    if (meta && meta.snapshot === snap && node.type !== 'group') {
      // Node unchanged — skip
      return;
    }

    if (meta && (meta.nodeType !== node.type)) {
      // Type changed — remove and recreate
      removeDisplayObject(existing, node.id, ctx);
    } else if (node.type === 'group') {
      // For groups, update transform/style and sync children
      applyTransform(existing, node.transform);
      applyStyle(existing, node.style);
      setMeta(existing, { nodeId: node.id, nodeType: node.type, snapshot: snap });
      syncGroupChildren(node as GroupNode, existing, ctx);
      return;
    } else {
      // Same type, data changed — remove and recreate
      // (Full recreation is simpler and more reliable for Graphics objects
      //  since Pixi Graphics API is imperative and doesn't support partial updates easily)
      removeDisplayObject(existing, node.id, ctx);
    }
  }

  // Create new display object
  const obj = createDisplayObject(node, ctx);
  if (!obj) return;

  applyTransform(obj, node.transform);
  applyStyle(obj, node.style);
  setupInteraction(obj, node, ctx);
  setMeta(obj, { nodeId: node.id, nodeType: node.type, snapshot: snap });
  ctx.nodeMap.set(node.id, obj);
  parent.addChild(obj);
}

function syncGroupChildren(groupNode: GroupNode, container: any, ctx: PixiRenderContext): void {
  const childIds = new Set(groupNode.children.map(c => c.id));

  // Remove children that no longer exist
  const toRemove: string[] = [];
  for (let i = container.children.length - 1; i >= 0; i--) {
    const child = container.children[i];
    const meta = getMeta(child);
    if (meta && !childIds.has(meta.nodeId)) {
      toRemove.push(meta.nodeId);
    }
  }
  for (const id of toRemove) {
    removeDisplayObject(ctx.nodeMap.get(id), id, ctx);
  }

  // Add/update children in order
  for (let i = 0; i < groupNode.children.length; i++) {
    const childNode = groupNode.children[i];
    syncNode(childNode, container, ctx);

    // Ensure correct z-order
    const childObj = ctx.nodeMap.get(childNode.id);
    if (childObj && childObj.parent === container) {
      const currentIndex = container.getChildIndex(childObj);
      if (currentIndex !== i && i < container.children.length) {
        container.setChildIndex(childObj, Math.min(i, container.children.length - 1));
      }
    }
  }
}

function removeDisplayObject(obj: any, nodeId: string, ctx: PixiRenderContext): void {
  if (!obj) return;

  // Recursively clean up children
  if (obj.children) {
    for (let i = obj.children.length - 1; i >= 0; i--) {
      const child = obj.children[i];
      const meta = getMeta(child);
      if (meta) {
        removeDisplayObject(child, meta.nodeId, ctx);
      }
    }
  }

  obj.removeAllListeners?.();
  obj.removeFromParent?.();
  obj.destroy?.({ children: true });
  ctx.nodeMap.delete(nodeId);
}

// ─── Selection overlay ──────────────────────────────────────────────────────

function drawSelectionOverlays(ctx: PixiRenderContext, selectedIds: string[] | undefined): void {
  const layer = ctx.selectionLayer;
  if (!layer) return;

  // Clear existing selection graphics
  while (layer.children.length > 0) {
    const child = layer.children[0];
    child.removeFromParent();
    child.destroy?.();
  }

  if (!selectedIds || selectedIds.length === 0) return;

  const PIXI = ctx.PIXI;

  for (const nodeId of selectedIds) {
    const obj = ctx.nodeMap.get(nodeId);
    if (!obj) continue;

    // Get the bounds of the object in the root container's coordinate space
    try {
      const bounds = obj.getBounds();
      if (!bounds || bounds.width === 0 || bounds.height === 0) continue;

      const g = new PIXI.Graphics();
      const pad = 4;

      // Draw dashed rectangle
      // Pixi v8 Graphics doesn't have native dash support, so we simulate it
      const x = bounds.x - pad;
      const y = bounds.y - pad;
      const w = bounds.width + pad * 2;
      const hh = bounds.height + pad * 2;

      drawDashedRect(g, x, y, w, hh, 4, 2);
      g.stroke({ width: 2, color: 0x6366f1 });

      layer.addChild(g);
    } catch {
      // Bounds calculation can fail for empty containers
    }
  }
}

function drawDashedRect(g: any, x: number, y: number, w: number, h: number, dashLen: number, gapLen: number): void {
  const edges = [
    { sx: x, sy: y, ex: x + w, ey: y },         // top
    { sx: x + w, sy: y, ex: x + w, ey: y + h },  // right
    { sx: x + w, sy: y + h, ex: x, ey: y + h },  // bottom
    { sx: x, sy: y + h, ex: x, ey: y },           // left
  ];

  for (const edge of edges) {
    const dx = edge.ex - edge.sx;
    const dy = edge.ey - edge.sy;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) continue;
    const ux = dx / length;
    const uy = dy / length;

    let dist = 0;
    let drawing = true;

    while (dist < length) {
      const segLen = drawing ? dashLen : gapLen;
      const endDist = Math.min(dist + segLen, length);

      if (drawing) {
        g.moveTo(edge.sx + ux * dist, edge.sy + uy * dist);
        g.lineTo(edge.sx + ux * endDist, edge.sy + uy * endDist);
      }

      dist = endDist;
      drawing = !drawing;
    }
  }
}

// ─── Debug labels ───────────────────────────────────────────────────────────

function drawDebugLabels(ctx: PixiRenderContext, rootNode: GroupNode): void {
  const layer = ctx.debugLayer;
  if (!layer) return;

  // Clear
  while (layer.children.length > 0) {
    const child = layer.children[0];
    child.removeFromParent();
    child.destroy?.();
  }

  const PIXI = ctx.PIXI;

  function addLabel(node: SceneNode): void {
    const obj = ctx.nodeMap.get(node.id);
    if (!obj) return;

    try {
      const bounds = obj.getBounds();
      const label = new PIXI.Text({
        text: node.id,
        style: {
          fontSize: 10,
          fill: '#94a3b8',
          fontFamily: 'monospace',
        },
      });
      label.anchor.set(0.5, 1);
      label.position.set(
        bounds.x + bounds.width / 2,
        bounds.y - 4,
      );
      layer.addChild(label);
    } catch {
      // Skip if bounds fail
    }

    if (node.type === 'group') {
      for (const child of (node as GroupNode).children) {
        addLabel(child);
      }
    }
  }

  for (const child of rootNode.children) {
    addLabel(child);
  }
}

// ─── Tween Application ─────────────────────────────────────────────────────

function applyTweens(rootNode: GroupNode, ctx: PixiRenderContext, now: number): void {
  function processTween(node: SceneNode): void {
    if (!node.tween || !node.tween.startedAt) {
      if (node.type === 'group') {
        for (const child of (node as GroupNode).children) {
          processTween(child);
        }
      }
      return;
    }

    const value = interpolateTween(node.tween, now);
    if (value === null) {
      if (node.type === 'group') {
        for (const child of (node as GroupNode).children) {
          processTween(child);
        }
      }
      return;
    }

    const obj = ctx.nodeMap.get(node.id);
    if (!obj) return;

    const prop = node.tween.property;

    // Apply tween value to the Pixi display object
    if (prop === 'transform.x') {
      obj.position.x = value;
    } else if (prop === 'transform.y') {
      obj.position.y = value;
    } else if (prop === 'transform.rotation') {
      obj.rotation = (value * Math.PI) / 180;
    } else if (prop === 'transform.scaleX') {
      obj.scale.x = value;
    } else if (prop === 'transform.scaleY') {
      obj.scale.y = value;
    } else if (prop === 'style.opacity') {
      obj.alpha = value;
    }
    // Other properties would require recreating the Graphics object,
    // which is expensive; for now we handle the most common cases

    if (node.type === 'group') {
      for (const child of (node as GroupNode).children) {
        processTween(child);
      }
    }
  }

  for (const child of rootNode.children) {
    processTween(child);
  }
}

// ─── Particle Simulation ────────────────────────────────────────────────────

function tickParticlesInternal(node: ParticlesNode, dt: number): Particle[] {
  const particles = [...(node._particles ?? [])];
  const maxParticles = node.maxParticles ?? 200;

  // Update existing particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.lifetime) {
      particles.splice(i, 1);
      continue;
    }
    const gravity = node.emitters[0]?.gravity ?? 0;
    p.vy += gravity * (dt / 1000);
    p.x += p.vx * (dt / 1000);
    p.y += p.vy * (dt / 1000);
  }

  // Spawn new particles
  for (const emitter of node.emitters) {
    const count = Math.floor(emitter.rate * (dt / 1000));
    for (let i = 0; i < count && particles.length < maxParticles; i++) {
      const angle = emitter.direction.min + Math.random() * (emitter.direction.max - emitter.direction.min);
      const speed = emitter.speed.min + Math.random() * (emitter.speed.max - emitter.speed.min);
      const rad = (angle * Math.PI) / 180;

      const colors = emitter.color
        ? (Array.isArray(emitter.color) ? emitter.color : [emitter.color])
        : ['#ffffff'];

      const size = emitter.size
        ? emitter.size.min + Math.random() * (emitter.size.max - emitter.size.min)
        : 4;

      particles.push({
        x: emitter.x,
        y: emitter.y,
        vx: Math.cos(rad) * speed,
        vy: Math.sin(rad) * speed,
        age: 0,
        lifetime: emitter.lifetime,
        size,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  return particles;
}

// ─── Main PixiJS Renderer Component ─────────────────────────────────────────

export function PixiSceneRenderer(props: SceneRendererProps) {
  const React = getReact();
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

  const containerRef = React.useRef(null) as { current: HTMLDivElement | null };
  const appRef = React.useRef(null) as { current: any };
  const ctxRef = React.useRef(null) as { current: PixiRenderContext | null };
  const sceneRef = React.useRef(scene) as { current: SceneGraph };
  const propsRef = React.useRef(props) as { current: SceneRendererProps };
  const initializingRef = React.useRef(false) as { current: boolean };
  const initializedRef = React.useRef(false) as { current: boolean };
  const pixiAvailableRef = React.useRef(null) as { current: boolean | null };
  const [, forceUpdate] = React.useState(0);

  // Keep refs current
  sceneRef.current = scene;
  propsRef.current = props;

  // ─── Initialize PixiJS Application ──────────────────────────────────────

  React.useEffect(() => {
    if (initializingRef.current || initializedRef.current) return;
    initializingRef.current = true;

    let cancelled = false;

    (async () => {
      const PIXI = await loadPixi();
      if (cancelled) return;

      if (!PIXI) {
        pixiAvailableRef.current = false;
        initializingRef.current = false;
        forceUpdate((n: number) => n + 1);
        return;
      }

      pixiAvailableRef.current = true;

      const container = containerRef.current;
      if (!container || cancelled) {
        initializingRef.current = false;
        return;
      }

      const app = new PIXI.Application();

      try {
        await app.init({
          width,
          height,
          background: scene.background ?? '#1a1a2e',
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
        });
      } catch (err) {
        // WebGL not available or init failed
        pixiAvailableRef.current = false;
        initializingRef.current = false;
        forceUpdate((n: number) => n + 1);
        return;
      }

      if (cancelled) {
        app.destroy(true);
        return;
      }

      // Append the canvas
      const canvas = app.canvas;
      if (canvas) {
        canvas.style.display = 'block';
        container.appendChild(canvas);
      }

      // Create layer containers
      const rootContainer = new PIXI.Container();
      const selectionLayer = new PIXI.Container();
      const debugLayer = new PIXI.Container();

      app.stage.addChild(rootContainer);
      app.stage.addChild(selectionLayer);
      app.stage.addChild(debugLayer);

      // Make stage interactive for viewport events
      app.stage.eventMode = 'static';
      app.stage.hitArea = new PIXI.Rectangle(0, 0, width, height);

      const ctx: PixiRenderContext = {
        PIXI,
        app,
        gradients: scene.gradients,
        onNodeClick,
        onNodeHover,
        onNodeDragStart,
        onNodeDrag,
        onNodeDragEnd,
        selectedNodeIds,
        debug,
        nodeMap: new Map(),
        textureCache: new Map(),
        selectionLayer,
        debugLayer,
      };

      appRef.current = app;
      ctxRef.current = ctx;

      // Perform initial scene sync
      syncScene(sceneRef.current, rootContainer, ctx, PIXI, width, height);

      // Viewport interaction: wheel zoom and background pan
      setupViewportInteraction(app, canvas, PIXI, width, height);

      // Ticker for tweens and particles
      app.ticker.add((ticker: any) => {
        const dt = ticker.deltaMS ?? (ticker.deltaTime * (1000 / 60));
        const now = performance.now();
        const currentScene = sceneRef.current;
        const currentCtx = ctxRef.current;

        if (!currentCtx) return;

        // Tween interpolation
        applyTweens(currentScene.root, currentCtx, now);

        // Particle simulation
        tickAllParticles(currentScene.root, currentCtx, dt);
      });

      initializedRef.current = true;
      initializingRef.current = false;
      forceUpdate((n: number) => n + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, []); // Mount only

  // ─── Setup viewport interaction (pan / zoom) ────────────────────────────

  const viewportStateRef = React.useRef({
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
  });

  function setupViewportInteraction(app: any, canvas: any, PIXI: any, w: number, h: number): void {
    if (!canvas) return;

    // Mouse wheel zoom
    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const currentProps = propsRef.current;
      if (!currentProps.onViewportZoom) return;

      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const currentScene = sceneRef.current;
      const camera = currentScene.camera ?? { x: w / 2, y: h / 2, zoom: 1 };
      const zoom = camera.zoom || 1;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;

      // Convert screen position to world position
      const worldX = camera.x + (cx - w / 2) / zoom;
      const worldY = camera.y + (cy - h / 2) / zoom;

      currentProps.onViewportZoom(zoom * factor, { x: worldX, y: worldY });
    }, { passive: false });

    // Pan on background drag
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      const currentProps = propsRef.current;

      // Check if we clicked on the background (not on an interactive node)
      // By checking if the event target is the canvas itself
      if (currentProps.onViewportPan) {
        viewportStateRef.current.isPanning = true;
        viewportStateRef.current.panStartX = e.clientX;
        viewportStateRef.current.panStartY = e.clientY;
      }

      // Viewport click
      if (currentProps.onViewportClick) {
        const rect = canvas.getBoundingClientRect();
        const currentScene = sceneRef.current;
        const camera = currentScene.camera ?? { x: w / 2, y: h / 2, zoom: 1 };
        const zoom = camera.zoom || 1;

        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const worldX = camera.x + (cx - w / 2) / zoom;
        const worldY = camera.y + (cy - h / 2) / zoom;

        currentProps.onViewportClick({ x: worldX, y: worldY });
      }
    });

    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (!viewportStateRef.current.isPanning) return;
      const currentProps = propsRef.current;
      if (!currentProps.onViewportPan) return;

      const currentScene = sceneRef.current;
      const camera = currentScene.camera ?? { x: w / 2, y: h / 2, zoom: 1 };
      const zoom = camera.zoom || 1;

      const dx = (e.clientX - viewportStateRef.current.panStartX) / zoom;
      const dy = (e.clientY - viewportStateRef.current.panStartY) / zoom;

      viewportStateRef.current.panStartX = e.clientX;
      viewportStateRef.current.panStartY = e.clientY;

      currentProps.onViewportPan({ x: -dx, y: -dy });
    });

    canvas.addEventListener('pointerup', () => {
      viewportStateRef.current.isPanning = false;
    });

    canvas.addEventListener('pointerleave', () => {
      viewportStateRef.current.isPanning = false;
    });
  }

  // ─── Scene synchronization ─────────────────────────────────────────────

  function syncScene(scene: SceneGraph, rootContainer: any, ctx: PixiRenderContext, PIXI: any, w: number, h: number): void {
    // Update context references
    ctx.gradients = scene.gradients;
    ctx.onNodeClick = propsRef.current.onNodeClick;
    ctx.onNodeHover = propsRef.current.onNodeHover;
    ctx.onNodeDragStart = propsRef.current.onNodeDragStart;
    ctx.onNodeDrag = propsRef.current.onNodeDrag;
    ctx.onNodeDragEnd = propsRef.current.onNodeDragEnd;
    ctx.selectedNodeIds = propsRef.current.selectedNodeIds;
    ctx.debug = propsRef.current.debug;

    // Apply camera
    const camera = scene.camera ?? { x: w / 2, y: h / 2, zoom: 1 };
    const zoom = camera.zoom || 1;

    rootContainer.position.set(
      w / 2 - camera.x * zoom,
      h / 2 - camera.y * zoom,
    );
    rootContainer.scale.set(zoom, zoom);

    if (camera.rotation) {
      rootContainer.rotation = (camera.rotation * Math.PI) / 180;
      // Rotate around the center
      rootContainer.pivot.set(camera.x, camera.y);
      rootContainer.position.set(w / 2, h / 2);
    }

    // Sync the root group
    syncGroupChildren(scene.root, rootContainer, ctx);

    // Selection overlays
    drawSelectionOverlays(ctx, propsRef.current.selectedNodeIds);

    // Debug labels
    if (propsRef.current.debug) {
      drawDebugLabels(ctx, scene.root);
    } else if (ctx.debugLayer) {
      while (ctx.debugLayer.children.length > 0) {
        const child = ctx.debugLayer.children[0];
        child.removeFromParent();
        child.destroy?.();
      }
    }
  }

  // ─── Tick particle nodes recursively ───────────────────────────────────

  function tickAllParticles(rootNode: GroupNode, ctx: PixiRenderContext, dt: number): void {
    function processNode(node: SceneNode): void {
      if (node.type === 'particles') {
        const pNode = node as ParticlesNode;
        const particles = tickParticlesInternal(pNode, dt);
        pNode._particles = particles;

        // Re-render particle container
        const obj = ctx.nodeMap.get(node.id);
        if (obj) {
          // Clear and redraw particles
          while (obj.children?.length > 0) {
            const child = obj.children[0];
            child.removeFromParent();
            child.destroy?.();
          }

          const PIXI = ctx.PIXI;
          for (const p of particles) {
            const emitter = pNode.emitters[0];
            const fadeOut = emitter?.fadeOut !== false;
            const alpha = fadeOut ? Math.max(0, 1 - p.age / p.lifetime) : 1;
            const shape = emitter?.shape ?? 'circle';

            const g = new PIXI.Graphics();
            if (shape === 'square') {
              g.rect(-p.size / 2, -p.size / 2, p.size, p.size);
            } else {
              g.circle(0, 0, p.size / 2);
            }
            g.fill({ color: p.color, alpha });
            g.position.set(p.x, p.y);
            obj.addChild(g);
          }
        }
      }

      if (node.type === 'group') {
        for (const child of (node as GroupNode).children) {
          processNode(child);
        }
      }
    }

    for (const child of rootNode.children) {
      processNode(child);
    }
  }

  // ─── React effect: sync on scene/props change ─────────────────────────

  React.useEffect(() => {
    if (!initializedRef.current || !appRef.current || !ctxRef.current) return;

    const app = appRef.current;
    const ctx = ctxRef.current;
    const PIXI = ctx.PIXI;
    const rootContainer = app.stage.children[0]; // First child is root container

    if (!rootContainer) return;

    syncScene(scene, rootContainer, ctx, PIXI, width, height);
  }, [scene, width, height, selectedNodeIds, debug, onNodeClick, onNodeHover, onNodeDragStart, onNodeDrag, onNodeDragEnd]);

  // ─── React effect: resize ──────────────────────────────────────────────

  React.useEffect(() => {
    if (!appRef.current) return;
    const app = appRef.current;

    try {
      app.renderer.resize(width, height);

      // Update stage hit area
      const PIXI = ctxRef.current?.PIXI;
      if (PIXI) {
        app.stage.hitArea = new PIXI.Rectangle(0, 0, width, height);
      }
    } catch {
      // Resize can fail if renderer is destroyed
    }
  }, [width, height]);

  // ─── React effect: background color ────────────────────────────────────

  React.useEffect(() => {
    if (!appRef.current) return;
    try {
      appRef.current.renderer.background.color = scene.background ?? '#1a1a2e';
    } catch {
      // May fail if renderer is not ready
    }
  }, [scene.background]);

  // ─── Cleanup on unmount ────────────────────────────────────────────────

  React.useEffect(() => {
    return () => {
      const app = appRef.current;
      if (app) {
        try {
          app.destroy(true, { children: true, texture: false, baseTexture: false });
        } catch {
          // Swallow destruction errors
        }
        appRef.current = null;
      }

      const ctx = ctxRef.current;
      if (ctx) {
        ctx.nodeMap.clear();
        ctx.textureCache.clear();
        ctxRef.current = null;
      }

      initializedRef.current = false;
      initializingRef.current = false;
    };
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────

  // If pixi is known to be unavailable, render fallback
  if (pixiAvailableRef.current === false) {
    return h('div', {
      className,
      style: {
        width,
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: scene.background ?? '#1a1a2e',
        color: '#94a3b8',
        fontFamily: 'monospace',
        fontSize: 14,
        textAlign: 'center',
        padding: 20,
        boxSizing: 'border-box',
        ...containerStyle,
      },
    },
      h('div', null,
        h('div', { style: { marginBottom: 8, fontSize: 16, fontWeight: 'bold', color: '#e2e8f0' } },
          'WebGL Renderer Unavailable'
        ),
        h('div', null,
          'Install pixi.js to enable the WebGL renderer:'
        ),
        h('code', { style: { display: 'block', marginTop: 8, padding: '8px 12px', backgroundColor: '#0f172a', borderRadius: 4 } },
          'npm install pixi.js'
        ),
      ),
    );
  }

  // Container div — Pixi will append its canvas here
  return h('div', {
    ref: containerRef,
    className,
    style: {
      width,
      height,
      overflow: 'hidden',
      position: 'relative',
      backgroundColor: scene.background ?? '#1a1a2e',
      ...containerStyle,
    },
  });
}

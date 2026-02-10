/**
 * Scene Graph Type Definitions
 *
 * The scene graph is a serializable JSON structure that lives in sharedState._scene.
 * Both humans (via Canvas UI) and agents (via MCP tools) read and write this structure.
 * The renderer reads it and produces SVG output.
 *
 * Every type here MUST be JSON-serializable (no functions, no class instances, no circular refs).
 */

// ─── Primitives ──────────────────────────────────────────────────────────────

export type Vec2 = { x: number; y: number };

export type Transform = {
  x?: number;        // Translation X (default 0)
  y?: number;        // Translation Y (default 0)
  rotation?: number; // Degrees (default 0)
  scaleX?: number;   // Scale X (default 1)
  scaleY?: number;   // Scale Y (default 1)
  originX?: number;  // Transform origin X, 0-1 (default 0.5)
  originY?: number;  // Transform origin Y, 0-1 (default 0.5)
};

// ─── Gradients ───────────────────────────────────────────────────────────────

export type GradientStop = {
  offset: number; // 0 to 1
  color: string;  // CSS color
};

export type LinearGradient = {
  type: 'linear';
  id: string;
  x1: number; y1: number;
  x2: number; y2: number;
  stops: GradientStop[];
};

export type RadialGradient = {
  type: 'radial';
  id: string;
  cx: number; cy: number;
  r: number;
  fx?: number; fy?: number;
  stops: GradientStop[];
};

export type Gradient = LinearGradient | RadialGradient;

// ─── Filters ─────────────────────────────────────────────────────────────────

export type FilterType = 'blur' | 'shadow' | 'glow' | 'brightness' | 'contrast' | 'saturate' | 'hue-rotate';

export type FilterDef = {
  id: string;
  type: FilterType;
  params: Record<string, number | string>;
};

// ─── Style ───────────────────────────────────────────────────────────────────

export type Style = {
  fill?: string;             // CSS color or gradient ref 'url(#gradientId)'
  stroke?: string;           // CSS color
  strokeWidth?: number;      // Default 1
  strokeDasharray?: string;  // e.g. "5,3"
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  opacity?: number;          // 0-1
  fillOpacity?: number;      // 0-1
  strokeOpacity?: number;    // 0-1
  filter?: string;           // Filter ref 'url(#filterId)' or inline CSS filter
  cursor?: string;           // CSS cursor
  pointerEvents?: 'auto' | 'none';
  visible?: boolean;         // Default true
};

export type TextStyle = Style & {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number | string;
  textAnchor?: 'start' | 'middle' | 'end';
  dominantBaseline?: 'auto' | 'middle' | 'hanging' | 'text-top';
  letterSpacing?: number;
};

// ─── Scene Node Base ─────────────────────────────────────────────────────────

export type SceneNodeBase = {
  id: string;
  name?: string;              // Human-readable label
  transform?: Transform;
  style?: Style;
  interactive?: boolean;      // If true, node emits hit events (default false)
  data?: Record<string, any>; // Arbitrary metadata (useful for agents)
  tween?: TweenDef;           // Active tween animation
};

// ─── Shape Nodes ─────────────────────────────────────────────────────────────

export type RectNode = SceneNodeBase & {
  type: 'rect';
  width: number;
  height: number;
  rx?: number; // Corner radius X
  ry?: number; // Corner radius Y
};

export type CircleNode = SceneNodeBase & {
  type: 'circle';
  radius: number;
};

export type EllipseNode = SceneNodeBase & {
  type: 'ellipse';
  rx: number;
  ry: number;
};

export type LineNode = SceneNodeBase & {
  type: 'line';
  x2: number;
  y2: number;
};

export type PolylineNode = SceneNodeBase & {
  type: 'polyline';
  points: Vec2[];
};

export type PolygonNode = SceneNodeBase & {
  type: 'polygon';
  points: Vec2[];
};

export type PathNode = SceneNodeBase & {
  type: 'path';
  d: string; // SVG path data string
};

export type TextNode = SceneNodeBase & {
  type: 'text';
  text: string;
  style?: TextStyle;
};

export type ImageNode = SceneNodeBase & {
  type: 'image';
  href: string;   // URL or data URI
  width: number;
  height: number;
  preserveAspectRatio?: string;
};

export type GroupNode = SceneNodeBase & {
  type: 'group';
  children: SceneNode[];
  clipPath?: string; // SVG clip path data
};

// ─── Higher-Level Primitives ─────────────────────────────────────────────────

export type SpriteAnimation = {
  frames: number[];  // Frame indices to cycle through
  fps: number;       // Frames per second
  loop?: boolean;    // Default true
  playing?: boolean; // Default true
};

export type SpriteNode = SceneNodeBase & {
  type: 'sprite';
  href: string;          // Spritesheet URL
  frameWidth: number;    // Width of a single frame
  frameHeight: number;   // Height of a single frame
  frame: number;         // Current frame index
  columns?: number;      // Columns in the spritesheet (default: auto from image width)
  animation?: SpriteAnimation;
};

export type TilemapNode = SceneNodeBase & {
  type: 'tilemap';
  href: string;        // Tileset image URL
  tileWidth: number;
  tileHeight: number;
  columns: number;     // Columns in the tileset image
  data: number[][];    // 2D grid of tile indices (-1 = empty)
  width: number;       // Grid width in tiles
  height: number;      // Grid height in tiles
};

export type ParticleEmitter = {
  x: number;
  y: number;
  rate: number;            // Particles per second
  lifetime: number;        // Particle lifetime in ms
  speed: { min: number; max: number };
  direction: { min: number; max: number }; // Angle in degrees
  gravity?: number;        // Downward acceleration (pixels/s^2)
  color?: string | string[];  // Single color or array to pick from
  size?: { min: number; max: number };
  fadeOut?: boolean;       // Default true
  shape?: 'circle' | 'square'; // Default 'circle'
};

export type Particle = {
  x: number; y: number;
  vx: number; vy: number;
  age: number; lifetime: number;
  size: number; color: string;
};

export type ParticlesNode = SceneNodeBase & {
  type: 'particles';
  emitters: ParticleEmitter[];
  maxParticles?: number;   // Default 200
  _particles?: Particle[]; // Runtime state (client-side only)
};

// ─── Scene Node Union ────────────────────────────────────────────────────────

export type SceneNode =
  | RectNode
  | CircleNode
  | EllipseNode
  | LineNode
  | PolylineNode
  | PolygonNode
  | PathNode
  | TextNode
  | ImageNode
  | GroupNode
  | SpriteNode
  | TilemapNode
  | ParticlesNode;

export type SceneNodeType = SceneNode['type'];

// ─── Tweens ──────────────────────────────────────────────────────────────────

export type EasingType =
  | 'linear'
  | 'ease-in' | 'ease-out' | 'ease-in-out'
  | 'ease-in-quad' | 'ease-out-quad' | 'ease-in-out-quad'
  | 'ease-in-cubic' | 'ease-out-cubic' | 'ease-in-out-cubic'
  | 'ease-in-elastic' | 'ease-out-elastic'
  | 'ease-in-bounce' | 'ease-out-bounce';

export type TweenDef = {
  property: string;    // Dot-path: 'transform.x', 'style.opacity', etc.
  from: number;
  to: number;
  duration: number;    // Milliseconds
  easing?: EasingType; // Default 'ease-in-out'
  delay?: number;      // Ms before start
  repeat?: number;     // -1 = infinite, 0 = play once (default)
  yoyo?: boolean;      // Reverse on repeat
  startedAt?: number;  // Timestamp when tween started (set by tool/runtime)
};

// ─── Camera ──────────────────────────────────────────────────────────────────

export type Camera = {
  x: number;           // Camera center X
  y: number;           // Camera center Y
  zoom: number;        // 1 = 100%, 2 = 200%, 0.5 = 50%
  rotation?: number;   // Degrees
  bounds?: {           // Optional camera bounds
    minX: number; minY: number;
    maxX: number; maxY: number;
  };
};

// ─── Scene Graph ─────────────────────────────────────────────────────────────

export type SceneGraph = {
  _sceneVersion?: number;
  root: GroupNode;
  camera?: Camera;
  background?: string;     // CSS color
  gradients?: Gradient[];
  filters?: FilterDef[];
  width?: number;          // Default 800
  height?: number;         // Default 600
};

// ─── Renderer Props ──────────────────────────────────────────────────────────

export type SceneRendererProps = {
  scene: SceneGraph;
  width?: number;  // Container width (default 800)
  height?: number; // Container height (default 600)
  className?: string;
  style?: Record<string, any>;
  onNodeClick?: (nodeId: string, event: { x: number; y: number }) => void;
  onNodeHover?: (nodeId: string | null) => void;
  onNodeDragStart?: (nodeId: string, pos: Vec2) => void;
  onNodeDrag?: (nodeId: string, pos: Vec2) => void;
  onNodeDragEnd?: (nodeId: string, pos: Vec2) => void;
  onViewportClick?: (pos: Vec2) => void;
  onViewportPan?: (delta: Vec2) => void;
  onViewportZoom?: (zoom: number, center: Vec2) => void;
  selectedNodeIds?: string[];
  debug?: boolean;
};

// ─── Scene Interaction Events ────────────────────────────────────────────────

export type SceneHitEvent = {
  nodeId: string;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
};

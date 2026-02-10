/**
 * Zod schemas for scene graph validation.
 *
 * These schemas are used by scene tools to validate agent input.
 * They accept `z` as a parameter (same pattern as agent-protocol.ts)
 * so we don't import zod directly — it's provided by the experience.
 */

export function createSceneSchemas(z: any) {
  const vec2 = z.object({
    x: z.number(),
    y: z.number(),
  });

  const transform = z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    rotation: z.number().optional().describe('Rotation in degrees'),
    scaleX: z.number().optional(),
    scaleY: z.number().optional(),
    originX: z.number().optional().describe('Transform origin X (0-1)'),
    originY: z.number().optional().describe('Transform origin Y (0-1)'),
  }).optional();

  const style = z.object({
    fill: z.string().optional().describe('CSS color or gradient ref url(#id)'),
    stroke: z.string().optional().describe('CSS color'),
    strokeWidth: z.number().optional(),
    strokeDasharray: z.string().optional().describe('e.g. "5,3"'),
    strokeLinecap: z.enum(['butt', 'round', 'square']).optional(),
    strokeLinejoin: z.enum(['miter', 'round', 'bevel']).optional(),
    opacity: z.number().optional().describe('0-1'),
    fillOpacity: z.number().optional(),
    strokeOpacity: z.number().optional(),
    filter: z.string().optional(),
    cursor: z.string().optional(),
    pointerEvents: z.enum(['auto', 'none']).optional(),
    visible: z.boolean().optional(),
  }).optional();

  const textStyle = z.object({
    fill: z.string().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().optional(),
    opacity: z.number().optional(),
    fontSize: z.number().optional(),
    fontFamily: z.string().optional(),
    fontWeight: z.union([z.number(), z.string()]).optional(),
    textAnchor: z.enum(['start', 'middle', 'end']).optional(),
    dominantBaseline: z.enum(['auto', 'middle', 'hanging', 'text-top']).optional(),
    letterSpacing: z.number().optional(),
  }).optional();

  const gradientStop = z.object({
    offset: z.number().describe('0 to 1'),
    color: z.string(),
  });

  const linearGradient = z.object({
    type: z.literal('linear'),
    id: z.string(),
    x1: z.number(), y1: z.number(),
    x2: z.number(), y2: z.number(),
    stops: z.array(gradientStop),
  });

  const radialGradient = z.object({
    type: z.literal('radial'),
    id: z.string(),
    cx: z.number(), cy: z.number(),
    r: z.number(),
    fx: z.number().optional(), fy: z.number().optional(),
    stops: z.array(gradientStop),
  });

  const gradient = z.union([linearGradient, radialGradient]);

  const particleEmitter = z.object({
    x: z.number(),
    y: z.number(),
    rate: z.number().describe('Particles per second'),
    lifetime: z.number().describe('Particle lifetime in ms'),
    speed: z.object({ min: z.number(), max: z.number() }),
    direction: z.object({ min: z.number(), max: z.number() }).describe('Angle range in degrees'),
    gravity: z.number().optional(),
    color: z.union([z.string(), z.array(z.string())]).optional(),
    size: z.object({ min: z.number(), max: z.number() }).optional(),
    fadeOut: z.boolean().optional(),
    shape: z.enum(['circle', 'square']).optional(),
  });

  const spriteAnimation = z.object({
    frames: z.array(z.number()),
    fps: z.number(),
    loop: z.boolean().optional(),
    playing: z.boolean().optional(),
  });

  // Node schema — flexible record that accepts any node type's properties
  const nodeSchema = z.object({
    type: z.enum([
      'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
      'path', 'text', 'image', 'group', 'sprite', 'tilemap', 'particles',
    ]),
    id: z.string().optional().describe('Auto-generated if not provided'),
    name: z.string().optional(),
    transform: transform,
    style: style,
    interactive: z.boolean().optional(),
    data: z.record(z.any()).optional(),

    // rect
    width: z.number().optional(),
    height: z.number().optional(),
    rx: z.number().optional(),
    ry: z.number().optional(),

    // circle
    radius: z.number().optional(),

    // line
    x2: z.number().optional(),
    y2: z.number().optional(),

    // polyline, polygon
    points: z.array(vec2).optional(),

    // path
    d: z.string().optional(),

    // text
    text: z.string().optional(),

    // image
    href: z.string().optional(),
    preserveAspectRatio: z.string().optional(),

    // group
    children: z.array(z.any()).optional(),
    clipPath: z.string().optional(),

    // sprite
    frameWidth: z.number().optional(),
    frameHeight: z.number().optional(),
    frame: z.number().optional(),
    columns: z.number().optional(),
    animation: spriteAnimation.optional(),

    // tilemap
    tileWidth: z.number().optional(),
    tileHeight: z.number().optional(),
    // columns already defined above

    // particles
    emitters: z.array(particleEmitter).optional(),
    maxParticles: z.number().optional(),
  }).passthrough();

  return {
    vec2,
    transform,
    style,
    textStyle,
    gradientStop,
    linearGradient,
    radialGradient,
    gradient,
    particleEmitter,
    spriteAnimation,
    nodeSchema,
  };
}

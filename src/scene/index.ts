// Types
export type {
  Vec2, Transform, GradientStop, LinearGradient, RadialGradient, Gradient,
  FilterType, FilterDef, Style, TextStyle,
  SceneNodeBase, RectNode, CircleNode, EllipseNode, LineNode,
  PolylineNode, PolygonNode, PathNode, TextNode, ImageNode, GroupNode,
  SpriteAnimation, SpriteNode, TilemapNode, ParticleEmitter, Particle, ParticlesNode,
  SceneNode, SceneNodeType,
  EasingType, TweenDef, Camera, SceneGraph,
  SceneRendererProps, SceneHitEvent,
} from './types';

// Renderer
export { SceneRenderer } from './renderer';
export { SvgSceneRenderer } from './renderer-svg';
export { PixiSceneRenderer } from './renderer-pixi';

// Tools
export { createSceneTools } from './tools';

// Hooks
export {
  useSceneInteraction,
  useSceneDrag,
  useSceneSelection,
  useSceneViewport,
  useSceneTweens,
  useParticleTick,
} from './hooks';
export type {
  SceneInteractionEvent,
  UseSceneInteractionReturn,
  UseSceneDragReturn,
  UseSceneSelectionReturn,
  UseSceneViewportReturn,
} from './hooks';

// Helpers
export {
  createScene,
  createNode,
  nodeById,
  findNodes,
  walkNodes,
  allNodeIds,
  nodeCount,
  cloneScene,
  removeNodeById,
  findParent,
  sceneTools,
} from './helpers';

// Path Builder
export { PathBuilder } from './path-builder';

// Tweens
export { easingFunctions, interpolateTween, getPath, setPath } from './tweens';

// Particles
export { spawnParticles, tickParticles, tickParticleNode } from './particles';

// Schemas
export { createSceneSchemas } from './schema';

// Rules
export type { Rule, WorldMeta, RuleStats } from './rules';
export {
  useRuleTick,
  nodeMatchesSelector,
  createRuleTools,
  ruleTools,
} from './rules';

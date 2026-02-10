/**
 * Unified SceneRenderer component.
 * Defaults to PixiJS (WebGL) renderer. Falls back to SVG if pixi.js is not available.
 */

import type { SceneRendererProps } from './types';
import { SvgSceneRenderer } from './renderer-svg';
import { PixiSceneRenderer } from './renderer-pixi';

function getReact(): any {
  const R = (globalThis as any).React;
  if (!R) throw new Error('React is not available.');
  return R;
}

/** Check if PixiJS is available at runtime. */
let pixiAvailable: boolean | null = null;
function isPixiAvailable(): boolean {
  if (pixiAvailable !== null) return pixiAvailable;
  try {
    const PIXI = (globalThis as any).__PIXI ?? (globalThis as any).PIXI;
    pixiAvailable = !!(PIXI && PIXI.Application);
  } catch {
    pixiAvailable = false;
  }
  return pixiAvailable;
}

/**
 * Auto-selecting SceneRenderer.
 * Uses PixiJS (WebGL) when available, falls back to SVG.
 * Experience authors can also import PixiSceneRenderer or SvgSceneRenderer directly.
 */
export function SceneRenderer(props: SceneRendererProps) {
  if (isPixiAvailable()) {
    return PixiSceneRenderer(props);
  }
  return SvgSceneRenderer(props);
}

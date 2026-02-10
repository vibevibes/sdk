/**
 * Unified SceneRenderer component.
 * Currently wraps the SVG renderer. Canvas2D can be added later.
 */

import type { SceneRendererProps } from './types';
import { SvgSceneRenderer } from './renderer-svg';

export function SceneRenderer(props: SceneRendererProps) {
  return SvgSceneRenderer(props);
}

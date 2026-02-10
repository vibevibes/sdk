/**
 * Easing functions and tween interpolation logic.
 *
 * All easing functions take t (0-1) and return a value (0-1).
 * Used by the renderer for client-side animation interpolation.
 */

import type { EasingType } from './types';

export type EasingFn = (t: number) => number;

export const easingFunctions: Record<EasingType, EasingFn> = {
  'linear': (t) => t,

  'ease-in': (t) => t * t * t,
  'ease-out': (t) => 1 - Math.pow(1 - t, 3),
  'ease-in-out': (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  'ease-in-quad': (t) => t * t,
  'ease-out-quad': (t) => 1 - (1 - t) * (1 - t),
  'ease-in-out-quad': (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,

  'ease-in-cubic': (t) => t * t * t,
  'ease-out-cubic': (t) => 1 - Math.pow(1 - t, 3),
  'ease-in-out-cubic': (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  'ease-in-elastic': (t) => {
    if (t === 0 || t === 1) return t;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * (2 * Math.PI / 3));
  },
  'ease-out-elastic': (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
  },

  'ease-in-bounce': (t) => 1 - bounceOut(1 - t),
  'ease-out-bounce': bounceOut,
};

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/**
 * Get the value at a given dot-path on an object.
 * e.g. getPath({ transform: { x: 10 } }, 'transform.x') => 10
 */
export function getPath(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Set a value at a given dot-path on an object (immutable - returns new object).
 * e.g. setPath({ transform: { x: 10 } }, 'transform.x', 20) => { transform: { x: 20 } }
 */
export function setPath(obj: any, path: string, value: any): any {
  const parts = path.split('.');
  if (parts.length === 1) {
    return { ...obj, [parts[0]]: value };
  }
  const [head, ...rest] = parts;
  return {
    ...obj,
    [head]: setPath(obj?.[head] ?? {}, rest.join('.'), value),
  };
}

/**
 * Compute the interpolated value for a tween at a given timestamp.
 * Returns null if the tween hasn't started yet or has completed (non-repeating).
 */
export function interpolateTween(
  tween: { from: number; to: number; duration: number; easing?: EasingType; delay?: number; repeat?: number; yoyo?: boolean; startedAt?: number },
  now: number,
): number | null {
  if (tween.startedAt == null) return null;

  const delay = tween.delay ?? 0;
  const elapsed = now - tween.startedAt - delay;
  if (elapsed < 0) return tween.from; // Still in delay

  const repeat = tween.repeat ?? 0;
  const duration = tween.duration;
  if (duration <= 0) return tween.to;

  let iteration = Math.floor(elapsed / duration);
  let progress = (elapsed % duration) / duration;

  // Handle completion
  if (repeat >= 0 && iteration > repeat) {
    // Tween completed
    if (tween.yoyo && repeat % 2 === 0) return tween.from;
    return tween.to;
  }

  // Handle yoyo
  if (tween.yoyo && iteration % 2 === 1) {
    progress = 1 - progress;
  }

  const easingName = tween.easing ?? 'ease-in-out';
  const easeFn = easingFunctions[easingName] ?? easingFunctions['linear'];
  const t = easeFn(Math.max(0, Math.min(1, progress)));

  return tween.from + (tween.to - tween.from) * t;
}

/**
 * Particle system tick logic.
 *
 * Pure functions for simulating particles. Used by useParticleTick hook
 * for client-side particle simulation at 60fps.
 */

import type { ParticleEmitter, Particle, ParticlesNode } from './types';

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Spawn new particles from an emitter based on elapsed time.
 */
export function spawnParticles(emitter: ParticleEmitter, dt: number): Particle[] {
  const count = Math.floor(emitter.rate * (dt / 1000));
  const particles: Particle[] = [];

  for (let i = 0; i < count; i++) {
    const angle = degToRad(rand(emitter.direction.min, emitter.direction.max));
    const speed = rand(emitter.speed.min, emitter.speed.max);
    const size = emitter.size ? rand(emitter.size.min, emitter.size.max) : 4;
    const colors = Array.isArray(emitter.color) ? emitter.color : [emitter.color ?? '#ffffff'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    particles.push({
      x: emitter.x,
      y: emitter.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      lifetime: emitter.lifetime,
      size,
      color,
    });
  }

  return particles;
}

/**
 * Tick all particles: update positions, apply gravity, age.
 * Returns the surviving particles (age < lifetime).
 */
export function tickParticles(
  particles: Particle[],
  emitters: ParticleEmitter[],
  dt: number,
): Particle[] {
  const dtSec = dt / 1000;
  const gravity = emitters[0]?.gravity ?? 0;

  return particles
    .map(p => ({
      ...p,
      x: p.x + p.vx * dtSec,
      y: p.y + p.vy * dtSec,
      vx: p.vx,
      vy: p.vy + gravity * dtSec,
      age: p.age + dt,
    }))
    .filter(p => p.age < p.lifetime);
}

/**
 * Full particle system tick for a ParticlesNode.
 * Spawns new particles, ticks existing ones, caps at maxParticles.
 */
export function tickParticleNode(node: ParticlesNode, dt: number): Particle[] {
  const max = node.maxParticles ?? 200;
  let particles = node._particles ? [...node._particles] : [];

  // Tick existing
  particles = tickParticles(particles, node.emitters, dt);

  // Spawn new from each emitter
  for (const emitter of node.emitters) {
    const spawned = spawnParticles(emitter, dt);
    particles.push(...spawned);
  }

  // Cap
  if (particles.length > max) {
    particles = particles.slice(particles.length - max);
  }

  return particles;
}

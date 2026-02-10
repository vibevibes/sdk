/**
 * Fluent API for building SVG path `d` strings.
 *
 * Agents can also construct d strings directly, but this gives experience
 * authors a programmatic API for generating complex paths in tool handlers
 * or Canvas components.
 *
 * Usage:
 *   const d = PathBuilder.from()
 *     .moveTo(0, 0)
 *     .lineTo(100, 0)
 *     .lineTo(100, 100)
 *     .close()
 *     .build();
 *   // "M 0 0 L 100 0 L 100 100 Z"
 */
export class PathBuilder {
  private commands: string[] = [];

  // ── Core commands ─────────────────────────────────────────────────────

  moveTo(x: number, y: number): this {
    this.commands.push(`M ${x} ${y}`);
    return this;
  }

  lineTo(x: number, y: number): this {
    this.commands.push(`L ${x} ${y}`);
    return this;
  }

  horizontalTo(x: number): this {
    this.commands.push(`H ${x}`);
    return this;
  }

  verticalTo(y: number): this {
    this.commands.push(`V ${y}`);
    return this;
  }

  quadTo(cx: number, cy: number, x: number, y: number): this {
    this.commands.push(`Q ${cx} ${cy} ${x} ${y}`);
    return this;
  }

  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    this.commands.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`);
    return this;
  }

  arcTo(rx: number, ry: number, rotation: number, largeArc: boolean, sweep: boolean, x: number, y: number): this {
    this.commands.push(`A ${rx} ${ry} ${rotation} ${largeArc ? 1 : 0} ${sweep ? 1 : 0} ${x} ${y}`);
    return this;
  }

  close(): this {
    this.commands.push('Z');
    return this;
  }

  // ── Higher-level helpers ──────────────────────────────────────────────

  rect(x: number, y: number, w: number, h: number): this {
    return this.moveTo(x, y)
      .lineTo(x + w, y)
      .lineTo(x + w, y + h)
      .lineTo(x, y + h)
      .close();
  }

  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry?: number): this {
    const r = ry ?? rx;
    return this
      .moveTo(x + rx, y)
      .lineTo(x + w - rx, y)
      .arcTo(rx, r, 0, false, true, x + w, y + r)
      .lineTo(x + w, y + h - r)
      .arcTo(rx, r, 0, false, true, x + w - rx, y + h)
      .lineTo(x + rx, y + h)
      .arcTo(rx, r, 0, false, true, x, y + h - r)
      .lineTo(x, y + r)
      .arcTo(rx, r, 0, false, true, x + rx, y)
      .close();
  }

  circle(cx: number, cy: number, r: number): this {
    return this
      .moveTo(cx - r, cy)
      .arcTo(r, r, 0, true, true, cx + r, cy)
      .arcTo(r, r, 0, true, true, cx - r, cy)
      .close();
  }

  ellipse(cx: number, cy: number, rx: number, ry: number): this {
    return this
      .moveTo(cx - rx, cy)
      .arcTo(rx, ry, 0, true, true, cx + rx, cy)
      .arcTo(rx, ry, 0, true, true, cx - rx, cy)
      .close();
  }

  star(cx: number, cy: number, points: number, outerR: number, innerR: number): this {
    const step = Math.PI / points;
    for (let i = 0; i < 2 * points; i++) {
      const angle = i * step - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) {
        this.moveTo(x, y);
      } else {
        this.lineTo(x, y);
      }
    }
    return this.close();
  }

  arrow(x1: number, y1: number, x2: number, y2: number, headSize: number = 10): this {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const ha1 = angle + Math.PI * 0.8;
    const ha2 = angle - Math.PI * 0.8;
    return this
      .moveTo(x1, y1)
      .lineTo(x2, y2)
      .moveTo(x2, y2)
      .lineTo(x2 + headSize * Math.cos(ha1), y2 + headSize * Math.sin(ha1))
      .moveTo(x2, y2)
      .lineTo(x2 + headSize * Math.cos(ha2), y2 + headSize * Math.sin(ha2));
  }

  // ── Output ────────────────────────────────────────────────────────────

  build(): string {
    return this.commands.join(' ');
  }

  static from(): PathBuilder {
    return new PathBuilder();
  }
}

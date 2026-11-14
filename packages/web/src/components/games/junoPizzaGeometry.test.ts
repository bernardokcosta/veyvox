import { describe, expect, it } from 'vitest';
import { pizzaOrbitFrames } from './junoPizzaGeometry';

describe('measured pizza orbit', () => {
  it('rejects missing, non-finite and degenerate anchors', () => {
    expect(pizzaOrbitFrames([])).toEqual([]);
    expect(pizzaOrbitFrames([{ x: 1, y: 1 }])).toEqual([]);
    expect(pizzaOrbitFrames([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toEqual([]);
    expect(pizzaOrbitFrames([{ x: NaN, y: 1 }, { x: 20, y: 30 }])).toEqual([]);
  });
  it.each([2, 3, 4])('closes a smooth finite orbit through %i real hands', count => {
    const points = [{ x: 300, y: 450 }, { x: 50, y: 200 }, { x: 300, y: 50 }, { x: 550, y: 200 }].slice(0, count);
    const frames = pizzaOrbitFrames(points);
    expect(frames.length).toBeGreaterThan(24);
    expect(frames[0]?.transform).toBe(frames.at(-1)?.transform);
    expect(frames[0]?.offset).toBe(0); expect(frames.at(-1)?.offset).toBe(1);
    for (const point of points) expect(frames.some(frame => frame.transform === `translate3d(${point.x}px, ${point.y}px, 0)`)).toBe(true);
    expect(JSON.stringify(frames)).not.toMatch(/NaN|Infinity/);
  });
  it('gives two players an orbit around the center rather than a straight retraced line', () => {
    const frames = pizzaOrbitFrames([{ x: 100, y: 50 }, { x: 100, y: 450 }]);
    expect(frames.some(frame => !String(frame.transform).startsWith('translate3d(100px,'))).toBe(true);
  });
  it('keeps a compact three-seat orbit within its hand envelope instead of clipping above the table', () => {
    const frames = pizzaOrbitFrames([{ x: 90, y: 300 }, { x: 30, y: 20 }, { x: 500, y: 20 }]);
    for (const frame of frames) {
      const [, x, y] = String(frame.transform).match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px/)!.map(Number);
      expect(x).toBeGreaterThanOrEqual(30); expect(x).toBeLessThanOrEqual(500);
      expect(y).toBeGreaterThanOrEqual(20); expect(y).toBeLessThanOrEqual(300);
    }
  });
});

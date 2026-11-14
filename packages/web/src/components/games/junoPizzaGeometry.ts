export interface JunoPizzaPoint { x: number; y: number }

/** Closed Catmull–Rom path through actual hands; two hands get an oval, not a line. */
export function pizzaOrbitFrames(points: readonly JunoPizzaPoint[]): Keyframe[] {
  if (points.length < 2 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return [];
  if (points.every(p => Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y) < 1)) return [];
  let anchors = [...points];
  if (anchors.length === 2) {
    const [a, b] = anchors as [JunoPizzaPoint, JunoPizzaPoint];
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = (b.y - a.y) * .3, dy = (a.x - b.x) * .3;
    anchors = [a, { x: middle.x + dx, y: middle.y + dy }, b, { x: middle.x - dx, y: middle.y - dy }];
  }
  const frames: Keyframe[] = [], steps = anchors.length * 16;
  const minX = Math.min(...anchors.map(p => p.x)), maxX = Math.max(...anchors.map(p => p.x));
  const minY = Math.min(...anchors.map(p => p.y)), maxY = Math.max(...anchors.map(p => p.y));
  const coordinate = (a: number, b: number, c: number, d: number, t: number) =>
    Math.round(.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t) * 100) / 100;
  for (let i = 0; i <= steps; i++) {
    const segment = Math.floor(i / 16) % anchors.length, t = (i % 16) / 16;
    const a = anchors[(segment + anchors.length - 1) % anchors.length]!, b = anchors[segment]!;
    const c = anchors[(segment + 1) % anchors.length]!, d = anchors[(segment + 2) % anchors.length]!;
    const x = Math.max(minX, Math.min(maxX, coordinate(a.x, b.x, c.x, d.x, t)));
    const y = Math.max(minY, Math.min(maxY, coordinate(a.y, b.y, c.y, d.y, t)));
    frames.push({ transform: `translate3d(${x}px, ${y}px, 0)`, offset: i / steps });
  }
  return frames;
}

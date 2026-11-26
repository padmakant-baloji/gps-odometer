import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, haversineKm, pathDistance, thinTrail, trailDistance, type TrailPoint } from '../src/index.js';

const t0 = Date.parse('2026-10-27T05:00:00Z');
const at = (min: number) => t0 + min * 60_000;
// ~1.11 km north per 0.01° of latitude
const pt = (min: number, lat: number, extra: Partial<TrailPoint> = {}): TrailPoint => ({ lat, lng: 73.85, at: at(min), ...extra });

describe('haversineKm', () => {
  it('measures great-circle distance', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 1);
  });
});

describe('trailDistance', () => {
  it('adds up the steps between consecutive positions', () => {
    const r = trailDistance([pt(0, 18.5), pt(2, 18.52), pt(4, 18.54)]);
    expect(r.km).toBeGreaterThan(4.3);
    expect(r.km).toBeLessThan(4.5);
    expect(r.points).toBe(3);
  });

  it('ignores drift, long gaps, impossible jumps and inaccurate fixes', () => {
    expect(trailDistance([pt(0, 18.5), pt(1, 18.50005)]).km).toBe(0); // 5 m of drift
    expect(trailDistance([pt(0, 18.5), pt(60, 18.6)]).km).toBe(0); // silent for an hour: path unknown
    expect(trailDistance([pt(0, 18.5), pt(1, 19.5)]).km).toBe(0); // 110 km in a minute
    expect(trailDistance([pt(0, 18.5), pt(2, 18.52, { accuracyM: 400 }), pt(4, 18.54)]).km).toBeGreaterThan(4.3);
  });

  it('accepts positions in any order and any timestamp format', () => {
    const sorted = trailDistance([pt(0, 18.5), pt(2, 18.52), pt(4, 18.54)]).km;
    expect(trailDistance([pt(4, 18.54), pt(0, 18.5), pt(2, 18.52)]).km).toBe(sorted);
    const iso = [pt(0, 18.5), pt(2, 18.52), pt(4, 18.54)].map((p) => ({ ...p, at: new Date(p.at as number).toISOString() }));
    expect(trailDistance(iso).km).toBe(sorted);
  });

  it('adds up slow movement that no single step would count', () => {
    // 40 fixes 10 m apart, each under the 20 m drift floor = 400 m of real walking
    const walk = Array.from({ length: 41 }, (_, i) => pt(i * 0.25, 18.5 + i * 0.00009));
    expect(trailDistance(walk).km).toBeGreaterThan(0.35);
  });

  it('with bridgeGaps, estimates stretches the device missed and reports them separately', () => {
    const trail = [pt(0, 18.5), pt(2, 18.52), pt(62, 18.6), pt(64, 18.62)];
    const r = trailDistance(trail, { bridgeGaps: true });
    expect(r.estimatedKm).toBeGreaterThan(11); // 8.9 km straight x 1.3
    expect(r.estimatedKm).toBeLessThan(12);
    expect(r.measuredKm).toBeGreaterThan(4.3);
    expect(r.km).toBe(Math.round((r.measuredKm + r.estimatedKm) * 100) / 100);
    expect(trailDistance(trail).km).toBe(r.measuredKm); // without the option, nothing is guessed
    expect(trailDistance([pt(0, 18.5), pt(62, 18.5005)], { bridgeGaps: true }).estimatedKm).toBe(0); // stood still
  });

  it('lets every rule be overridden', () => {
    expect(trailDistance([pt(0, 18.5), pt(60, 18.6)], { maxGapMinutes: 120 }).km).toBeGreaterThan(11);
    expect(trailDistance([pt(0, 18.5), pt(2, 18.52, { accuracyM: 400 })], { maxAccuracyM: 500 }).km).toBeGreaterThan(2);
  });

  it('handles empty input', () => {
    expect(trailDistance([])).toEqual({ km: 0, measuredKm: 0, estimatedKm: 0, points: 0, skipped: 0 });
  });
});

describe('pathDistance', () => {
  const from = { lat: 18.5, lng: 73.85, at: at(0) };
  const to = { lat: 18.59, lng: 73.85, at: at(60) }; // ~10 km north

  it('with no positions in between, estimates straight line x roadFactor', () => {
    const r = pathDistance(from, to, []);
    expect(r.measuredKm).toBe(0);
    expect(r.km).toBeCloseTo(haversineKm(from, to) * DEFAULT_RULES.roadFactor, 1);
  });

  it('measures along dense recorded positions', () => {
    const between = Array.from({ length: 39 }, (_, i) => pt(1 + i * 1.5, 18.5 + ((i + 1) * 0.09) / 40, { accuracyM: 10 }));
    const r = pathDistance(from, to, between);
    expect(r.km).toBeCloseTo(10, 0);
    expect(r.estimatedKm).toBeLessThan(0.5);
  });

  it('uses a road-distance callback for gaps, never shorter than the straight line', () => {
    expect(pathDistance(from, to, [], { roadDistance: () => 14 })).toMatchObject({ km: 14, byRoad: true });
    expect(pathDistance(from, to, [], { roadDistance: () => 1 }).km).toBeCloseTo(haversineKm(from, to), 2);
    expect(pathDistance(from, to, [], { roadDistance: () => null }).byRoad).toBe(false);
  });

  it('ignores positions outside the time window', () => {
    expect(pathDistance(from, to, [pt(-10, 19), pt(120, 19)]).km).toBe(pathDistance(from, to, []).km);
  });
});

describe('thinTrail', () => {
  it('keeps both ends and the requested count', () => {
    const thin = thinTrail(Array.from({ length: 5000 }, (_, i) => i), 600);
    expect(thin).toHaveLength(600);
    expect(thin[0]).toBe(0);
    expect(thin[599]).toBe(4999);
    expect(thinTrail([1, 2, 3], 600)).toEqual([1, 2, 3]);
    expect(() => thinTrail([1, 2, 3], 1)).toThrow(RangeError);
  });
});

import { haversineKm, round2, toMs, type LatLng, type TrailPoint } from './geo.js';

/** Tuning for turning a trail of GPS positions into kilometres. Every field can be overridden per call. */
export interface DistanceRules {
  /** Positions less accurate than this (metres) are ignored. */
  maxAccuracyM: number;
  /** Positions further apart in time than this are not joined: the path in between is unknown. */
  maxGapMinutes: number;
  /** Movement below this (km) from the last counted position is drift, not travel. */
  minStepKm: number;
  /** A step faster than this (km/h) is a GPS glitch and is dropped. */
  maxSpeedKmh: number;
  /** Straight-line distance is multiplied by this to estimate road distance across unrecorded stretches. */
  roadFactor: number;
  /** Unrecorded stretches longer than this (hours) are not estimated: the device was probably off. */
  maxBridgeHours: number;
  /** Unrecorded stretches shorter than this straight-line distance (km) are not estimated. */
  minBridgeKm: number;
  /** In `pathDistance`, a step longer than this (km) is a jump between sparse fixes, so it is estimated rather than measured. */
  denseStepKm: number;
}

export const DEFAULT_RULES: Readonly<DistanceRules> = Object.freeze({
  maxAccuracyM: 100,
  maxGapMinutes: 30,
  minStepKm: 0.02,
  maxSpeedKmh: 120,
  roadFactor: 1.3,
  maxBridgeHours: 12,
  minBridgeKm: 0.2,
  denseStepKm: 1,
});

export interface TrailDistance {
  /** measuredKm + estimatedKm, rounded to 2 decimals. */
  km: number;
  /** Kilometres along recorded positions. */
  measuredKm: number;
  /** Kilometres estimated across stretches with no positions (0 unless `bridgeGaps` is on). */
  estimatedKm: number;
  /** Positions that passed the accuracy filter. */
  points: number;
  /** Positions dropped: inaccurate, duplicate timestamps, glitches or unbridged gaps. */
  skipped: number;
}

export interface TrailOptions extends Partial<DistanceRules> {
  /** Estimate stretches where the device recorded nothing (straight line x roadFactor). Default false. */
  bridgeGaps?: boolean;
}

const withRules = (o?: Partial<DistanceRules>): DistanceRules => ({ ...DEFAULT_RULES, ...o });
const accurate = (r: DistanceRules) => (p: { accuracyM?: number | null }) => p.accuracyM == null || p.accuracyM <= r.maxAccuracyM;
/** A step must clear the drift floor and half the fix's own accuracy (a 60 m fix moving 25 m is noise). */
const stepFloorKm = (r: DistanceRules, accuracyM?: number | null) => Math.max(r.minStepKm, ((accuracyM ?? 0) / 1000) * 0.5);

/**
 * Distance travelled along a trail of GPS positions.
 *
 * Each step is measured from the last *counted* position rather than the previous fix, so slow continuous movement adds up while
 * jitter around a stationary device does not. Inaccurate fixes and impossible jumps are dropped. Positions may arrive in any order.
 */
export function trailDistance(points: readonly TrailPoint[], options: TrailOptions = {}): TrailDistance {
  const r = withRules(options);
  const good = points.filter(accurate(r)).sort((a, b) => toMs(a.at) - toMs(b.at));
  let measured = 0;
  let estimated = 0;
  let skipped = points.length - good.length;
  if (good.length === 0) return { km: 0, measuredKm: 0, estimatedKm: 0, points: 0, skipped };

  let anchor = good[0]!; // last counted position
  let prev = good[0]!; // last accepted fix, for gap and speed checks
  for (let i = 1; i < good.length; i++) {
    const b = good[i]!;
    const minutes = (toMs(b.at) - toMs(prev.at)) / 60_000;
    if (minutes <= 0) { skipped++; continue; }

    if (minutes > r.maxGapMinutes) {
      const straight = haversineKm(anchor, b);
      const hours = (toMs(b.at) - toMs(anchor.at)) / 3_600_000;
      const plausible = straight >= r.minBridgeKm && hours <= r.maxBridgeHours && straight / hours <= r.maxSpeedKmh;
      if (options.bridgeGaps && plausible) estimated += straight * r.roadFactor;
      else skipped++;
      anchor = b; prev = b;
      continue;
    }

    if (haversineKm(prev, b) / (minutes / 60) > r.maxSpeedKmh) { skipped++; continue; } // glitch: keep the previous fix
    prev = b;
    const d = haversineKm(anchor, b);
    if (d < stepFloorKm(r, b.accuracyM)) continue;
    measured += d;
    anchor = b;
  }
  return { km: round2(measured + estimated), measuredKm: round2(measured), estimatedKm: round2(estimated), points: good.length, skipped };
}

/** Road distance between two places in km, or null when unknown (e.g. a cached call to a routing service). */
export type RoadDistance = (a: LatLng, b: LatLng) => number | null;

export interface PathOptions extends Partial<DistanceRules> {
  /** Used for unrecorded stretches of at least `roadMinKm`; falls back to straight line x roadFactor when it returns null. */
  roadDistance?: RoadDistance;
  /** Stretches shorter than this are not worth asking `roadDistance` about. Default 0.3 km. */
  roadMinKm?: number;
}

export interface PathDistance {
  km: number;
  measuredKm: number;
  estimatedKm: number;
  /** Intermediate positions used. */
  points: number;
  /** True when at least one stretch came from `roadDistance`. */
  byRoad: boolean;
}

/**
 * Distance from one known place to another through whatever positions were recorded in between.
 *
 * Dense short steps are measured; long jumps (sparse positions, or the device silent for a while) are estimated by `roadDistance`
 * when given, else straight line x roadFactor. Both ends are always kept; drift and glitches in between are dropped. Only positions
 * strictly between `from.at` and `to.at` are used.
 */
export function pathDistance(
  from: LatLng & { at: Date | number | string },
  to: LatLng & { at: Date | number | string },
  between: readonly TrailPoint[],
  options: PathOptions = {},
): PathDistance {
  const r = withRules(options);
  const roadMinKm = options.roadMinKm ?? 0.3;
  type P = LatLng & { at: number; accuracyM?: number | null; fixed?: boolean };
  const start: P = { lat: from.lat, lng: from.lng, at: toMs(from.at), fixed: true };
  const end: P = { lat: to.lat, lng: to.lng, at: toMs(to.at), fixed: true };
  const mid: P[] = between
    .map((p) => ({ lat: p.lat, lng: p.lng, at: toMs(p.at), accuracyM: p.accuracyM }))
    .filter((p) => accurate(r)(p) && p.at > start.at && p.at < end.at)
    .sort((a, b) => a.at - b.at);
  const seq = [start, ...mid, end];

  let measured = 0;
  let estimated = 0;
  let used = 0;
  let byRoad = false;
  let anchor = seq[0]!;
  let prev = seq[0]!;
  for (let i = 1; i < seq.length; i++) {
    const b = seq[i]!;
    const hours = (b.at - prev.at) / 3_600_000;
    if (!b.fixed && (hours <= 0 || haversineKm(prev, b) / hours > r.maxSpeedKmh)) continue;
    prev = b;
    const d = haversineKm(anchor, b);
    if (!b.fixed && d < stepFloorKm(r, b.accuracyM)) continue;
    const gapMin = (b.at - anchor.at) / 60_000;
    if (d > r.denseStepKm || gapMin > r.maxGapMinutes) {
      const road = d >= roadMinKm && options.roadDistance ? options.roadDistance(anchor, b) : null;
      if (road != null) { estimated += Math.max(road, d); byRoad = true; } // a road is never shorter than the straight line
      else estimated += d * r.roadFactor;
    } else measured += d;
    if (!b.fixed) used++;
    anchor = b;
  }
  return { km: round2(measured + estimated), measuredKm: round2(measured), estimatedKm: round2(estimated), points: used, byRoad };
}

/** Evenly thins a long trail (e.g. for drawing on a map), always keeping the first and last point. */
export function thinTrail<T>(points: readonly T[], max = 600): T[] {
  if (max < 2) throw new RangeError('thinTrail: max must be at least 2');
  if (points.length <= max) return [...points];
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]!);
}

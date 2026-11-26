import { haversineKm, isWithin, round2, toMs, type LatLng } from './geo.js';

/**
 * Automatic end detection for a round trip that starts and ends at a base (home, depot, office).
 *
 * A trip is `outbound` while heading to or working at a stop and `returning` once the last stop is done. Starting a new stop on
 * the way back puts it back to `outbound`, so passing the base mid-trip never ends it.
 */
export interface TripRules {
  /** Within this distance of the base the trip has arrived. */
  baseRadiusM: number;
  /** Returning, silent for `stillMinutes`, and last seen within this many km of the base: arrived (GPS often drops out indoors). */
  nearBaseKm: number;
  /** No new position for this long counts as standing still. */
  stillMinutes: number;
  /** Returning for longer than this: closed at the last position. */
  maxReturnHours: number;
  /** No trip runs longer than this (a device left recording overnight). */
  maxTripHours: number;
  /** In `baseLegKm`, a start further than this from the base is treated as implausible and not credited. */
  maxBaseLegKm: number;
  /** Straight line x this estimates road distance in `baseLegKm`. */
  roadFactor: number;
}

export const DEFAULT_TRIP_RULES: Readonly<TripRules> = Object.freeze({
  baseRadiusM: 200,
  nearBaseKm: 1,
  stillMinutes: 45,
  maxReturnHours: 5,
  maxTripHours: 18,
  maxBaseLegKm: 100,
  roadFactor: 1.3,
});

export type TripEndReason = 'BASE' | 'STOPPED' | 'TIMEOUT';

export interface TripState {
  startedAt: Date | number | string;
  phase: 'outbound' | 'returning';
  /** When the trip switched to `returning` (null while outbound). */
  returningSince: Date | number | string | null;
  /** The latest position received. */
  last: (LatLng & { at: Date | number | string }) | null;
  /** The base the trip returns to, if known. */
  base: LatLng | null;
}

export interface TripEnd {
  reason: TripEndReason;
  /** Epoch ms the trip should be considered ended at. */
  at: number;
}

const rules = (o?: Partial<TripRules>): TripRules => ({ ...DEFAULT_TRIP_RULES, ...o });

/** Call on every new position: ends the trip when it reaches the base on the way back. */
export function tripEndOnPoint(
  s: TripState,
  p: LatLng & { at: Date | number | string },
  options?: Partial<TripRules>,
): TripEnd | null {
  const r = rules(options);
  return s.phase === 'returning' && isWithin(p, s.base, r.baseRadiusM) ? { reason: 'BASE', at: toMs(p.at) } : null;
}

/**
 * Call periodically (devices send nothing while standing still): ends a trip that has clearly finished.
 * - returning, silent, last seen near the base → BASE
 * - returning, silent, no base known → STOPPED
 * - returning too long, or the whole trip too long → TIMEOUT
 */
export function tripEndOnTick(s: TripState, now: Date | number, options?: Partial<TripRules>): TripEnd | null {
  const r = rules(options);
  const nowMs = toMs(now);
  const lastAt = s.last ? toMs(s.last.at) : null;
  const endAt = lastAt ?? nowMs;
  const still = lastAt != null && nowMs - lastAt >= r.stillMinutes * 60_000;
  if (s.phase === 'returning') {
    if (still && s.base && s.last && haversineKm(s.last, s.base) <= r.nearBaseKm) return { reason: 'BASE', at: endAt };
    if (still && !s.base) return { reason: 'STOPPED', at: endAt };
    if (s.returningSince != null && nowMs - toMs(s.returningSince) >= r.maxReturnHours * 3_600_000) return { reason: 'TIMEOUT', at: endAt };
  }
  if (nowMs - toMs(s.startedAt) >= r.maxTripHours * 3_600_000) return { reason: 'TIMEOUT', at: endAt };
  return null;
}

/**
 * Estimated distance from the base to where recording started, for trips whose recording began away from the base.
 * 0 when the start is at the base, either point is unknown, or the distance is implausible (`maxBaseLegKm`).
 */
export function baseLegKm(base: LatLng | null | undefined, start: LatLng | null | undefined, options?: Partial<TripRules>): number {
  const r = rules(options);
  if (!base || !start) return 0;
  const straight = haversineKm(base, start);
  if (straight * 1000 <= r.baseRadiusM || straight > r.maxBaseLegKm) return 0;
  return round2(straight * r.roadFactor);
}

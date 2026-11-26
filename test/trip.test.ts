import { describe, expect, it } from 'vitest';
import { baseLegKm, tripEndOnPoint, tripEndOnTick, type TripState } from '../src/index.js';

const base = { lat: 18.5, lng: 73.85 };
const t0 = Date.parse('2026-10-27T03:00:00Z');
const m = (min: number) => t0 + min * 60_000;
const start: TripState = { startedAt: m(0), phase: 'outbound', returningSince: null, last: null, base };

describe('tripEndOnPoint', () => {
  it('ends at the base only on the way back', () => {
    expect(tripEndOnPoint(start, { ...base, at: m(1) })).toBeNull(); // leaving
    const back: TripState = { ...start, phase: 'returning', returningSince: m(60) };
    expect(tripEndOnPoint(back, { lat: 18.51, lng: 73.85, at: m(70) })).toBeNull(); // 1.1 km out
    expect(tripEndOnPoint(back, { lat: 18.5012, lng: 73.85, at: m(90) })).toEqual({ reason: 'BASE', at: m(90) }); // ~130 m
  });

  it('a new stop on the way back keeps the trip going', () => {
    const again: TripState = { ...start, phase: 'outbound' };
    expect(tripEndOnPoint(again, { ...base, at: m(100) })).toBeNull();
    expect(tripEndOnTick({ ...again, last: { ...base, at: m(100) } }, m(200))).toBeNull();
  });

  it('respects a custom radius', () => {
    const back: TripState = { ...start, phase: 'returning', returningSince: m(60) };
    expect(tripEndOnPoint(back, { lat: 18.5012, lng: 73.85, at: m(90) }, { baseRadiusM: 50 })).toBeNull();
  });
});

describe('tripEndOnTick', () => {
  const back: TripState = { ...start, phase: 'returning', returningSince: m(60), last: { lat: 18.505, lng: 73.85, at: m(80) } };

  it('waits through short stops', () => {
    expect(tripEndOnTick(back, m(100))).toBeNull();
  });
  it('arrives when silent near the base', () => {
    expect(tripEndOnTick(back, m(130))).toEqual({ reason: 'BASE', at: m(80) });
  });
  it('stops where the device went still when no base is known', () => {
    expect(tripEndOnTick({ ...back, base: null }, m(130))).toEqual({ reason: 'STOPPED', at: m(80) });
  });
  it('times out long returns and overlong trips', () => {
    const far: TripState = { ...back, last: { lat: 18.7, lng: 73.85, at: m(80) } };
    expect(tripEndOnTick(far, m(130))).toBeNull(); // stopped far away: still travelling
    expect(tripEndOnTick(far, m(361))?.reason).toBe('TIMEOUT');
    expect(tripEndOnTick({ ...start, last: { lat: 18.7, lng: 73.85, at: m(1000) } }, m(18 * 60))?.reason).toBe('TIMEOUT');
  });
});

describe('baseLegKm', () => {
  it('estimates the unrecorded leg from the base', () => {
    expect(baseLegKm(base, { lat: 18.59, lng: 73.85 })).toBeCloseTo(13, 0); // 10 km x 1.3
    expect(baseLegKm(base, base)).toBe(0);
    expect(baseLegKm(null, base)).toBe(0);
    expect(baseLegKm(base, { lat: 20, lng: 73.85 })).toBe(0); // 166 km: implausible
  });
});

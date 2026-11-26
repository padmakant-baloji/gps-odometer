export interface LatLng {
  lat: number;
  lng: number;
}

/** A GPS position. `at` is a Date, epoch milliseconds or an ISO string. */
export interface TrailPoint extends LatLng {
  at: Date | number | string;
  /** Horizontal accuracy in metres, as reported by the device (null/undefined = unknown). */
  accuracyM?: number | null;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(x));
}

/** True when `p` is within `radiusM` metres of `centre`. */
export const isWithin = (p: LatLng, centre: LatLng | null | undefined, radiusM: number): boolean =>
  !!centre && haversineKm(p, centre) * 1000 <= radiusM;

/** Epoch milliseconds for a Date, number or ISO string. */
export const toMs = (d: Date | number | string): number =>
  typeof d === 'number' ? d : typeof d === 'string' ? Date.parse(d) : d.getTime();

export const round2 = (n: number) => Math.round(n * 100) / 100;

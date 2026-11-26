# gps-odometer

Turn noisy phone GPS trails into accurate kilometres. Zero dependencies, fully typed, works in Node, browsers, React Native and Expo.

Adding up the straight lines between GPS fixes overstates distance badly. A parked phone "drifts" a few metres every fix, a bad fix jumps 2 km and back, and the app gets killed in the background for 40 minutes. `gps-odometer` handles all of that. It came out of a production field-staff app that pays travel allowance by the kilometre.

```sh
npm install gps-odometer
```

## Features

- **Drift filtering.** Each step is measured from the last *counted* position, so jitter around a stationary phone adds nothing while slow, steady walking still adds up.
- **Glitch rejection.** It drops fixes that imply impossible speeds or have poor reported accuracy.
- **Gap handling.** When the device recorded nothing for a while, it either skips the stretch (a conservative minimum) or estimates it as straight line × road factor, and reports the estimate separately.
- **Road-distance hook.** You can plug in your own routing service (OSRM, Google, Mapbox) for unrecorded stretches.
- **Trip-end detection.** It closes a round trip automatically when the device gets back to base, goes silent near it, or has been out too long.
- **Tunable.** Every threshold can be overridden per call.

## Usage

### Distance along a trail

```ts
import { trailDistance } from 'gps-odometer';

const trail = [
  { lat: 18.5, lng: 73.85, at: '2026-10-27T05:00:00Z', accuracyM: 8 },
  { lat: 18.52, lng: 73.85, at: '2026-10-27T05:02:00Z', accuracyM: 12 },
  { lat: 18.54, lng: 73.85, at: '2026-10-27T05:04:00Z', accuracyM: 10 },
];

trailDistance(trail);
// { km: 4.45, measuredKm: 4.45, estimatedKm: 0, points: 3, skipped: 0 }

// Estimate stretches where the app was killed or GPS was lost:
trailDistance(trail, { bridgeGaps: true });
```

`at` can be a `Date`, epoch milliseconds or an ISO string. Points can come in any order.

### Distance between two known places

Use `pathDistance` when you know where a leg started and ended, for example from one delivery stop to the next, and have whatever positions were recorded in between:

```ts
import { pathDistance } from 'gps-odometer';

const leg = pathDistance(
  { lat: 18.5, lng: 73.85, at: departedAt },
  { lat: 18.59, lng: 73.85, at: arrivedAt },
  recordedPositions,
  { roadDistance: (a, b) => cachedRoutingLookup(a, b) }, // optional; return null when unknown
);
// { km, measuredKm, estimatedKm, points, byRoad }
```

### Automatic trip end

```ts
import { tripEndOnPoint, tripEndOnTick, type TripState } from 'gps-odometer';

const state: TripState = {
  startedAt: Date.now(),
  phase: 'returning',            // 'outbound' while heading to or at a stop
  returningSince: Date.now(),
  last: null,                    // update with each new fix
  base: { lat: 18.5, lng: 73.85 },
};

tripEndOnPoint(state, newFix);   // on every fix: { reason: 'BASE', at } once back within 200 m
tripEndOnTick(state, Date.now()); // on a timer: BASE / STOPPED / TIMEOUT when the trip has clearly finished
```

### Drawing on a map

```ts
import { thinTrail } from 'gps-odometer';
thinTrail(tenThousandPoints, 600); // evenly spaced, first and last always kept
```

## Defaults

| Rule | Default | Meaning |
|---|---|---|
| `maxAccuracyM` | 100 | Ignore fixes less accurate than this |
| `minStepKm` | 0.02 | Movement under 20 m from the last counted point is drift |
| `maxSpeedKmh` | 120 | Faster steps are glitches |
| `maxGapMinutes` | 30 | Longer silences are gaps, not measured steps |
| `roadFactor` | 1.3 | Straight line × this estimates road distance |
| `maxBridgeHours` | 12 | Longer gaps are never estimated |

Trip rules (`DEFAULT_TRIP_RULES`): `baseRadiusM` 200, `nearBaseKm` 1, `stillMinutes` 45, `maxReturnHours` 5, `maxTripHours` 18.

## Notes

- Straight lines between fixes are slightly shorter than the road, so measured distance is a fair *minimum*. Estimated distance is reported separately so you can decide how to treat it.
- This library only does the maths. Collecting positions (for example with `expo-location` or the browser Geolocation API) is up to your app.

## License

MIT

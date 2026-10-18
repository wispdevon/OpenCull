# Performance measurements

## Recent-session resume selection

`latestSession` used to copy and sort the full saved-card array to find its most
recent entry. It now scans once, retaining the first card on equal timestamps
and ignoring non-finite card timestamps. Equal card and folder timestamps still
prefer the card. The focused tests cover these rules and verify input order is
unchanged.

### Method

Measured on 2026-10-18 with Node v22.23.3 and npm 11.21.1 on Linux x86_64,
kernel 7.2.9, AMD Ryzen 5 7500F (6 cores / 12 threads). Inputs were synthetic
arrays of 24, 100, 1,000, and 10,000 sessions. Timestamps were unique finite
integers. The sorted workload matched the descending order returned by the
session-list APIs; the shuffled workload used a deterministic Fisher–Yates
shuffle (LCG seed `0x5eed`). Input creation was outside the timed loop, and a
valid folder timestamp below every card forced the card-selection path.

The one-off harness, `/tmp/verify-session-history.mjs`, compared the current
function with a local copy of its previous sort-based implementation in the
same Node process. It warmed each case four times, then collected nine samples
per case, alternating implementation order. Each sample made 20,000 calls at
24 entries, 5,000 at 100, 500 at 1,000, and 50 at 10,000. Values below are
median microseconds per call with the full observed min–max range.

```sh
PATH=/home/wisp/.npm/_npx/e609a7c1edf98e65/node_modules/.bin:$PATH \
  node --experimental-strip-types /tmp/verify-session-history.mjs
```

### Results

| Sessions | Input order | Previous sort | Linear scan | Change |
|---:|---|---:|---:|---:|
| 24 | Sorted | 0.341 µs (0.332–0.354) | 0.056 µs (0.053–0.063) | 83.7% lower |
| 24 | Shuffled | 0.815 µs (0.788–0.862) | 0.055 µs (0.054–0.061) | 93.2% lower |
| 100 | Sorted | 1.204 µs (1.184–1.309) | 0.194 µs (0.190–0.200) | 83.9% lower |
| 100 | Shuffled | 5.203 µs (5.056–5.404) | 0.192 µs (0.184–0.211) | 96.3% lower |
| 1,000 | Sorted | 11.541 µs (11.258–13.191) | 1.784 µs (1.765–1.859) | 84.5% lower |
| 1,000 | Shuffled | 82.236 µs (79.245–83.859) | 1.793 µs (1.771–1.821) | 97.8% lower |
| 10,000 | Sorted | 115.943 µs (111.539–119.604) | 17.979 µs (17.780–19.150) | 84.5% lower |
| 10,000 | Shuffled | 1,432.697 µs (1,390.857–1,645.586) | 18.727 µs (18.285–20.724) | 98.7% lower |

The app currently exposes at most 24 recent card sessions, and the sorted
24-entry workload is the closest synthetic match to normal use. It saves about
0.285 microseconds per call in this environment. That is a measurable
algorithmic reduction, but this microbenchmark does not establish a noticeable
end-user speedup. On shuffled arrays, larger inputs show the scan scaling
linearly while the old sort grows substantially faster; sorted inputs also
show a lower constant cost. These results are machine- and runtime-specific;
they do not include React rendering or real user timing.

Validation: `PATH=/home/wisp/.npm/_npx/e609a7c1edf98e65/node_modules/.bin:$PATH npm exec vitest -- run src/lib/session-history.test.ts` passed (5 tests).

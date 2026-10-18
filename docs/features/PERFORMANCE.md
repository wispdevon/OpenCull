# Performance diagnostics

Open **Settings → Performance** and choose **Run Quick** or **Run Thorough**.
Quick uses a few samples and aims to finish within about a minute. Thorough
repeats inexpensive stages at least 20 times and has a five-minute budget.
A native operation already in progress may finish after the budget or a Cancel
request; the runner checks between operations. Cancelled and timed-out runs
retain any available measurements and are not automatically uploaded.

## What the results mean

The native benchmark creates a unique temporary workspace with generated
6000 × 4000 textured JPEG previews, a portrait orientation case, synthetic RAW
preview containers, metadata and sidecars. A separately attributed public-domain
NASA astronaut image exercises bundled YuNet and YOLO face analysis. Generated
files, copies, sessions and caches stay in the workspace and are removed after
the run. Your active shoot, original files, settings and normal caches are not
used for benchmark writes.

Results cover folder scans and RAW/JPEG association; metadata and capture times;
thumbnail, screen, fit and full preview operations; upright decode; histogram
calculation; bundled face analysis and motion blur; burst grouping; marks and
crop sidecars; ingest and Ship copying; cache trimming; saved-session storage;
saved-analysis cache writes/hits, foreground previews during observed background
work, and selected frontend logic. Each stage explains its workload and limits.

**Score** is the arithmetic mean per run: total sample time divided by the
number of samples. **Typical** is the median. Both columns use milliseconds;
lower is faster. Results can be ranked by either value. These are separate from elapsed run time, which includes
fixture preparation and cleanup. Throughput uses all successfully measured work.
P95 is shown only for 20 or more samples. Expensive model stages use fewer
samples. Failures have counts; raw exception messages are omitted.

Stage rows show a short workload, rating, typical time and score. **Details**
contains sample count, cache state, maximum, P95, throughput and failure counts.
Coverage uses one list; expand an item for its reason.

The horizontal timing breakdown shows each function's share of cumulative
measured time. Functions totaling less than one second each are combined into
**etc**; expand that group to inspect them. Colors stay tied to function IDs,
and the legend includes labels and durations. Measured time can overlap in work
recordings, so the bar is not an elapsed-time timeline.

Cold and warm refer to the app's private preview/model caches, not a flushed OS
filesystem cache. Run with the app and machine otherwise idle; the benchmark
does not pause live scans. Compare the same mode, fixture version, build features and hardware,
repeat runs, and consider variability before attributing a difference
to a change. Debug builds and synthetic local files do not predict every real
shoot or storage device. One portrait does not establish face-analysis accuracy.

GPU inference is a manual check: benchmark AI uses a worker-local CPU policy so
it cannot change the live GPU cache or disable a live provider after a failure.
Optional MobileCLIP, camera-specific RAW compatibility, physical card throughput,
actual video playback, external editors, updater installation, trash service and
rendered interaction checks are labeled skipped or manual. The browser demo
measures frontend logic only and labels native workflows unavailable.

Suggestions come from measured latency, cache differences, tail latency and
failures. They are investigation candidates rather than promises of improvement.
The engineering backlog is [the performance TODO](../../tasks/performance-todo.md),
with [measurement evidence](../../tasks/performance-measurements.md).

### Workloads and rough timing guides

Each stage now identifies its workload, repeats and throughput unit. A sample is
one timed invocation; it may process one photo or a whole batch. Repeating one
image 24 times is not a test of 24 different photos. Quick normally collects
3 native samples; Thorough collects 24. AI cold stages collect 1 sample,
basic warm AI collects 1/5 and advanced warm AI 1/3 (Quick/Thorough).
Frontend logic collects 5/20 samples.

| Stage family | Work per timed sample |
|---|---|
| Folder/ingest scan | Quick: 14 logical photo entries / 26 image files; Thorough: 50 / 98. RAW/JPEG pairs count as one entry. All small images reuse the astronaut content. |
| Preview / full RGB decode / portrait orientation | One reused 6000 × 4000 textured image; portrait changes its EXIF orientation. |
| Histogram | One cached 320-tier thumbnail from the texture, not a full 24 MP histogram. |
| Basic/advanced face analysis, motion blur | One reused 512 × 512 astronaut image; isolated CPU inference. |
| Ingest / Ship copy | Four RAW/JPEG pairs / one pair respectively, plus sidecars where present; fresh destinations each repeat. |
| Grouping | 14/50 synthetic timestamp/face records; no photo pixels. |
| AI result cache, sidecar operations | One analysis record or sidecar operation; model inference excluded. |
| Cache trimming / session history | Eight cache entries / one empty-session round trip; no photo decode. |
| Frontend logic | 1,000/10,000 records per run, or eight crop/orientation iterations; no DOM rendering or photo decode. |

**Good**, **Watch** and **Alarming** compare the average score to broad,
stage-specific product investigation budgets. These are heuristic targets, not
measurements of a population of computers, pass/fail requirements or claims
about camera-file throughput. Values between the two limits are **Watch**.
Examples for these generated local fixtures:

| Stage | Potentially good average | Investigate at or above |
|---|---:|---:|
| Warm preview cache hit, per request | 5 ms | 50 ms |
| Cold fit preview, per image | 150 ms | 500 ms |
| Landscape 24 MP decode, per image | 150 ms | 750 ms |
| Portrait 24 MP decode, per image | 250 ms | 1 s |
| Basic / advanced warm CPU face analysis | 100 / 250 ms | 1 / 2 s |
| Basic / advanced first model use | 1 / 2 s | 5 / 10 s |
| Folder scan, per entire 14/50-entry batch | 50 ms | 500 ms |
| Ingest copy, per four-pair batch | 100 ms | 2 s |

Limits for every recognized stage appear beside its actual numbers. Fewer than
five samples are marked tentative. A P95 beyond the investigation limit calls
out occasional stalls even when the average is good. Failures take precedence
over speed ratings. Recordings and unknown fixture versions remain unrated
because request counts do not establish photo counts or comparable workloads.
Storage, thermal throttling, background load, build features and model setup can
change results substantially: repeat Thorough runs while idle on the same build
and fixture before deciding a slowdown is a regression.

Timing bars and function swatches use the bundled 42-color
[Lospec500 palette](https://lospec.com/palette-list/lospec500). Colors identify
functions, not speed ratings; labels and tables carry the interpretation.

## Recording a work session

Choose **Start recording**, use the app, then **Stop and save report**. Recording
survives closing Settings and stops on app exit. It is off by default and keeps
only the first 500 completed request timings per named operation in memory.
It observes actions you perform; it does not initiate photo edits or transfers.

Recordings contain fixed operation names, duration samples and failure counts.
They do not collect API arguments, photo names or paths, EXIF, image contents,
credentials or raw errors. Request timings can overlap and do not add up to
end-to-end interaction or rendering latency. Operations that do not complete
before recording stops are omitted. An empty recording stays local.

## Optional reporting

Diagnostic reporting is disabled until approved. Destinations are installed and
read-only: the app has no webhook URL, ntfy URL or bearer-token configuration
controls. Choose **Preview and approve**. The preview renders the message as
bullet points; exact webhook JSON is available under **Raw JSON**. Notifications
include system ID, duration, failures, the three slowest stages and at most one
short suggestion. The app never uploads photos.

Benchmark summaries use the fixed `https://ntfy.sh/culltivate-perf` topic;
sanitized work-session operation logs use `https://ntfy.sh/culltivate-logs`.
Both include a stable, randomly generated installation alias such as
`calm-otter-123456`. This is unrelated to the hostname, account or hardware
serial number. Raw application logs and photo paths are not uploaded.

Approval enables automatic reporting after completed benchmarks and stopped
recordings for the current app session. Payload-version changes require a new
preview. Restarting the app requires approval again.
The most recent report remains available for local export or manual retry.

Generic webhooks receive aggregate JSON, including hardware context and coverage.
Discord and ntfy receive the same short message, bounded to 1,000 UTF-8 bytes;
Discord mentions are disabled. The preview uses the exact outgoing message.
Both use HTTP POST. Remote destinations
require HTTPS; private test helpers support loopback HTTP for local tests.
The desktop commands resolve destinations themselves and do not accept URL or
bearer-token overrides from the frontend. Preference writes and imports cannot
replace diagnostic destinations; those private values are omitted from
preferences returned to the frontend and from portable settings backups.

The webhook URL is stored base64-encoded in the installed native configuration
and shown only as configured/not configured in Settings. Encoding prevents a plain URL from appearing in the file; it is
not encryption. No configured webhook credential is embedded in the application
source or browser bundle.

Each destination has its own outcome. Requests have a ten-second timeout and
redirects are refused. Delivery failures do not invalidate measurements or
block saving a report. Disable reporting stops future queued requests; a request
already transmitted cannot be recalled. No real remote diagnostic destinations
are contacted by automated tests. Diagnostic delivery is desktop-only; the
browser demo can preview the data without sending it.

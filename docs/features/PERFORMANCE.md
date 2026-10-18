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

**Total cost** ranks cumulative time across samples; **Typical latency** ranks
the median sample. These are separate from elapsed run time, which includes
fixture preparation and cleanup. Throughput uses all successfully measured work.
P95 is shown only for 20 or more samples. Expensive model stages use fewer
samples. Failures have counts; raw exception messages are omitted.

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

Diagnostic reporting is disabled until configured and approved. Configure a
webhook URL and/or a full ntfy topic URL, such as `https://ntfy.sh/your-topic`,
then choose **Preview and approve**. The preview shows the outgoing webhook JSON
and ntfy message. It includes app/build and anonymous hardware context, aggregate
results, coverage and evidence-linked recommendations; sample arrays and stage
details are not sent. The app never uploads photos.

Approval enables automatic reporting after completed benchmarks and stopped
recordings for the current app session. Endpoint changes or payload-version
changes require a new preview. Restarting the app requires approval again.
The most recent report remains available for local export or manual retry.

The webhook receives aggregate JSON. The ntfy endpoint receives a compact
summary, bounded to 3,500 UTF-8 bytes. Both use HTTP POST. Remote destinations
require HTTPS; loopback HTTP is supported for local testing. Optional bearer
tokens remain in memory and are excluded from settings exports. URL settings
also stay out of portable settings backups.

Each destination has its own outcome. Requests have a ten-second timeout and
redirects are refused. Delivery failures do not invalidate measurements or
block saving a report. Disable reporting stops future queued requests; a request
already transmitted cannot be recalled. No real remote diagnostic destinations
are contacted by automated tests. Diagnostic delivery is desktop-only; the
browser demo can preview the data without sending it.

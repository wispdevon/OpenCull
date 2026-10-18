//! Who gets a preview made first.
//!
//! Making previews is the only slow thing this app does, and far more of them
//! are asked for than can be made at once: scroll a grid and every cell that
//! passes wants one. What keeps that feeling quick is not making them faster
//! but making them in the right order.
//!
//! Three rules:
//!
//! 1. **The photo being looked at goes first.** One worker takes nothing else,
//!    so the loupe never waits behind a queue of thumbnails.
//! 2. **Newest request first.** When a scroll stops, the cells on screen are
//!    the ones that asked last. Serving in arrival order would spend the disk
//!    on the part of the shoot that scrolled past on the way here.
//! 3. **Each preview is made once.** A second request for one already queued
//!    or under way waits for the first instead of starting again — which is
//!    how looking ahead and then actually arriving cost one decode, not two.
//! 4. **Getting ahead never gets in the way.** Preparing a whole folder in
//!    advance is what makes any photo open at once, but it is work nobody has
//!    asked for yet. It stops the moment anything is asked for, stays stopped
//!    for a beat afterwards, and never takes more than half the workers.

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// How long idle work stays stopped after anything else is asked for.
///
/// Requests come in runs — a held arrow key, a scroll — with gaps between
/// them shorter than this. Without the pause, idle work would start up in
/// every gap and be mid-decode when the next request landed.
const QUIET: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    /// For the photo on screen in the loupe.
    Now = 0,
    /// For a cell that is on screen.
    Soon = 1,
    /// Looking ahead: wanted shortly, not yet.
    Later = 2,
    /// Not wanted by anyone yet. Made only while nothing else is being asked
    /// for, and only on some of the workers.
    Idle = 3,
}

type Work<T> = Box<dyn FnOnce() -> Result<T, String> + Send>;
type Done<T> = Box<dyn FnOnce(Result<Arc<T>, String>) + Send>;

struct Job<T> {
    key: String,
    priority: Priority,
    /// Order of asking; larger is more recent.
    seq: u64,
    work: Work<T>,
}

struct State<T> {
    queue: Vec<Job<T>>,
    /// Everyone waiting on each key, whether it is queued or being made.
    waiting: HashMap<String, Vec<Done<T>>>,
    seq: u64,
    /// Idle work may not start before this.
    quiet_until: Instant,
    idle_running: usize,
    idle_limit: usize,
    stopped: bool,
}

// Workers own only shared state. Keeping public handles separate lets their
// final drop wake the workers without joining them, even from a callback.
struct Owner<T> {
    shared: Arc<(Mutex<State<T>>, Condvar)>,
}

impl<T> Owner<T> {
    fn shutdown(&self) {
        let (lock, wake) = &*self.shared;
        lock.lock().unwrap_or_else(|e| e.into_inner()).stopped = true;
        wake.notify_all();
    }
}

impl<T> Drop for Owner<T> {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub struct Pool<T> {
    owner: Arc<Owner<T>>,
}

impl<T> Clone for Pool<T> {
    fn clone(&self) -> Self {
        Self { owner: self.owner.clone() }
    }
}

impl<T: Send + Sync + 'static> Pool<T> {
    /// `workers` threads in all, the first of which serves only `Now`. Idle
    /// work gets half of the rest.
    pub fn new(workers: usize) -> Self {
        Self::with_idle_limit(workers, (workers.max(2) - 1) / 2)
    }

    /// As `new`, with a stated number of workers that may do idle work at once.
    pub fn with_idle_limit(workers: usize, idle_limit: usize) -> Self {
        let workers = workers.max(2);
        let shared = Arc::new((
            Mutex::new(State {
                queue: Vec::new(),
                waiting: HashMap::new(),
                seq: 0,
                quiet_until: Instant::now(),
                idle_running: 0,
                idle_limit: idle_limit.clamp(1, workers - 1),
                stopped: false,
            }),
            Condvar::new(),
        ));
        let owner = Arc::new(Owner { shared });
        for i in 0..workers {
            let shared = owner.shared.clone();
            std::thread::Builder::new()
                .name(format!("opencull-preview-{i}"))
                .spawn(move || Self::work(shared, i == 0))
                .expect("spawn preview worker");
        }
        Self { owner }
    }

    /// Stops this pool and all of its clones without waiting for workers.
    /// Running jobs finish normally; workers reject queued jobs before exiting.
    /// Dropping the final handle does the same, including from a callback.
    pub fn shutdown(&self) {
        self.owner.shutdown();
    }

    /// Asks for `key` to be made by `work`, and for `done` to be told.
    ///
    /// If `key` is already wanted, `work` is dropped unused and `done` joins
    /// the others waiting. Asking again also moves the job forward: to the
    /// front of the queue, and up to this request's priority if that is
    /// higher — so a photo that was only being looked ahead to jumps the
    /// queue the moment it is the one on screen.
    pub fn submit(
        &self,
        key: String,
        priority: Priority,
        work: impl FnOnce() -> Result<T, String> + Send + 'static,
        done: impl FnOnce(Result<Arc<T>, String>) + Send + 'static,
    ) {
        let (lock, wake) = &*self.owner.shared;
        let mut state = lock.lock().unwrap();
        if state.stopped {
            drop(state);
            done(Err("preview pool stopped".into()));
            return;
        }
        state.seq += 1;
        let seq = state.seq;
        if priority != Priority::Idle {
            state.quiet_until = Instant::now() + QUIET;
        }

        if let Some(waiters) = state.waiting.get_mut(&key) {
            waiters.push(Box::new(done));
            if let Some(job) = state.queue.iter_mut().find(|j| j.key == key) {
                job.priority = job.priority.min(priority);
                job.seq = seq;
            }
        } else {
            state.waiting.insert(key.clone(), vec![Box::new(done)]);
            state.queue.push(Job { key, priority, seq, work: Box::new(work) });
        }
        drop(state);
        wake.notify_all();
    }

    /// Abandons everything not yet started, telling whoever was waiting.
    /// For when a folder is closed: its thumbnails are no longer wanted, and
    /// should not hold up the next folder's.
    pub fn clear_queued(&self) {
        let (lock, _) = &*self.owner.shared;
        let abandoned: Vec<Done<T>> = {
            let mut state = lock.lock().unwrap();
            let keys: Vec<String> = state.queue.drain(..).map(|j| j.key).collect();
            keys.iter().filter_map(|k| state.waiting.remove(k)).flatten().collect()
        };
        for done in abandoned {
            done(Err("no longer wanted".into()));
        }
    }

    /// Abandons idle work not yet started, and nothing else. For when what
    /// is worth preparing has changed — the photographer has moved to another
    /// part of the folder — and the old list would only delay the new one.
    pub fn clear_idle(&self) {
        let (lock, _) = &*self.owner.shared;
        let abandoned: Vec<Done<T>> = {
            let mut state = lock.lock().unwrap();
            let mut keys = Vec::new();
            state.queue.retain(|j| {
                let idle = j.priority == Priority::Idle;
                if idle {
                    keys.push(j.key.clone());
                }
                !idle
            });
            keys.iter().filter_map(|k| state.waiting.remove(k)).flatten().collect()
        };
        for done in abandoned {
            done(Err("no longer wanted".into()));
        }
    }

    /// Whether the photographer is being served right now: something other
    /// than spare-time work is waiting, or was asked for a moment ago. Work
    /// that should never get in their way checks this and stands aside.
    pub fn busy(&self) -> bool {
        let state = self.owner.shared.0.lock().unwrap();
        Instant::now() < state.quiet_until || state.queue.iter().any(|j| j.priority != Priority::Idle)
    }

    pub fn queued(&self) -> usize {
        self.owner.shared.0.lock().unwrap().queue.len()
    }

    /// Idle work still to do: waiting, plus under way.
    pub fn idle_remaining(&self) -> usize {
        let state = self.owner.shared.0.lock().unwrap();
        state.queue.iter().filter(|j| j.priority == Priority::Idle).count() + state.idle_running
    }

    fn work(shared: Arc<(Mutex<State<T>>, Condvar)>, only_now: bool) {
        let (lock, wake) = &*shared;
        loop {
            let job = {
                let mut state = lock.lock().unwrap();
                loop {
                    if state.stopped {
                        let queued = std::mem::take(&mut state.queue);
                        let abandoned: Vec<Done<T>> = queued.iter()
                            .filter_map(|job| state.waiting.remove(&job.key))
                            .flatten()
                            .collect();
                        drop(state);
                        // Work and callbacks can own pool handles or reenter
                        // the pool. Release them only after unlocking.
                        drop(queued);
                        for done in abandoned {
                            let _ = catch_unwind(AssertUnwindSafe(|| done(Err("preview pool stopped".into()))));
                        }
                        return;
                    }
                    let now = Instant::now();
                    let idle_has_room = !only_now && state.idle_running < state.idle_limit;
                    let idle_allowed = idle_has_room && now >= state.quiet_until;
                    let pick = state
                        .queue
                        .iter()
                        .enumerate()
                        .filter(|(_, j)| match j.priority {
                            Priority::Now => true,
                            Priority::Idle => idle_allowed,
                            _ => !only_now,
                        })
                        // Highest priority, then most recently asked for.
                        .min_by_key(|(_, j)| (j.priority, std::cmp::Reverse(j.seq)))
                        .map(|(i, _)| i);
                    if let Some(i) = pick {
                        let job = state.queue.swap_remove(i);
                        if job.priority == Priority::Idle {
                            state.idle_running += 1;
                        }
                        break job;
                    }
                    // Nothing to take. If idle work is only waiting out the
                    // quiet after a request, wake when that ends; nothing
                    // else is going to announce it.
                    let idle_waiting = idle_has_room && state.queue.iter().any(|j| j.priority == Priority::Idle);
                    state = if idle_waiting {
                        let pause = state.quiet_until.saturating_duration_since(now).max(Duration::from_millis(1));
                        wake.wait_timeout(state, pause).unwrap().0
                    } else {
                        wake.wait(state).unwrap()
                    };
                }
            };
            let was_idle = job.priority == Priority::Idle;

            // A decoder handed a corrupt file must not take the worker down
            // with it; the file fails and the thread carries on.
            let result = catch_unwind(AssertUnwindSafe(job.work))
                .unwrap_or_else(|_| Err("decoder panicked".into()))
                .map(Arc::new);

            let waiters = {
                let mut state = lock.lock().unwrap();
                if was_idle {
                    state.idle_running -= 1;
                }
                state.waiting.remove(&job.key).unwrap_or_default()
            };
            if was_idle {
                // A worker held back by the limit on idle work may now go.
                wake.notify_all();
            }
            for done in waiters {
                let _ = catch_unwind(AssertUnwindSafe(|| done(result.clone())));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;

    fn wait_for_workers<T>(shared: std::sync::Weak<(Mutex<State<T>>, Condvar)>) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while shared.strong_count() != 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(1));
        }
        assert!(shared.upgrade().is_none(), "workers retained the discarded pool");
    }

    #[test]
    fn dropping_the_last_handle_releases_worker_state() {
        let pool = Pool::<u32>::new(2);
        let shared = Arc::downgrade(&pool.owner.shared);
        drop(pool);
        wait_for_workers(shared);
    }

    #[test]
    fn dropping_a_handle_keeps_its_clone_usable() {
        let pool = Pool::<u32>::new(2);
        let clone = pool.clone();
        let shared = Arc::downgrade(&pool.owner.shared);
        drop(pool);

        let (tx, rx) = mpsc::channel();
        clone.submit("after-drop".into(), Priority::Now, || Ok(7), move |result| {
            tx.send(result.map(|value| *value)).unwrap();
        });
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), Ok(7));
        drop(clone);
        wait_for_workers(shared);
    }

    #[test]
    fn shutdown_rejects_pending_work_and_lets_running_work_finish() {
        let pool = Pool::<u32>::new(2);
        let clone = pool.clone();
        let shared = Arc::downgrade(&pool.owner.shared);
        let (release, gate) = mpsc::channel();
        let gate = Arc::new(Mutex::new(gate));
        let (ready, started) = mpsc::channel();
        let (tx, rx) = mpsc::channel();
        for i in 0..2 {
            let (gate, ready, tx) = (gate.clone(), ready.clone(), tx.clone());
            pool.submit(format!("running-{i}"), Priority::Now, move || {
                ready.send(()).unwrap();
                gate.lock().unwrap().recv().unwrap();
                Ok(7)
            }, move |result| tx.send(("running", result.map(|value| *value))).unwrap());
        }
        for _ in 0..2 {
            started.recv_timeout(Duration::from_secs(2)).unwrap();
        }

        let made = Arc::new(AtomicUsize::new(0));
        for _ in 0..2 {
            let (made, tx) = (made.clone(), tx.clone());
            pool.submit("queued".into(), Priority::Soon, move || {
                made.fetch_add(1, Ordering::SeqCst);
                Ok(9)
            }, move |result| tx.send(("queued", result.map(|value| *value))).unwrap());
        }
        pool.shutdown();
        clone.shutdown(); // Idempotent across handles.
        let later = tx.clone();
        clone.submit("future".into(), Priority::Now, || Ok(9), move |result| {
            later.send(("future", result.map(|value| *value))).unwrap();
        });
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), ("future", Err("preview pool stopped".into())));

        // Shutdown returned while both workers were still waiting here.
        for _ in 0..2 {
            release.send(()).unwrap();
        }
        let mut completed = Vec::new();
        for _ in 0..4 {
            completed.push(rx.recv_timeout(Duration::from_secs(2)).unwrap());
        }
        assert_eq!(completed.iter().filter(|(name, result)| *name == "running" && *result == Ok(7)).count(), 2);
        assert_eq!(completed.iter().filter(|(name, result)| *name == "queued" && *result == Err("preview pool stopped".into())).count(), 2);
        assert_eq!(made.load(Ordering::SeqCst), 0);
        drop(pool);
        drop(clone);
        wait_for_workers(shared);
    }

    #[test]
    fn a_completion_callback_can_drop_the_final_handle() {
        let pool = Pool::<u32>::new(2);
        let shared = Arc::downgrade(&pool.owner.shared);
        let callback_pool = pool.clone();
        let (release, gate) = mpsc::channel();
        let (tx, rx) = mpsc::channel();
        pool.submit("last-handle".into(), Priority::Now, move || {
            gate.recv().unwrap();
            Ok(7)
        }, move |result| {
            drop(callback_pool);
            tx.send(result.map(|value| *value)).unwrap();
        });
        drop(pool);
        release.send(()).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), Ok(7));
        wait_for_workers(shared);
    }

    #[test]
    fn a_shutdown_callback_can_reenter_and_drop_the_final_handle() {
        let pool = Pool::<u32>::new(2);
        let (open, reserved) = hold(&pool, 2);
        let shared = Arc::downgrade(&pool.owner.shared);
        let callback_pool = pool.clone();
        let (tx, rx) = mpsc::channel();
        pool.submit("queued".into(), Priority::Soon, || Ok(7), |_| panic!("failed cancelled waiter"));
        pool.submit("queued".into(), Priority::Soon, || Ok(7), move |result| {
            assert!(result.is_err());
            callback_pool.shutdown();
            callback_pool.submit("reentered".into(), Priority::Now, || Ok(9), move |result| {
                tx.send(result.map(|value| *value)).unwrap();
            });
        });
        pool.shutdown();
        drop(pool);
        open.send(()).unwrap();
        reserved.send(()).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), Err("preview pool stopped".into()));
        wait_for_workers(shared);
    }

    #[test]
    fn a_panicking_callback_does_not_strand_other_waiters() {
        let pool = Pool::<u32>::new(2);
        let (open, reserved) = hold(&pool, 2);
        pool.submit("shared".into(), Priority::Soon, || Ok(7), |_| panic!("failed waiter"));
        let (tx, rx) = mpsc::channel();
        pool.submit("shared".into(), Priority::Soon, || Ok(9), move |result| {
            tx.send(result.map(|value| *value)).unwrap();
        });
        open.send(()).unwrap();
        reserved.send(()).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), Ok(7));
    }

    /// Holds every worker until released, so a queue can be built up behind
    /// them and the order it drains in observed.
    ///
    /// Two gates rather than one, because the two kinds of worker are not
    /// interchangeable: the reserved one takes only `Now`. Returns
    /// `(general, reserved)`; a test that wants an exact order releases the
    /// general workers alone, leaving a single thread to do everything.
    fn hold(pool: &Pool<u32>, workers: usize) -> (mpsc::Sender<()>, mpsc::Sender<()>) {
        let (open_general, general) = mpsc::channel::<()>();
        let (open_reserved, reserved) = mpsc::channel::<()>();
        let general = Arc::new(Mutex::new(general));
        let reserved = Arc::new(Mutex::new(reserved));
        let (ready_tx, ready_rx) = mpsc::channel::<()>();
        for i in 0..workers {
            let (general, reserved) = (general.clone(), reserved.clone());
            let ready = ready_tx.clone();
            // `Now`, so the reserved worker is held as well.
            pool.submit(
                format!("hold-{i}"),
                Priority::Now,
                move || {
                    let is_reserved = std::thread::current().name() == Some("opencull-preview-0");
                    ready.send(()).ok();
                    let gate = if is_reserved { reserved } else { general };
                    // Taken and dropped at once, so several general workers
                    // can each be let go by one send apiece.
                    let waiting = gate.lock().unwrap().recv();
                    waiting.ok();
                    Ok(0)
                },
                |_| {},
            );
        }
        for _ in 0..workers {
            ready_rx.recv_timeout(Duration::from_secs(5)).expect("workers should all start");
        }
        (open_general, open_reserved)
    }

    #[test]
    fn everything_asked_for_is_made_and_reported() {
        let pool = Pool::<u32>::new(4);
        let (tx, rx) = mpsc::channel();
        for i in 0..200u32 {
            let tx = tx.clone();
            pool.submit(format!("k{i}"), Priority::Soon, move || Ok(i * 2), move |r| {
                tx.send(*r.unwrap()).unwrap();
            });
        }
        let mut got: Vec<u32> = (0..200).map(|_| rx.recv_timeout(Duration::from_secs(5)).unwrap()).collect();
        got.sort();
        assert_eq!(got, (0..200).map(|i| i * 2).collect::<Vec<_>>());
    }

    #[test]
    fn the_same_preview_asked_for_twice_is_made_once() {
        let pool = Pool::<u32>::new(2);
        let (open, open_reserved) = hold(&pool, 2);

        let made = Arc::new(AtomicUsize::new(0));
        let (tx, rx) = mpsc::channel();
        for _ in 0..5 {
            let made = made.clone();
            let tx = tx.clone();
            pool.submit(
                "same".into(),
                Priority::Soon,
                move || {
                    made.fetch_add(1, Ordering::SeqCst);
                    Ok(7)
                },
                move |r| tx.send(*r.unwrap()).unwrap(),
            );
        }
        assert_eq!(pool.queued(), 1);
        open.send(()).unwrap();
        open_reserved.send(()).unwrap();

        let answers: Vec<u32> = (0..5).map(|_| rx.recv_timeout(Duration::from_secs(5)).unwrap()).collect();
        assert_eq!(answers, vec![7; 5], "all five are told");
        assert_eq!(made.load(Ordering::SeqCst), 1, "but it was made once");
    }

    #[test]
    fn the_queue_drains_by_priority_then_newest_first() {
        // One general worker (plus the reserved one), so the order is exact.
        let pool = Pool::<u32>::new(2);
        let (open, open_reserved) = hold(&pool, 2);

        let (tx, rx) = mpsc::channel();
        let ask = |name: &'static str, priority| {
            let tx = tx.clone();
            pool.submit(name.into(), priority, move || Ok(0), move |_| tx.send(name).unwrap());
        };
        ask("later-old", Priority::Later);
        ask("soon-old", Priority::Soon);
        ask("soon-new", Priority::Soon);
        ask("later-new", Priority::Later);

        // Release only the general worker: the reserved one stays held, so
        // nothing here is made out of turn by it.
        open.send(()).unwrap();
        let order: Vec<&str> = (0..4).map(|_| rx.recv_timeout(Duration::from_secs(5)).unwrap()).collect();
        assert_eq!(order, vec!["soon-new", "soon-old", "later-new", "later-old"]);
        open_reserved.send(()).unwrap();
    }

    #[test]
    fn asking_again_at_a_higher_priority_moves_the_job_up() {
        let pool = Pool::<u32>::new(2);
        let (open, open_reserved) = hold(&pool, 2);

        let (tx, rx) = mpsc::channel();
        let ask = |name: &'static str, priority| {
            let tx = tx.clone();
            pool.submit(name.into(), priority, move || Ok(0), move |_| tx.send(name).unwrap());
        };
        ask("ahead", Priority::Later);
        ask("visible", Priority::Soon);
        // The photo that was only being looked ahead to is now on screen.
        ask("ahead", Priority::Now);

        // The general worker alone, so the order is the queue's and not a
        // race between two threads.
        open.send(()).unwrap();
        let order: Vec<&str> = (0..3).map(|_| rx.recv_timeout(Duration::from_secs(5)).unwrap()).collect();
        // Made first, and both of its askers told, before the other job.
        assert_eq!(order, vec!["ahead", "ahead", "visible"]);
        open_reserved.send(()).unwrap();
    }

    #[test]
    fn a_failure_or_a_panic_is_reported_and_the_pool_keeps_working() {
        let pool = Pool::<u32>::new(2);
        let (tx, rx) = mpsc::channel();
        let t = tx.clone();
        pool.submit("fails".into(), Priority::Soon, || Err("bad file".into()), move |r| t.send(r.map(|v| *v)).unwrap());
        let t = tx.clone();
        pool.submit("panics".into(), Priority::Soon, || panic!("corrupt"), move |r| t.send(r.map(|v| *v)).unwrap());

        let mut errors: Vec<String> =
            (0..2).map(|_| rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap_err()).collect();
        errors.sort();
        assert_eq!(errors, vec!["bad file", "decoder panicked"]);

        // Still alive.
        pool.submit("after".into(), Priority::Soon, || Ok(9), move |r| tx.send(r.map(|v| *v)).unwrap());
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), Ok(9));
    }

    #[test]
    fn idle_work_waits_out_the_quiet_after_a_request_then_runs() {
        let pool = Pool::<u32>::new(4);
        let (tx, rx) = mpsc::channel();

        // A request, which starts the quiet period…
        let t = tx.clone();
        pool.submit("asked".into(), Priority::Soon, || Ok(1), move |_| t.send(("asked", Instant::now())).unwrap());
        // …and idle work submitted right behind it.
        let submitted = Instant::now();
        let t = tx.clone();
        pool.submit("ahead".into(), Priority::Idle, || Ok(2), move |_| t.send(("ahead", Instant::now())).unwrap());

        let first = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let second = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!((first.0, second.0), ("asked", "ahead"));
        // Idle work held off for the whole quiet period, with workers free.
        assert!(second.1.duration_since(submitted) >= QUIET, "ran after only {:?}", second.1.duration_since(submitted));
        assert_eq!(pool.idle_remaining(), 0);
    }

    #[test]
    fn idle_work_is_held_to_its_share_of_the_workers() {
        // Five workers: one reserved, four general, so two may be idle-working.
        let pool = Pool::<u32>::new(5);
        let running = Arc::new(AtomicUsize::new(0));
        let most = Arc::new(AtomicUsize::new(0));
        let (tx, rx) = mpsc::channel();
        for i in 0..12 {
            let (running, most, tx) = (running.clone(), most.clone(), tx.clone());
            pool.submit(
                format!("idle-{i}"),
                Priority::Idle,
                move || {
                    let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                    most.fetch_max(now, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(15));
                    running.fetch_sub(1, Ordering::SeqCst);
                    Ok(0)
                },
                move |_| tx.send(()).unwrap(),
            );
        }
        for _ in 0..12 {
            rx.recv_timeout(Duration::from_secs(10)).unwrap();
        }
        assert_eq!(most.load(Ordering::SeqCst), 2, "never more than half the general workers");
    }

    #[test]
    fn idle_work_resumes_after_a_request_interrupts_it() {
        let pool = Pool::<u32>::with_idle_limit(5, 2);
        let (tx, rx) = mpsc::channel();
        for i in 0..20 {
            let tx = tx.clone();
            pool.submit(
                format!("idle-{i}"),
                Priority::Idle,
                || {
                    std::thread::sleep(Duration::from_millis(20));
                    Ok(0)
                },
                move |_| tx.send(()).unwrap(),
            );
        }
        // Let it get going, then ask for something — as a photographer
        // jumping to a photo partway through the folder being prepared does.
        std::thread::sleep(Duration::from_millis(60));
        assert!(pool.idle_remaining() > 0, "the interruption has to land mid-run to mean anything");
        let t = tx.clone();
        pool.submit("wanted".into(), Priority::Now, || Ok(1), move |_| t.send(()).unwrap());

        // The request, and then every one of the idle jobs, with nothing
        // further arriving to wake the workers up.
        for done in 0..21 {
            rx.recv_timeout(Duration::from_secs(5)).unwrap_or_else(|_| panic!("stalled after {done} of 21"));
        }
        assert_eq!(pool.idle_remaining(), 0);
    }

    #[test]
    fn clearing_idle_work_leaves_everything_else_queued() {
        let pool = Pool::<u32>::new(2);
        let (open, open_reserved) = hold(&pool, 2);
        let (tx, rx) = mpsc::channel();
        for (name, priority) in [("ahead-1", Priority::Idle), ("wanted", Priority::Soon), ("ahead-2", Priority::Idle)] {
            let tx = tx.clone();
            pool.submit(name.into(), priority, || Ok(1), move |r| tx.send((name, r.is_ok())).unwrap());
        }
        assert_eq!(pool.idle_remaining(), 2);
        pool.clear_idle();
        assert_eq!((pool.idle_remaining(), pool.queued()), (0, 1));

        // Both idle askers hear it was abandoned; the real request is made.
        let mut heard: Vec<(&str, bool)> = (0..2).map(|_| rx.recv_timeout(Duration::from_secs(5)).unwrap()).collect();
        heard.sort();
        assert_eq!(heard, vec![("ahead-1", false), ("ahead-2", false)]);
        open.send(()).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), ("wanted", true));
        open_reserved.send(()).unwrap();
    }

    #[test]
    fn clearing_tells_whoever_was_waiting() {
        let pool = Pool::<u32>::new(2);
        let (open, open_reserved) = hold(&pool, 2);
        let (tx, rx) = mpsc::channel();
        for i in 0..3 {
            let tx = tx.clone();
            pool.submit(format!("k{i}"), Priority::Soon, || Ok(1), move |r| tx.send(r.is_err()).unwrap());
        }
        pool.clear_queued();
        assert_eq!(pool.queued(), 0);
        for _ in 0..3 {
            assert!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), "each waiter hears it was abandoned");
        }
        open.send(()).unwrap();
        open_reserved.send(()).unwrap();
    }
}

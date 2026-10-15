//! One bounded GPU worker owns all CUDA model sessions. CPU decoding stays parallel.
use std::collections::HashMap;
use std::sync::{mpsc::{self, SyncSender}, OnceLock};
use std::panic::{catch_unwind, AssertUnwindSafe};
use ort::session::Session;
use super::{acceleration, onnx::{self, OwnedInput}};

type Output = Vec<(Vec<usize>, Vec<f32>)>;
pub(super) struct Reply {
    pub inputs: Vec<OwnedInput>,
    pub result: Result<Output, String>,
}
struct Job {
    bytes: &'static [u8],
    inputs: Vec<OwnedInput>,
    outputs: Vec<String>,
    done: SyncSender<Reply>,
}
static WORKER: OnceLock<Result<SyncSender<Job>, String>> = OnceLock::new();

fn start() -> Result<SyncSender<Job>, String> {
    // At most one queued job; existing analysis callers apply backpressure.
    let (send, receive) = mpsc::sync_channel::<Job>(1);
    std::thread::Builder::new().name("opencull-cuda".into()).spawn(move || {
        let mut sessions = HashMap::<usize, Session>::new();
        for job in receive {
            let result = if acceleration::enabled() {
                catch_unwind(AssertUnwindSafe(|| {
                    let key = job.bytes.as_ptr() as usize;
                    if let std::collections::hash_map::Entry::Vacant(entry) = sessions.entry(key) {
                        let builder = onnx::builder()?
                            .with_execution_providers([opencull_cuda::provider()]).map_err(|e| e.to_string())?
                            .with_config_entry("session.disable_cpu_ep_fallback", "1").map_err(|e| e.to_string())?;
                        let mut builder = builder;
                        entry.insert(builder.commit_from_memory(job.bytes).map_err(|e| e.to_string())?);
                        eprintln!("[ai] CUDA model ready ({} shared sessions)", sessions.len());
                    }
                    onnx::evaluate(sessions.get_mut(&key).expect("model opened"), &job.inputs, &job.outputs,
                        |out| out.iter().map(|(shape, data)| (shape.clone(), data.to_vec())).collect())
                })).unwrap_or_else(|_| Err("CUDA worker panicked".into()))
            } else { Err("CUDA disabled after an earlier failure".into()) };
            if let Err(reason) = &result {
                sessions.clear();
                acceleration::fallback(reason.clone());
            }
            let _ = job.done.send(Reply { inputs: job.inputs, result });
        }
    }).map_err(|e| e.to_string())?;
    Ok(send)
}

pub(super) fn run(bytes: &'static [u8], inputs: Vec<OwnedInput>, outputs: Vec<String>) -> Result<Reply, String> {
    let worker = match WORKER.get_or_init(start) {
        Ok(worker) => worker,
        Err(error) => { acceleration::fallback(error.clone()); return Ok(Reply { inputs, result: Err(error.clone()) }); }
    };
    let (done, receive) = mpsc::sync_channel(1);
    if let Err(error) = worker.send(Job { bytes, inputs, outputs, done }) {
        let reason = "CUDA worker stopped".to_string();
        acceleration::fallback(reason.clone());
        return Ok(Reply { inputs: error.0.inputs, result: Err(reason) });
    }
    receive.recv().map_err(|_| "CUDA worker stopped before returning its input".into())
}

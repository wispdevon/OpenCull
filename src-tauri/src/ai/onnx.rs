//! Running a model file. CPU sessions stay thread-local; CUDA uses one worker.
use ort::session::{
    builder::{GraphOptimizationLevel, SessionBuilder},
    Session,
};
use ort::value::TensorRef;
use std::cell::{Cell, RefCell};

thread_local! {
    static ISOLATED_CPU: Cell<bool> = const { Cell::new(false) };
    static ISOLATED_BENCHMARK: Cell<bool> = const { Cell::new(false) };
    static BENCHMARK_CUDA: Cell<bool> = const { Cell::new(false) };
    static BENCHMARK_CUDA_FAILED: Cell<bool> = const { Cell::new(false) };
    static BENCHMARK_FAILURE_KIND: Cell<Option<&'static str>> = const { Cell::new(None) };
    static BENCHMARK_USAGE: Cell<BenchmarkUsage> = const {
        Cell::new(BenchmarkUsage {
            cuda_calls: 0,
            cpu_calls: 0,
            cpu_fallback_calls: 0,
            failure_kind: None,
        })
    };
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct BenchmarkUsage {
    pub cuda_calls: u64,
    pub cpu_calls: u64,
    pub cpu_fallback_calls: u64,
    pub failure_kind: Option<&'static str>,
}

impl BenchmarkUsage {
    pub(crate) fn since(self, earlier: Self) -> Self {
        let cpu_fallback_calls = self.cpu_fallback_calls.saturating_sub(earlier.cpu_fallback_calls);
        Self {
            cuda_calls: self.cuda_calls.saturating_sub(earlier.cuda_calls),
            cpu_calls: self.cpu_calls.saturating_sub(earlier.cpu_calls),
            cpu_fallback_calls,
            failure_kind: (cpu_fallback_calls > 0).then_some(self.failure_kind).flatten(),
        }
    }
}

/// Uses a private CUDA session cache and fallback latch for disposable benchmark inference.
pub(crate) fn with_isolated_benchmark<T>(try_cuda: bool, operation: impl FnOnce() -> T) -> (T, BenchmarkUsage) {
    assert!(
        !ISOLATED_BENCHMARK.get(),
        "isolated benchmark scopes cannot be nested"
    );
    struct Restore {
        cpu: bool,
        benchmark: bool,
        cuda: bool,
        failed: bool,
        failure_kind: Option<&'static str>,
        usage: BenchmarkUsage,
    }
    impl Drop for Restore {
        fn drop(&mut self) {
            #[cfg(all(feature = "cuda", target_os = "linux", target_arch = "x86_64"))]
            super::cuda::clear_isolated_sessions();
            ISOLATED_CPU.set(self.cpu);
            ISOLATED_BENCHMARK.set(self.benchmark);
            BENCHMARK_CUDA.set(self.cuda);
            BENCHMARK_CUDA_FAILED.set(self.failed);
            BENCHMARK_FAILURE_KIND.set(self.failure_kind);
            BENCHMARK_USAGE.set(self.usage);
        }
    }
    let _restore = Restore {
        cpu: ISOLATED_CPU.replace(false),
        benchmark: ISOLATED_BENCHMARK.replace(true),
        cuda: BENCHMARK_CUDA.replace(try_cuda),
        failed: BENCHMARK_CUDA_FAILED.replace(false),
        failure_kind: BENCHMARK_FAILURE_KIND.replace(None),
        usage: BENCHMARK_USAGE.replace(BenchmarkUsage::default()),
    };
    let result = operation();
    let usage = BENCHMARK_USAGE.get();
    (result, usage)
}

pub(crate) fn benchmark_usage() -> BenchmarkUsage {
    BENCHMARK_USAGE.get()
}

fn record_benchmark_cpu(fallback_kind: Option<&'static str>) {
    let mut usage = BENCHMARK_USAGE.get();
    usage.cpu_calls += 1;
    if let Some(kind) = fallback_kind {
        usage.cpu_fallback_calls += 1;
        usage.failure_kind.get_or_insert(kind);
    }
    BENCHMARK_USAGE.set(usage);
}

fn record_benchmark_failure(reason: &str) -> &'static str {
    let kind = super::acceleration::failure_kind(reason);
    BENCHMARK_FAILURE_KIND.set(Some(kind));
    BENCHMARK_CUDA_FAILED.set(true);
    kind
}

/// Keep disposable benchmark inference away from live GPU caches and fallback
/// state. The policy applies only to this worker and is restored on unwind.
pub(crate) fn with_isolated_cpu<T>(operation: impl FnOnce() -> T) -> T {
    struct Restore(bool);
    impl Drop for Restore {
        fn drop(&mut self) { ISOLATED_CPU.set(self.0); }
    }
    let _restore = Restore(ISOLATED_CPU.replace(true));
    operation()
}

/// One input to a model: its name, its shape, and its numbers.
pub type Input<'a> = (&'a str, Vec<usize>, Vec<f32>);
pub(super) type OwnedInput = super::file_backend::Input;

pub(super) fn builder() -> Result<SessionBuilder, String> {
    let builder = Session::builder().map_err(|e| e.to_string())?;
    let builder = builder
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| e.to_string())?;
    builder.with_intra_threads(1).map_err(|e| e.to_string())
}
fn open(bytes: &[u8]) -> Result<Session, String> {
    builder()?
        .commit_from_memory(bytes)
        .map_err(|e| format!("could not load a model: {e}"))
}

/// Borrows caller-owned tensors while running, avoiding an extra image copy.
pub(super) fn evaluate<T>(
    session: &mut Session,
    inputs: &[OwnedInput],
    outputs: &[String],
    read: impl FnOnce(&[(Vec<usize>, &[f32])]) -> T,
) -> Result<T, String> {
    let mut given = Vec::with_capacity(inputs.len());
    for (name, shape, data) in inputs {
        let tensor = TensorRef::from_array_view((shape.clone(), data.as_slice()))
            .map_err(|e| e.to_string())?;
        given.push((name.as_str(), tensor));
    }
    let results = session
        .run(given)
        .map_err(|e| format!("a model failed to run: {e}"))?;
    let mut taken = Vec::with_capacity(outputs.len());
    for name in outputs {
        let (shape, data) = results[name.as_str()]
            .try_extract_tensor::<f32>()
            .map_err(|e| e.to_string())?;
        taken.push((
            shape.iter().map(|d| *d as usize).collect::<Vec<usize>>(),
            data,
        ));
    }
    Ok(read(&taken))
}

/// Runs `bytes` on this thread, or on the shared CUDA worker when enabled.
pub fn run<T>(
    slot: &'static std::thread::LocalKey<RefCell<Option<Session>>>,
    bytes: &'static [u8],
    inputs: Vec<Input>,
    outputs: &[&str],
    read: impl FnOnce(&[(Vec<usize>, &[f32])]) -> T,
) -> Result<T, String> {
    let (inputs, outputs) = owned(inputs, outputs);
    run_owned(slot, bytes, inputs, outputs, read, false)
}

/// The finder: on a Mac, on the graphics chip while that is the quicker;
/// otherwise as `run`.
pub fn run_finder<T>(
    slot: &'static std::thread::LocalKey<RefCell<Option<Session>>>,
    bytes: &'static [u8],
    inputs: Vec<Input>,
    outputs: &[&str],
    read: impl FnOnce(&[(Vec<usize>, &[f32])]) -> T,
) -> Result<T, String> {
    run_finder_with_cpu_fallback_policy(slot, bytes, inputs, outputs, read, false)
}

/// Like `run_finder`, while allowing CUDA to place unsupported graph nodes on the CPU.
pub fn run_finder_with_cpu_fallback<T>(
    slot: &'static std::thread::LocalKey<RefCell<Option<Session>>>,
    bytes: &'static [u8],
    inputs: Vec<Input>,
    outputs: &[&str],
    read: impl FnOnce(&[(Vec<usize>, &[f32])]) -> T,
) -> Result<T, String> {
    run_finder_with_cpu_fallback_policy(slot, bytes, inputs, outputs, read, true)
}

fn run_finder_with_cpu_fallback_policy<T>(
    slot: &'static std::thread::LocalKey<RefCell<Option<Session>>>,
    bytes: &'static [u8],
    inputs: Vec<Input>,
    outputs: &[&str],
    read: impl FnOnce(&[(Vec<usize>, &[f32])]) -> T,
    allow_cpu_ep_fallback: bool,
) -> Result<T, String> {
    let (inputs, outputs) = owned(inputs, outputs);
    if ISOLATED_CPU.get() || ISOLATED_BENCHMARK.get() {
        return run_owned(slot, bytes, inputs, outputs, read, allow_cpu_ep_fallback);
    }
    #[cfg(target_os = "macos")]
    let (inputs, read) = match super::gpu::run(bytes, inputs, &outputs, read) {
        Ok(done) => return done,
        Err(back) => back,
    };
    let done = run_owned(
        slot,
        bytes,
        inputs,
        outputs,
        read,
        allow_cpu_ep_fallback,
    );
    #[cfg(target_os = "macos")]
    super::gpu::finished();
    done
}

fn owned(inputs: Vec<Input>, outputs: &[&str]) -> (Vec<OwnedInput>, Vec<String>) {
    let inputs = inputs
        .into_iter()
        .map(|(name, shape, data)| (name.to_owned(), shape, data))
        .collect::<Vec<_>>();
    (inputs, outputs.iter().map(|s| (*s).to_owned()).collect())
}

fn run_owned<T>(
    slot: &'static std::thread::LocalKey<RefCell<Option<Session>>>,
    bytes: &'static [u8],
    inputs: Vec<OwnedInput>,
    outputs: Vec<String>,
    read: impl FnOnce(&[(Vec<usize>, &[f32])]) -> T,
    allow_cpu_ep_fallback: bool,
) -> Result<T, String> {
    #[cfg(all(feature = "cuda", target_os = "linux", target_arch = "x86_64"))]
    let inputs = if ISOLATED_BENCHMARK.get() && ISOLATED_CPU.get() {
        record_benchmark_cpu(None);
        inputs
    } else if ISOLATED_BENCHMARK.get() {
        let fallback_kind = if BENCHMARK_CUDA.get() {
            if BENCHMARK_CUDA_FAILED.get() {
                BENCHMARK_FAILURE_KIND.get()
            } else {
                match super::cuda::run_isolated(bytes, &inputs, &outputs, allow_cpu_ep_fallback) {
                    Ok(result) => {
                        let mut usage = BENCHMARK_USAGE.get();
                        usage.cuda_calls += 1;
                        BENCHMARK_USAGE.set(usage);
                        return Ok(read(
                            &result
                                .iter()
                                .map(|(shape, data)| (shape.clone(), data.as_slice()))
                                .collect::<Vec<_>>(),
                        ));
                    }
                    Err(reason) => Some(record_benchmark_failure(&reason)),
                }
            }
        } else {
            None
        };
        record_benchmark_cpu(fallback_kind);
        inputs
    } else if !ISOLATED_CPU.get() && super::acceleration::enabled() {
        let reply = if allow_cpu_ep_fallback {
            super::cuda::run_with_cpu_fallback(bytes, inputs, outputs.clone())?
        } else {
            super::cuda::run(bytes, inputs, outputs.clone())?
        };
        match reply.result {
            Ok(result) => {
                return Ok(read(
                    &result
                        .iter()
                        .map(|(shape, data)| (shape.clone(), data.as_slice()))
                        .collect::<Vec<_>>(),
                ))
            }
            Err(_) => reply.inputs,
        }
    } else {
        inputs
    };
    #[cfg(not(all(feature = "cuda", target_os = "linux", target_arch = "x86_64")))]
    {
        let _ = allow_cpu_ep_fallback;
        if ISOLATED_BENCHMARK.get() {
            record_benchmark_cpu(None);
        }
    }
    slot.with(|cell| {
        let mut cell = cell.borrow_mut();
        if cell.is_none() {
            *cell = Some(open(bytes)?);
        }
        evaluate(
            cell.as_mut().expect("model opened"),
            &inputs,
            &outputs,
            read,
        )
    })
}

#[cfg(test)]
mod isolation_tests {
    use super::*;

    #[test]
    fn cpu_scope_is_nested_thread_local_and_restored_after_unwind() {
        assert!(!ISOLATED_CPU.get());
        with_isolated_cpu(|| {
            assert!(ISOLATED_CPU.get());
            with_isolated_cpu(|| assert!(ISOLATED_CPU.get()));
            assert!(ISOLATED_CPU.get());
            assert!(!std::thread::spawn(|| ISOLATED_CPU.get()).join().unwrap());
        });
        assert!(!ISOLATED_CPU.get());
        let result = std::panic::catch_unwind(|| with_isolated_cpu(|| panic!("test unwind")));
        assert!(result.is_err());
        assert!(!ISOLATED_CPU.get());
    }

    #[test]
    fn benchmark_scope_restores_usage_and_local_fallback_after_unwind() {
        let result = std::panic::catch_unwind(|| {
            with_isolated_benchmark(true, || {
                assert!(ISOLATED_BENCHMARK.get());
                assert!(BENCHMARK_CUDA.get());
                let kind = record_benchmark_failure("CUDA out of memory");
                record_benchmark_cpu(Some(kind));
                panic!("force benchmark scope unwind");
            });
        });
        assert!(result.is_err());
        assert!(!ISOLATED_BENCHMARK.get());
        assert!(!BENCHMARK_CUDA.get());
        assert!(!BENCHMARK_CUDA_FAILED.get());
        assert_eq!(BENCHMARK_FAILURE_KIND.get(), None);
        assert_eq!(benchmark_usage(), BenchmarkUsage::default());
    }

    #[test]
    fn forced_cpu_scope_wins_inside_benchmark_and_nested_benchmarks_are_rejected() {
        with_isolated_benchmark(true, || {
            with_isolated_cpu(|| {
                assert!(ISOLATED_CPU.get());
                assert!(ISOLATED_BENCHMARK.get());
            });
            assert!(!ISOLATED_CPU.get());
            let nested = std::panic::catch_unwind(|| with_isolated_benchmark(false, || {}));
            assert!(nested.is_err());
            assert!(ISOLATED_BENCHMARK.get());
            assert!(BENCHMARK_CUDA.get());
        });
        assert!(!ISOLATED_BENCHMARK.get());
    }
}

#[cfg(all(test, feature = "cuda", target_os = "linux", target_arch = "x86_64"))]
mod cuda_tests {
    use super::*;
    thread_local!(static ISOLATED_TEST_SESSION: RefCell<Option<Session>> = const { RefCell::new(None) });
    #[test]
    #[ignore = "requires OPENCULL_AI=cuda, NVIDIA GPU, CUDA 13 and cuDNN 9"]
    fn advanced_yolo_runs_with_cuda_and_cpu_ep_fallback() {
        assert!(
            crate::ai::acceleration::enabled(),
            "run with OPENCULL_AI=cuda"
        );
        let model = include_bytes!("../../models/faces-turning.onnx");
        let shape = vec![1, 3, 640, 640];
        let data = (0..shape.iter().product::<usize>())
            .map(|i| ((i * 19 % 251) as f32) / 250.0)
            .collect::<Vec<_>>();
        let inputs = vec![("images".to_owned(), shape, data)];
        let outputs = vec!["output0".to_owned()];

        let mut cpu_session = builder().unwrap().commit_from_memory(model).unwrap();
        let cpu = evaluate(&mut cpu_session, &inputs, &outputs, |values| {
            values
                .iter()
                .map(|(shape, data)| (shape.clone(), data.to_vec()))
                .collect::<Vec<_>>()
        })
        .unwrap();
        let gpu = crate::ai::cuda::run_with_cpu_fallback(model, inputs, outputs)
            .unwrap()
            .result
            .unwrap();

        assert_eq!(cpu.len(), gpu.len());
        for ((cpu_shape, cpu_values), (gpu_shape, gpu_values)) in cpu.iter().zip(&gpu) {
            assert_eq!(cpu_shape, gpu_shape);
            assert_eq!(cpu_values.len(), gpu_values.len());
            for (cpu_value, gpu_value) in cpu_values.iter().zip(gpu_values) {
                assert!(
                    (cpu_value - gpu_value).abs() <= 0.001 + 0.001 * cpu_value.abs(),
                    "CPU {cpu_value}, CUDA {gpu_value}"
                );
            }
        }
        assert!(
            crate::ai::acceleration::failure().is_none(),
            "CUDA silently fell back"
        );
    }

    #[test]
    #[ignore = "requires OPENCULL_AI=cuda, NVIDIA GPU, CUDA 13 and cuDNN 9"]
    fn isolated_benchmark_cuda_matches_cpu_without_touching_global_fallback() {
        assert!(
            crate::ai::acceleration::requested(),
            "run with OPENCULL_AI=cuda"
        );
        let model = include_bytes!("../../models/faces-turning.onnx");
        let shape = vec![1, 3, 640, 640];
        let data = (0..shape.iter().product::<usize>())
            .map(|i| ((i * 19 % 251) as f32) / 250.0)
            .collect::<Vec<_>>();
        let inputs = vec![("images".to_owned(), shape, data)];

        let global_failure_before = crate::ai::acceleration::failure();
        let (cpu, cpu_usage) = with_isolated_benchmark(false, || {
            run_finder_with_cpu_fallback(
                &ISOLATED_TEST_SESSION,
                model,
                vec![("images", vec![1, 3, 640, 640], inputs[0].2.clone())],
                &["output0"],
                |values| {
                    values
                        .iter()
                        .map(|(shape, data)| (shape.clone(), data.to_vec()))
                        .collect::<Vec<_>>()
                },
            )
            .unwrap()
        });
        assert_eq!(cpu_usage.cuda_calls, 0);
        let (gpu, usage) = with_isolated_benchmark(true, || {
            run_finder_with_cpu_fallback(
                &ISOLATED_TEST_SESSION,
                model,
                vec![("images", vec![1, 3, 640, 640], inputs[0].2.clone())],
                &["output0"],
                |values| {
                    values
                        .iter()
                        .map(|(shape, data)| (shape.clone(), data.to_vec()))
                        .collect::<Vec<_>>()
                },
            )
            .unwrap()
        });
        assert_eq!(global_failure_before, crate::ai::acceleration::failure());
        assert!(usage.cuda_calls > 0, "benchmark did not complete CUDA inference: {usage:?}");
        assert_eq!(gpu.len(), cpu.len());
        for ((cpu_shape, cpu_values), (gpu_shape, gpu_values)) in cpu.iter().zip(&gpu) {
            assert_eq!(cpu_shape, gpu_shape);
            assert_eq!(cpu_values.len(), gpu_values.len());
            for (cpu_value, gpu_value) in cpu_values.iter().zip(gpu_values) {
                assert!(
                    (cpu_value - gpu_value).abs() <= 0.001 + 0.001 * cpu_value.abs(),
                    "CPU {cpu_value}, CUDA {gpu_value}"
                );
            }
        }
    }

    #[test]
    #[ignore = "requires OPENCULL_AI=cuda, NVIDIA GPU, CUDA 13 and cuDNN 9"]
    fn concurrent_callers_share_cuda_models_and_match_cpu() {
        assert!(
            crate::ai::acceleration::enabled(),
            "run with OPENCULL_AI=cuda"
        );
        let jobs = (0..4)
            .map(|_| {
                std::thread::spawn(|| {
                    for n in [1, 8] {
                        let cases: Vec<(&'static [u8], Vec<(&str, Vec<usize>)>, Vec<&str>)> = vec![
                            (
                                include_bytes!("../../models/finder.onnx"),
                                vec![("input", vec![1, 3, 64, 96])],
                                vec!["cls_8", "bbox_8", "kps_8"],
                            ),
                            (
                                include_bytes!("../../models/judge.onnx"),
                                vec![
                                    ("face", vec![n, 3, 224, 224]),
                                    ("eyes", vec![n, 3, 64, 224]),
                                ],
                                vec!["validity", "eyes_state", "quality"],
                            ),
                            (
                                include_bytes!("../../models/eyes.onnx"),
                                vec![("pair", vec![n, 3, 64, 192]), ("turn", vec![n, 1])],
                                vec!["away", "open", "down"],
                            ),
                            (
                                include_bytes!("../../models/mouth.onnx"),
                                vec![("band", vec![n, 3, 64, 128])],
                                vec!["expression"],
                            ),
                        ];
                        for (bytes, shapes, outputs) in cases {
                            let inputs = shapes
                                .into_iter()
                                .map(|(name, shape)| {
                                    let data = (0..shape.iter().product())
                                        .map(|i: usize| {
                                            if name == "turn" {
                                                0.0
                                            } else {
                                                (i % 251) as f32
                                            }
                                        })
                                        .collect();
                                    (name.to_owned(), shape, data)
                                })
                                .collect::<Vec<_>>();
                            let outputs =
                                outputs.into_iter().map(str::to_owned).collect::<Vec<_>>();
                            let cpu =
                                evaluate(&mut open(bytes).unwrap(), &inputs, &outputs, |out| {
                                    out.iter()
                                        .map(|(s, d)| (s.clone(), d.to_vec()))
                                        .collect::<Vec<_>>()
                                })
                                .unwrap();
                            let gpu = crate::ai::cuda::run(bytes, inputs, outputs)
                                .unwrap()
                                .result
                                .unwrap();
                            assert_eq!(cpu.len(), gpu.len());
                            for ((cs, cd), (gs, gd)) in cpu.iter().zip(gpu.iter()) {
                                assert_eq!(cs, gs);
                                for (a, b) in cd.iter().zip(gd.iter()) {
                                    assert!(
                                        (a - b).abs() <= 0.001 + 0.001 * a.abs(),
                                        "CPU {a}, CUDA {b}"
                                    );
                                }
                            }
                        }
                    }
                })
            })
            .collect::<Vec<_>>();
        for job in jobs {
            job.join().unwrap();
        }
        assert!(
            crate::ai::acceleration::failure().is_none(),
            "CUDA silently fell back"
        );
    }
}

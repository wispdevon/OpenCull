//! The CUDA provider, isolated from macOS and ordinary CPU builds.
pub fn provider() -> ort::ep::ExecutionProviderDispatch {
    ort::ep::CUDA::default()
        .with_arena_extend_strategy(ort::ep::ArenaExtendStrategy::SameAsRequested)
        .with_tf32(false)
        .build()
        .error_on_failure()
}

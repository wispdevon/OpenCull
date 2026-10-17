import type { AiAccelerationInfo } from "./api";

export function accelerationError(info: AiAccelerationInfo | null) {
  if (!info?.requested || info.enabled || !info.failure) return null;

  const title =
    info.failureKind === "memory"
      ? "Not enough GPU memory (VRAM)"
      : info.failureKind === "unavailable"
        ? "GPU busy or unavailable"
        : "GPU acceleration failed";

  const body =
    info.failureKind === "memory"
      ? "AI has switched to CPU processing. Close other GPU-heavy apps, then restart Culltivate with CUDA to retry."
      : info.failureKind === "unavailable"
        ? "AI has switched to CPU processing. Check that the NVIDIA driver and CUDA runtime are available, then restart Culltivate with CUDA."
        : "AI has switched to CPU processing. See technical details for the CUDA error.";

  return {
    title,
    body,
    details: info.failure,
  };
}

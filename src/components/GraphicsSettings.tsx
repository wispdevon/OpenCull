import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "@/lib/api";

export function GraphicsSettings() {
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      const info = inTauri ? await invoke<{requested:string;platform:string;dmabufDisabled:boolean;softwareForced:boolean;sharedMemoryTransport:boolean}>("graphics_info") : null;
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl");
      let renderer = "WebGL unavailable";
      if (gl) {
        const debug = gl.getExtension("WEBGL_debug_renderer_info");
        renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
      setResult(`${info ? `${info.platform} · requested profile: ${info.requested}${info.sharedMemoryTransport ? " · shared-memory transport" : ""}${info.dmabufDisabled ? " · DMA-BUF disabled" : ""}${info.softwareForced ? " · software forced" : ""}` : "Browser renderer"}\n${renderer}`);
    } catch(e) { setResult(`Renderer check failed: ${String(e)}`); }
    finally { setBusy(false); }
  };
  return <fieldset className="space-y-3 rounded-lg border border-border p-4">
    <legend className="px-1 text-sm font-semibold">Graphics acceleration</legend>
    <p className="text-xs leading-relaxed text-muted-foreground">The desktop webview renders the interface and photo transformations. The check reports the WebGL device name, which the browser may mask for privacy. Image decoding and AI can still use the CPU.</p>
    <button type="button" disabled={busy} onClick={() => void check()} className="min-h-10 rounded-md border border-input px-3 text-xs">{busy ? "Checking…" : "Check renderer"}</button>
    {result && <output aria-live="polite" className="block whitespace-pre-wrap break-words text-xs leading-relaxed">{result}</output>}
  </fieldset>;
}

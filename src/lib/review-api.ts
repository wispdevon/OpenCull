import { Channel, invoke } from "@tauri-apps/api/core";
import { inTauri, type Shipped } from "./api";
import type { ReviewSession } from "./review";
import type { Photo } from "./types";
let saving = Promise.resolve();
export function saveReview(review: ReviewSession): Promise<void> {
  const snapshot = JSON.parse(JSON.stringify(review));
  if (!inTauri) { localStorage.setItem("opencull.session.latest", JSON.stringify(snapshot)); return Promise.resolve(); }
  saving = saving.catch(() => {}).then(() => invoke("review_save", { value: snapshot }));
  return saving;
}
export async function loadReview(): Promise<ReviewSession | null> {
  const value: ReviewSession | null = inTauri ? await invoke("review_load") : JSON.parse(localStorage.getItem("opencull.session.latest") ?? "null");
  if (value && (value.version !== 1 || !Array.isArray(value.items) || !Array.isArray(value.sources) || typeof value.decisions !== "object")) throw new Error("Saved card session is not supported");
  return value;
}
export async function copyReview(items: Photo[], destination: string, sources: string[], onProgress: (done: number) => void): Promise<Shipped & { completed: Record<string, string> }> {
  if (!inTauri) throw new Error("Copying requires the desktop application");
  const progress = new Channel<number>(); progress.onmessage = onProgress;
  return invoke("review_copy", { items: items.map((p) => ({ path: p.path, display: p.display, marks: { rating: p.rating, flag: p.flag, color: p.color }, framing: p.framing, upright: [p.fullWidth, p.fullHeight] })), destination, sources, progress });
}

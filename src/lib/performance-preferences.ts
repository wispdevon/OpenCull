import { load, save } from "./prefs";

export const DEFAULT_PERF_NTFY_URL = "https://ntfy.sh/culltivate-perf";
export const DEFAULT_LOGS_NTFY_URL = "https://ntfy.sh/culltivate-logs";

/** Local obfuscation only: never bundle a configured credential in source. */
export function saveWebhookUrl(value: string): void {
  const bytes = new TextEncoder().encode(value);
  save("performanceWebhookEncoded", btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")));
  save("performanceWebhookUrl", "");
}

export function loadWebhookUrl(): string {
  const encoded = load("performanceWebhookEncoded", "");
  if (encoded) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))); }
    catch { return ""; }
  }
  const legacy = load("performanceWebhookUrl", "");
  if (legacy) saveWebhookUrl(legacy);
  return legacy;
}

/** An installation alias, unrelated to the computer's hostname or hardware. */
export function getSystemId(): string {
  const existing = load("performanceSystemId", "");
  if (/^[a-z]+-[a-z]+-\d{6}$/.test(existing)) return existing;
  const adjectives = ["amber", "bright", "calm", "clear", "gentle", "mellow", "quiet", "swift"];
  const animals = ["badger", "falcon", "finch", "fox", "heron", "otter", "panda", "wren"];
  const random = crypto.getRandomValues(new Uint32Array(3));
  const id = `${adjectives[random[0] % adjectives.length]}-${animals[random[1] % animals.length]}-${100000 + random[2] % 900000}`;
  save("performanceSystemId", id);
  return id;
}

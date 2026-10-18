// Read-only WebKitGTK regression check. See docs/features/REFERENCE_COMPARISON.md.
import assert from "node:assert/strict";

const endpoint = new URL(process.argv[2] ?? "http://127.0.0.1:9223");
assert(endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname),
  "Use the local WebKit inspector HTTP endpoint");
const listing = await (await fetch(endpoint, { signal: AbortSignal.timeout(10_000) })).text();
const path = listing.match(/\/socket\/[\w/.-]+/)?.[0];
assert(path, "No inspectable native page; launch a debug app with WEBKIT_INSPECTOR_HTTP_SERVER set");
const socketUrl = new URL(path, endpoint);
socketUrl.protocol = "ws:";
const socket = new WebSocket(socketUrl);
const pending = new Map();
let serial = 0;
let resolveTarget;
let rejectTarget;
const target = new Promise((resolve, reject) => { resolveTarget = resolve; rejectTarget = reject; });
const startup = setTimeout(() => rejectTarget(new Error("Native inspector did not attach")), 10_000);
socket.addEventListener("error", () => rejectTarget(new Error("Native inspector connection failed")));
socket.addEventListener("message", ({ data }) => {
  const envelope = JSON.parse(data);
  if (envelope.method === "Target.targetCreated") {
    clearTimeout(startup);
    resolveTarget(envelope.params.targetInfo.targetId);
  }
  if (envelope.method !== "Target.dispatchMessageFromTarget") return;
  const message = JSON.parse(envelope.params.message);
  const call = pending.get(message.id);
  if (!call) return;
  clearTimeout(call.timer);
  pending.delete(message.id);
  if (message.error) call.reject(new Error(JSON.stringify(message.error)));
  else call.resolve(message.result);
});

try {
  const targetId = await target;
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Native inspector timed out: ${method}`));
    }, 10_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: 10_000 + id, method: "Target.sendMessageToTarget", params: {
      targetId, message: JSON.stringify({ id, method, params }),
    } }));
  });
  const evaluate = async (expression, returnByValue = true) => {
    const result = await rpc("Runtime.evaluate", { expression, returnByValue });
    assert(!result.wasThrown, "Could not read the native strip");
    return result.result;
  };
  const { root } = await rpc("DOM.getDocument");
  await rpc("LayerTree.enable");
  const page = await rpc("LayerTree.layersForNode", { nodeId: root.nodeId });
  assert(page.layers.length > 0, "Native compositing is inactive; this check needs an accelerated WebKitGTK window");
  const selector = ".overflow-x-auto.overflow-y-hidden";
  const count = (await evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)).value;
  assert(count > 0, "Open a photo folder with the filmstrip visible first");
  for (let i = 0; i < count; i++) {
    const expression = `document.querySelectorAll(${JSON.stringify(selector)})[${i}]`;
    const object = await evaluate(expression, false);
    const content = await evaluate(`${expression}.firstElementChild`, false);
    const { nodeId } = await rpc("DOM.requestNode", { objectId: object.objectId });
    const { nodeId: contentId } = await rpc("DOM.requestNode", { objectId: content.objectId });
    const info = (await evaluate(`(() => { const el = ${expression}; return {
      viewport: el.clientWidth, content: el.scrollWidth, dpr: devicePixelRatio
    }; })()`)).value;
    const { layers } = await rpc("LayerTree.layersForNode", { nodeId });
    // A viewport-sized scrolling layer is fine. Promoting the entire wide
    // virtual canvas due to overlapping photo layers causes the GTK failure.
    const oversized = layers.filter(layer => layer.nodeId === contentId &&
      layer.compositedBounds.width > Math.ceil(info.viewport * info.dpr) + 2);
    assert.equal(oversized.length, 0,
      `Strip ${i + 1}: full-width content was composited (${info.content}px of content, ${info.viewport}px viewport)`);
    console.log(`PASS strip ${i + 1}: ${info.content}px content, ${info.viewport}px viewport; no oversized content backing`);
  }
} finally {
  clearTimeout(startup);
  for (const call of pending.values()) clearTimeout(call.timer);
  socket.close();
}

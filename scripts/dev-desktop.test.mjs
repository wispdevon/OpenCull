import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopSpec } from "./dev-desktop.mjs";

test("ordinary desktop launch preserves native platform defaults", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const env = { PATH: "/bin" };
    assert.deepEqual(desktopSpec(platform, "x64", env, ["--no-watch"]), { args: ["dev", "--no-watch"], env });
  }
});
test("Linux graphics and CUDA flags combine without consuming Tauri or app arguments", () => {
  const env = { PATH: "/bin" };
  const spec = desktopSpec("linux", "x64", env, ["--nvidia", "--cuda", "--no-watch", "--", "--software"]);
  assert.deepEqual(spec.args, ["dev", "--features", "cuda", "--no-watch", "--", "--software"]);
  assert.equal(spec.env.OPENCULL_GRAPHICS, "nvidia");
  assert.equal(spec.env.OPENCULL_AI, "cuda");
  assert.deepEqual(env, { PATH: "/bin" });
});
test("invalid or unsupported profiles fail before spawning Tauri", () => {
  assert.throws(() => desktopSpec("linux", "x64", {}, ["--nvidia", "--software"]), /Choose one/);
  assert.throws(() => desktopSpec("darwin", "arm64", {}, ["--nvidia"]), /Linux-only/);
  assert.throws(() => desktopSpec("win32", "x64", {}, ["--cuda"]), /Linux x86_64/);
});

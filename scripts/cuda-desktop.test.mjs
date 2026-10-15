import { test } from "node:test";
import assert from "node:assert/strict";
import { launchSpec } from "./cuda-desktop.mjs";

test("CUDA launcher rejects macOS, Windows and ARM before starting a process", () => {
  for (const [platform, arch] of [["darwin", "arm64"], ["darwin", "x64"], ["win32", "x64"], ["linux", "arm64"]]) {
    assert.throws(() => launchSpec(platform, arch, {}, []), /Linux x86_64/);
  }
});
test("Linux launch opts into CUDA while leaving normal launches unchanged", () => {
  const env = { PATH: "/bin", OPENCULL_GRAPHICS: "software" };
  const spec = launchSpec("linux", "x64", env, ["--no-watch"]);
  assert.deepEqual(spec.args, ["dev", "--features", "cuda", "--no-watch"]);
  assert.equal(spec.env.OPENCULL_AI, "cuda");
  assert.equal(spec.env.OPENCULL_GRAPHICS, "software");
  assert.equal(env.OPENCULL_AI, undefined);
});

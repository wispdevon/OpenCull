import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { launchSpec } from "./cuda-desktop.mjs";

/** One desktop command; profiles are optional flags, and remaining arguments reach Tauri. */
export function desktopSpec(platform, arch, environment, args) {
  const env = { ...environment };
  const rest = [];
  let graphics;
  let cuda = false;
  let appArgs = false;
  for (const arg of args) {
    if (arg === "--") appArgs = true;
    if (!appArgs && ["--nvidia", "--compatibility", "--software"].includes(arg)) {
      if (platform !== "linux") throw new Error("Graphics profiles are Linux-only. Use npm run desktop on macOS or Windows.");
      if (graphics) throw new Error("Choose one graphics profile: --nvidia, --compatibility, or --software.");
      graphics = arg.slice(2);
    } else if (!appArgs && arg === "--cuda") cuda = true;
    else rest.push(arg);
  }
  if (graphics) env.OPENCULL_GRAPHICS = graphics;
  return cuda ? launchSpec(platform, arch, env, rest) : { args: ["dev", ...rest], env };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await import("./check-node.mjs");
    const spec = desktopSpec(process.platform, process.arch, process.env, process.argv.slice(2));
    const cli = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
    const child = spawn(process.execPath, [cli, ...spec.args], { stdio: "inherit", env: spec.env });
    child.on("error", error => { console.error(error.message); process.exitCode = 1; });
    child.on("exit", code => { process.exitCode = code ?? 1; });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

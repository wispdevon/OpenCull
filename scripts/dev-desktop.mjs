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

/** Reuse only an identifiable OpenCull Vite server; never take over another app's port. */
export async function reuseFrontend(args, request = fetch) {
  let response;
  try {
    response = await request("http://localhost:1420/", { signal: AbortSignal.timeout(1500), redirect: "error" });
  } catch (error) {
    const refused = error.cause?.code === "ECONNREFUSED" || error.cause?.errors?.every(item => item.code === "ECONNREFUSED");
    if (refused) return { args, reused: false };
    throw new Error("Port 1420 could not be checked. Stop the other dev server and retry npm run desktop.", { cause: error });
  }
  const html = await response.text();
  if (!response.ok || !/<title>\s*OpenCull\s*<\/title>/i.test(html) || !html.includes("/@vite/client")) {
    throw new Error("Port 1420 is used by another server. Stop it before running npm run desktop.");
  }
  const next = args.slice();
  const separator = next.indexOf("--");
  next.splice(separator < 0 ? next.length : separator, 0, "--config", JSON.stringify({ build: { beforeDevCommand: "" } }));
  return { args: next, reused: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await import("./check-node.mjs");
    const spec = desktopSpec(process.platform, process.arch, process.env, process.argv.slice(2));
    const frontend = await reuseFrontend(spec.args);
    if (frontend.reused) console.log("Reusing the OpenCull frontend already running on port 1420.");
    const cli = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
    const child = spawn(process.execPath, [cli, ...frontend.args], { stdio: "inherit", env: spec.env });
    child.on("error", error => { console.error(error.message); process.exitCode = 1; });
    child.on("exit", code => { process.exitCode = code ?? 1; });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

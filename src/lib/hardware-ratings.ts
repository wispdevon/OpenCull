/**
 * Fixed specification capacity heuristic, independent of application benchmarks.
 * These points describe selected capacities, not application speed or architecture efficiency.
 * This module has no runtime imports so the offline maintainer tools can also use it.
 */
export const HARDWARE_FORMULA_VERSION = 1;
export interface HardwareIdentity {
  cpuModel: string | null;
  gpuModel: string | null;
  /** Exact installed capacity in MiB; OS-usable memory must not be substituted. */
  installedMemoryMb: number | null;
}
export interface HardwareSpecificationSource {
  title: string;
  url: string;
  retrievedAt: string;
}
interface ModelSpecification {
  id: string;
  model: string;
  aliases: string[];
  sourceId: string;
}
export interface CpuSpecification extends ModelSpecification {
  physicalCores: number;
  baseClockMHz: number;
}
export interface GpuSpecification extends ModelSpecification {
  shaderCores: number;
  baseClockMHz: number;
  vramGiB: number;
}
export interface HardwareCatalogue {
  schemaVersion: 1;
  formulaVersion: 1;
  version: string;
  description: string;
  sources: Record<string, HardwareSpecificationSource>;
  cpus: CpuSpecification[];
  gpus: GpuSpecification[];
}
export type HardwareRatingUnavailableReason =
  | "unknown-cpu" | "unknown-gpu" | "unknown-memory" | "invalid-memory"
  | "invalid-catalogue" | "ambiguous-cpu" | "ambiguous-gpu";
export interface HardwareRatingResult {
  /** Rounded specification points; no relative baseline or artificial ceiling. */
  value: number | null;
  reason: HardwareRatingUnavailableReason | null;
}
export interface HardwareRatings {
  formulaVersion: 1;
  catalogueVersion: string;
  profile: { cpuId: string | null; gpuId: string | null; installedMemoryMb: number | null };
  system: HardwareRatingResult;
  gpu: HardwareRatingResult;
  components: {
    cpu: { physicalCores: number; baseClockMHz: number; points: number; sourceId: string } | null;
    gpu: { shaderCores: number; baseClockMHz: number; vramGiB: number; points: number; sourceId: string } | null;
    ram: { installedGiB: number; points: number } | null;
  };
}

const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
const integer = (value: unknown): value is number => positive(value) && Number.isSafeInteger(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const identifier = (value: unknown, max = 80): value is string => text(value, max) && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value) && !value.includes("..") && !value.endsWith(".");
const unavailable = (reason: HardwareRatingUnavailableReason): HardwareRatingResult => ({ value: null, reason });
const cpuPoints = (spec: CpuSpecification) => spec.physicalCores * spec.baseClockMHz / 10;
const gpuPoints = (spec: GpuSpecification) => spec.shaderCores * spec.baseClockMHz * 2 / 10_000;

/** Only presentation differences are normalized; SKU suffixes remain significant. */
function normalizeModel(value: string): string {
  return value.replace(/[™®]/gu, "").replace(/\((?:tm|r)\)/giu, "").replace(/\s+/gu, " ").trim().toLowerCase();
}

function validSource(value: unknown): boolean {
  if (!record(value) || !text(value.title, 200) || !text(value.url, 2048)
    || typeof value.retrievedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value.retrievedAt)) return false;
  try {
    const url = new URL(value.url);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validCatalogue(catalogue: HardwareCatalogue): boolean {
  if (!catalogue || catalogue.schemaVersion !== 1 || catalogue.formulaVersion !== HARDWARE_FORMULA_VERSION
    || !identifier(catalogue.version, 40) || !text(catalogue.description, 2000) || !record(catalogue.sources)
    || !Array.isArray(catalogue.cpus) || !Array.isArray(catalogue.gpus)) return false;
  if (Object.entries(catalogue.sources).some(([id, source]) => !identifier(id) || !validSource(source))) return false;
  const ids = new Set<string>();
  const validModel = (spec: ModelSpecification): boolean => {
    if (!spec || !identifier(spec.id) || ids.has(spec.id) || !text(spec.model, 200)
      || !Array.isArray(spec.aliases) || !spec.aliases.every((alias) => text(alias, 200))
      || !identifier(spec.sourceId) || !Object.hasOwn(catalogue.sources, spec.sourceId)) return false;
    ids.add(spec.id);
    return normalizeModel(spec.model).length > 0 && spec.aliases.every((alias) => normalizeModel(alias).length > 0);
  };
  return catalogue.cpus.every((spec) => validModel(spec) && integer(spec.physicalCores) && integer(spec.baseClockMHz) && positive(cpuPoints(spec)))
    && catalogue.gpus.every((spec) => validModel(spec) && integer(spec.shaderCores) && integer(spec.baseClockMHz) && positive(spec.vramGiB) && positive(gpuPoints(spec)));
}

function matchModel<T extends ModelSpecification>(model: string | null, specifications: T[]): T[] {
  if (typeof model !== "string") return [];
  const normalized = normalizeModel(model);
  return normalized ? specifications.filter((spec) => [spec.model, ...spec.aliases].some((alias) => normalizeModel(alias) === normalized)) : [];
}

function rounded(points: number): HardwareRatingResult {
  const value = Math.round(points);
  return Number.isSafeInteger(value) && value >= 0 ? { value, reason: null } : unavailable("invalid-catalogue");
}

/**
 * CPU = physical cores × reference base MHz / 10 (100 points per core-GHz).
 * GPU = shader cores × reference base MHz × 2 / 10000 (100 points per base TFLOPS).
 * RAM = installed GiB × 100. System = round(0.6 CPU + 0.3 GPU + 0.1 RAM).
 * Components stay unrounded until the final displayed GPU/system values.
 */
export function rateHardware(identity: HardwareIdentity, catalogue: HardwareCatalogue): HardwareRatings {
  const installedMemoryMb = integer(identity?.installedMemoryMb) ? identity.installedMemoryMb : null;
  const result: HardwareRatings = {
    formulaVersion: HARDWARE_FORMULA_VERSION,
    catalogueVersion: identifier(catalogue?.version, 40) ? catalogue.version : "unavailable",
    profile: { cpuId: null, gpuId: null, installedMemoryMb },
    system: unavailable("invalid-catalogue"), gpu: unavailable("invalid-catalogue"),
    components: { cpu: null, gpu: null, ram: null },
  };
  if (!validCatalogue(catalogue)) return result;

  const cpus = matchModel(identity?.cpuModel, catalogue.cpus);
  const gpus = matchModel(identity?.gpuModel, catalogue.gpus);
  const cpuReason = cpus.length === 0 ? "unknown-cpu" : cpus.length > 1 ? "ambiguous-cpu" : null;
  const gpuReason = gpus.length === 0 ? "unknown-gpu" : gpus.length > 1 ? "ambiguous-gpu" : null;
  const memoryReason = identity?.installedMemoryMb == null ? "unknown-memory" : installedMemoryMb === null ? "invalid-memory" : null;

  if (cpuReason === null) {
    const spec = cpus[0];
    result.profile.cpuId = spec.id;
    result.components.cpu = { physicalCores: spec.physicalCores, baseClockMHz: spec.baseClockMHz, points: cpuPoints(spec), sourceId: spec.sourceId };
  }
  if (gpuReason === null) {
    const spec = gpus[0];
    result.profile.gpuId = spec.id;
    result.components.gpu = { shaderCores: spec.shaderCores, baseClockMHz: spec.baseClockMHz, vramGiB: spec.vramGiB, points: gpuPoints(spec), sourceId: spec.sourceId };
  }
  if (installedMemoryMb !== null) {
    const installedGiB = installedMemoryMb / 1024;
    result.components.ram = { installedGiB, points: installedGiB * 100 };
  }
  result.gpu = gpuReason ? unavailable(gpuReason) : rounded(result.components.gpu!.points);
  const reason = cpuReason ?? gpuReason ?? memoryReason;
  result.system = reason ? unavailable(reason)
    : rounded(.6 * result.components.cpu!.points + .3 * result.components.gpu!.points + .1 * result.components.ram!.points);
  return result;
}

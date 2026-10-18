import { describe, expect, it } from "vitest";
import catalogueJSON from "../../benchmarks/hardware-specifications.json";
import { rateHardware, type HardwareCatalogue, type HardwareIdentity } from "./hardware-ratings";

const catalogue = catalogueJSON as HardwareCatalogue;
const identity: HardwareIdentity = {
  cpuModel: "AMD Ryzen 5 7500F 6-Core Processor",
  gpuModel: "NVIDIA GeForce RTX 3060 Ti",
  installedMemoryMb: 32 * 1024,
};

describe("hardware specification ratings", () => {
  it("uses the sourced base specification formula with unrounded components", () => {
    const result = rateHardware(identity, catalogue);
    expect(result).toMatchObject({ formulaVersion: 1, catalogueVersion: "1.0.0",
      profile: { cpuId: "amd-ryzen-5-7500f", gpuId: "nvidia-geforce-rtx-3060-ti", installedMemoryMb: 32_768 },
      system: { value: 2063, reason: null }, gpu: { value: 1372, reason: null },
      components: { cpu: { physicalCores: 6, baseClockMHz: 3700, points: 2220, sourceId: "amd-ryzen-5-7500f" },
        gpu: { shaderCores: 4864, baseClockMHz: 1410, vramGiB: 8, sourceId: "nvidia-geforce-rtx-3060-ti" },
        ram: { installedGiB: 32, points: 3200 } } });
    expect(result.components.gpu!.points).toBeCloseTo(1371.648, 9);
    expect(Math.round(.6 * 2220 + .3 * 1372 + .1 * 3200)).toBe(2064);
  });

  it("normalizes case, whitespace and trademarks while matching reviewed aliases", () => {
    const varied = { ...identity, cpuModel: "  amd  Ryzen™ 5 7500f 6-Core Processor  ", gpuModel: "nvidia(R) geforce®  RTX(TM) 3060   TI" };
    expect(rateHardware(varied, catalogue)).toEqual(rateHardware(identity, catalogue));
    expect(rateHardware({ ...identity, cpuModel: "AMD Ryzen 5 7500F", gpuModel: "GeForce RTX 3060 Ti" }, catalogue)).toEqual(rateHardware(identity, catalogue));
  });

  it("preserves SKU suffixes and rejects substring or fuzzy matches", () => {
    for (const cpuModel of ["AMD Ryzen 5 7500", "AMD Ryzen 5 7500X", "AMD Ryzen 5 7500F PRO", "7500F", "AMD Ryzen 5 7500F 12-Core Processor"]) {
      expect(rateHardware({ ...identity, cpuModel }, catalogue).system).toEqual({ value: null, reason: "unknown-cpu" });
    }
    for (const gpuModel of ["NVIDIA GeForce RTX 3060", "NVIDIA GeForce RTX 3060 Ti Laptop GPU", "NVIDIA GeForce RTX 3060 Ti SUPER", "RTX 3060 Ti", "NVIDIA graphics device detected"]) {
      expect(rateHardware({ ...identity, gpuModel }, catalogue).gpu).toEqual({ value: null, reason: "unknown-gpu" });
    }
  });

  it("does not use timings, build, OS, app version, provider, outcome or available threads", () => {
    const expected = rateHardware(identity, catalogue);
    for (const extras of [
      { stages: [{ samplesMs: [0, 1, 1000], failures: 3 }], mode: "quick", outcome: "cancelled", build: "debug", os: "linux", appVersion: "0.7.0", logicalCores: 1, aiProvider: "CPU" },
      { stages: [], mode: "thorough", outcome: "failed", build: "release", os: "windows", appVersion: "future", logicalCores: 24, aiProvider: "CUDA + CPU fallback" },
    ]) expect(rateHardware({ ...identity, ...extras }, catalogue)).toEqual(expected);
  });

  it("keeps GPU ratings available when CPU or installed RAM are unknown", () => {
    const unknownCpu = rateHardware({ ...identity, cpuModel: null }, catalogue);
    expect(unknownCpu.system).toEqual({ value: null, reason: "unknown-cpu" });
    expect(unknownCpu.profile.cpuId).toBeNull();
    expect(unknownCpu.components.cpu).toBeNull();
    expect(unknownCpu.gpu).toEqual({ value: 1372, reason: null });
    const unknownMemory = rateHardware({ ...identity, installedMemoryMb: null }, catalogue);
    expect(unknownMemory.system).toEqual({ value: null, reason: "unknown-memory" });
    expect(unknownMemory.components.ram).toBeNull();
    expect(unknownMemory.gpu).toEqual({ value: 1372, reason: null });
  });

  it("requires an exact installed capacity and never guesses a nominal RAM tier", () => {
    const result = rateHardware({ ...identity, installedMemoryMb: 31_616 }, catalogue);
    expect(result.components.ram).toEqual({ installedGiB: 30.875, points: 3087.5 });
    expect(result.system.value).toBe(2052);
    expect(rateHardware({ ...identity, installedMemoryMb: 16 * 1024 }, catalogue).system.value).toBe(1903);
  });

  it("leaves invalid memory unavailable without substituting zero", () => {
    for (const installedMemoryMb of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const result = rateHardware({ ...identity, installedMemoryMb }, catalogue);
      expect(result.system).toEqual({ value: null, reason: "invalid-memory" });
      expect(result.profile.installedMemoryMb).toBeNull();
      expect(result.components.ram).toBeNull();
      expect(result.gpu).toEqual({ value: 1372, reason: null });
    }
  });

  it("keeps known CPU and RAM details when the GPU model is unknown", () => {
    const result = rateHardware({ ...identity, gpuModel: null }, catalogue);
    expect(result.system).toEqual({ value: null, reason: "unknown-gpu" });
    expect(result.gpu).toEqual({ value: null, reason: "unknown-gpu" });
    expect(result.components.cpu!.points).toBe(2220);
    expect(result.components.ram!.points).toBe(3200);
  });

  it("rejects ambiguous aliases instead of choosing the first matching entry", () => {
    const cpuCatalogue = structuredClone(catalogue);
    cpuCatalogue.cpus.push({ ...cpuCatalogue.cpus[0], id: "other-cpu", physicalCores: 8 });
    const cpu = rateHardware(identity, cpuCatalogue);
    expect(cpu.system).toEqual({ value: null, reason: "ambiguous-cpu" });
    expect(cpu.profile.cpuId).toBeNull();
    expect(cpu.gpu.value).toBe(1372);
    const gpuCatalogue = structuredClone(catalogue);
    gpuCatalogue.gpus.push({ ...gpuCatalogue.gpus[0], id: "other-gpu", shaderCores: 5000 });
    expect(rateHardware(identity, gpuCatalogue).gpu).toEqual({ value: null, reason: "ambiguous-gpu" });
  });

  it("rejects invalid or unsupported catalogue metadata", () => {
    for (const fields of [{ schemaVersion: 2 }, { formulaVersion: 2 }, { version: "" }, { cpus: null }, { sources: {} }]) {
      const result = rateHardware(identity, { ...catalogue, ...fields } as HardwareCatalogue);
      expect(result.system).toEqual({ value: null, reason: "invalid-catalogue" });
      expect(result.gpu).toEqual({ value: null, reason: "invalid-catalogue" });
    }
  });

  it("rejects malformed specifications and duplicate canonical IDs", () => {
    for (const fields of [{ physicalCores: 0 }, { physicalCores: 6.5 }, { baseClockMHz: Infinity }, { sourceId: "missing" }]) {
      const invalid = structuredClone(catalogue); Object.assign(invalid.cpus[0], fields);
      expect(rateHardware(identity, invalid).system.reason).toBe("invalid-catalogue");
    }
    const invalid = structuredClone(catalogue); invalid.gpus.push(structuredClone(invalid.gpus[0]));
    expect(rateHardware(identity, invalid).gpu.reason).toBe("invalid-catalogue");
  });

  it("has no arbitrary score ceiling or 1000 reference anchor", () => {
    const larger = structuredClone(catalogue);
    larger.gpus[0].shaderCores = 10_000_000_000;
    expect(rateHardware(identity, larger).gpu.value).toBe(2_820_000_000);
    expect(rateHardware(identity, catalogue).gpu.value).not.toBe(1000);
  });

  it("never copies input extras, source URLs or aliases into the rating result", () => {
    const dirty = { ...identity, photoPath: "/private/shoot.jpg", systemId: "private-id", rating: 999_999 };
    const result = JSON.stringify(rateHardware(dirty, catalogue));
    for (const secret of ["private", "999999", "https:", "aliases", "retrievedAt"]) expect(result).not.toContain(secret);
  });

  it("preserves input objects and stable values when source metadata changes", () => {
    const before = structuredClone({ identity, catalogue });
    const original = rateHardware(identity, catalogue);
    const revised = structuredClone(catalogue); revised.version = "1.0.1";
    revised.sources["nvidia-geforce-rtx-3060-ti"].retrievedAt = "2026-10-19";
    expect(rateHardware(identity, revised).system).toEqual(original.system);
    expect(rateHardware(identity, revised).gpu).toEqual(original.gpu);
    expect({ identity, catalogue }).toEqual(before);
  });
});

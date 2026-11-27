import { createRequire } from "node:module";
import { getEBRangeForSectionRange, getEBRangeForEvent, getConfigForProject } from "../../public/js/streamer-utils.js";
import { setConfig, setProjects } from "../../public/js/state.js";

const require = createRequire(import.meta.url);
const { calculateEBRange } = require("../../backend/utils/eb.js");

// Frozen copy of the module list in getEBRangeForSectionRange as of commit d9e0c5d.
// Deliberate pin: with the flag off the label must never drift from today's value.
function legacyEBRange(startSection, endSection, cfg) {
  const moduleFreq = cfg?.moduleFrequency || 4;
  const sectionsPerCable = cfg?.sectionsPerCable || 107;
  if (startSection >= sectionsPerCable || endSection >= sectionsPerCable) return "—";
  const allModules = [{ num: 1, section: 0 }];
  for (let si = moduleFreq; si < sectionsPerCable; si += moduleFreq) {
    allModules.push({ num: Math.floor(si / moduleFreq) + 1, section: si });
  }
  const lastBuilt = allModules[allModules.length - 1];
  if (lastBuilt.section !== sectionsPerCable - 1) {
    allModules.push({ num: lastBuilt.num + 1, section: sectionsPerCable - 1 });
  }
  const before = allModules.filter((m) => m.section <= startSection).sort((a, b) => b.section - a.section)[0];
  const after = allModules.filter((m) => m.section >= endSection).sort((a, b) => a.section - b.section)[0];
  const f = (n) => `EB${String(n).padStart(2, "0")}`;
  if (before.num === after.num) return f(before.num);
  return `${f(Math.max(before.num, after.num))} – ${f(Math.min(before.num, after.num))}`;
}

describe("getEBRangeForSectionRange", () => {
  const cfg = { moduleFrequency: 4, sectionsPerCable: 20 };

  it("matches the backend label for every range within the active sections", () => {
    for (let start = 0; start < cfg.sectionsPerCable; start++) {
      for (let end = start; end < cfg.sectionsPerCable; end++) {
        // The frontend separates with an en dash, the backend with a hyphen.
        const frontend = getEBRangeForSectionRange(start, end, cfg).replace(" – ", " - ");
        expect(frontend).toBe(calculateEBRange(start, end, cfg));
      }
    }
  });

  it("matches the backend label for every range with a front eBird", () => {
    const frontCfg = { ...cfg, ebFront: true };
    for (let start = 0; start < cfg.sectionsPerCable; start++) {
      for (let end = start; end < cfg.sectionsPerCable; end++) {
        const frontend = getEBRangeForSectionRange(start, end, frontCfg).replace(" – ", " - ");
        expect(frontend).toBe(calculateEBRange(start, end, frontCfg));
      }
    }
  });

  it("equals the frozen implementation with the flag off", () => {
    for (const sectionsPerCable of [1, 2, 5, 12, 20, 33]) {
      for (const moduleFrequency of [1, 2, 3, 4, 6]) {
        const c = { sectionsPerCable, moduleFrequency };
        for (let start = 0; start < sectionsPerCable + 3; start++) {
          for (let end = start; end < sectionsPerCable + 3; end++) {
            expect(getEBRangeForSectionRange(start, end, c)).toBe(legacyEBRange(start, end, c));
            expect(getEBRangeForSectionRange(start, end, { ...c, ebFront: false })).toBe(legacyEBRange(start, end, c));
          }
        }
      }
    }
  });

  it("shows a dash for ranges that reach the tail sections", () => {
    expect(getEBRangeForSectionRange(20, 22, cfg)).toBe("—");
    expect(getEBRangeForSectionRange(18, 21, cfg)).toBe("—");
  });
});

describe("getConfigForProject ebFront", () => {
  afterEach(() => {
    setConfig(null);
    setProjects([]);
  });

  it("reads ebFront from the named project, not the active one", () => {
    setConfig({ activeProjectNumber: "A", numCables: 1, sectionsPerCable: 10, sectionLength: 75, moduleFrequency: 4, channelsPerSection: 6 });
    setProjects([
      { projectNumber: "A", ebFront: false },
      { projectNumber: "B", ebFront: true },
      { projectNumber: "C", ebFront: 1 },
    ]);
    expect(getConfigForProject("B").ebFront).toBe(true);
    expect(getConfigForProject("C").ebFront).toBe(true);
    expect(getConfigForProject("A").ebFront).toBe(false);
  });

  it("returns the global config unchanged when the project is not found", () => {
    const global = { activeProjectNumber: "A", ebFront: true };
    setConfig(global);
    setProjects([{ projectNumber: "A" }]);
    expect(getConfigForProject("Z")).toBe(global);
  });
});

describe("getEBRangeForEvent", () => {
  const base = { activeProjectNumber: "A", numCables: 1, sectionsPerCable: 20, sectionLength: 75, moduleFrequency: 4, channelsPerSection: 6 };
  const evt = (projectNumber) => ({ sectionIndexStart: 3, sectionIndexEnd: 6, projectNumber });

  afterEach(() => {
    setConfig(null);
    setProjects([]);
  });

  it("uses the flag of the event's own project, not the active config's", () => {
    const active = { ...base, ebFront: true };
    setConfig(active);
    setProjects([
      { projectNumber: "A", ebFront: true },
      { projectNumber: "OLD", ebFront: false },
    ]);
    const off = getEBRangeForSectionRange(3, 6, { ...active, ebFront: false });
    const on = getEBRangeForSectionRange(3, 6, { ...active, ebFront: true });
    expect(off).not.toBe(on);
    expect(getEBRangeForEvent(evt("OLD"), active)).toBe(off);
    expect(getEBRangeForEvent(evt("A"), active)).toBe(on);
  });

  it("is unchanged from the legacy label when the flag is off everywhere", () => {
    const active = { ...base, ebFront: false };
    setConfig(active);
    setProjects([{ projectNumber: "A", ebFront: false }, { projectNumber: "B", ebFront: false }]);
    for (const p of ["A", "B", undefined, "unknown"]) {
      expect(getEBRangeForEvent(evt(p), active)).toBe(legacyEBRange(3, 6, active));
    }
  });

  it("keeps the active config's layout for an event of another project", () => {
    const active = { ...base, ebFront: false, moduleFrequency: 4 };
    setConfig(active);
    setProjects([{ projectNumber: "A" }, { projectNumber: "B", ebFront: false, moduleFrequency: 6 }]);
    expect(getEBRangeForEvent(evt("B"), active)).toBe(legacyEBRange(3, 6, active));
  });
});

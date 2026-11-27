import { createRequire } from "node:module";
import {
  getModuleLayout,
  countHeatmapColumnRows,
  shouldInsertModuleAfterSection,
} from "../../public/js/heatmap-layout.js";

const require = createRequire(import.meta.url);
const { getModuleLayout: backendGetModuleLayout } = require("../../backend/utils/eb.js");

// Frozen copy of countHeatmapColumnRows as of commit d9e0c5d (before front eBird).
// Deliberate pin: the flag-off result must never drift from today's values.
function legacyCountHeatmapColumnRows(sectionCount, moduleFreq, tailSections) {
  const shouldInsert = (sectionNumber) => {
    if (sectionNumber === 1) return true;
    if (sectionNumber === sectionCount) return true;
    return sectionNumber > 1 && (sectionNumber - 1) % moduleFreq === 0;
  };
  let count = 0;
  for (let s = 0; s < sectionCount; s++) {
    count++;
    if (shouldInsert(s + 1)) count++;
  }
  count += tailSections;
  return count;
}

describe("getModuleLayout", () => {
  it("deep-equals the backend layout for sections 1..40, freq 1..6, flag on and off", () => {
    for (let sections = 1; sections <= 40; sections++) {
      for (let freq = 1; freq <= 6; freq++) {
        for (const flag of [false, true]) {
          expect(getModuleLayout(sections, freq, flag)).toEqual(backendGetModuleLayout(sections, freq, flag));
        }
      }
    }
  });

  it("matches the backend for degenerate input", () => {
    for (const sections of [0, -3, NaN, undefined, "x"]) {
      expect(getModuleLayout(sections, 4, true)).toEqual(backendGetModuleLayout(sections, 4, true));
    }
    for (const freq of [0, -1, 2.5, undefined, null, NaN]) {
      expect(getModuleLayout(10, freq)).toEqual(backendGetModuleLayout(10, freq));
    }
  });

  it("places the front EB directly before AS01 when the flag is on", () => {
    const layout = getModuleLayout(10, 4, true);
    expect(layout[0]).toEqual({ num: 1, afterSection: -1, kind: "front" });
    expect(layout[1]).toEqual({ num: 2, afterSection: 0, kind: "first" });
  });

  it("matches the sequential renderer numbering", () => {
    for (let count = 1; count <= 40; count++) {
      for (let freq = 1; freq <= 6; freq++) {
        for (const flag of [false, true]) {
          const nums = [];
          let n = flag ? 1 : 0;
          if (flag) nums.push(1);
          for (let s = 0; s < count; s++) {
            if (shouldInsertModuleAfterSection(s + 1, count, freq)) nums.push(++n);
          }
          expect(getModuleLayout(count, freq, flag).map((m) => m.num)).toEqual(nums);
        }
      }
    }
  });
});

describe("countHeatmapColumnRows", () => {
  it("keeps today's value for 107 sections, freq 4", () => {
    expect(countHeatmapColumnRows(107, 4, 0)).toBe(legacyCountHeatmapColumnRows(107, 4, 0));
    expect(countHeatmapColumnRows(107, 4, 0, true)).toBe(countHeatmapColumnRows(107, 4, 0) + 1);
  });

  it("equals the frozen implementation with the flag off and is one more with it on", () => {
    for (let count = 1; count <= 40; count++) {
      for (let freq = 1; freq <= 6; freq++) {
        for (const tail of [0, 5]) {
          const legacy = legacyCountHeatmapColumnRows(count, freq, tail);
          expect(countHeatmapColumnRows(count, freq, tail)).toBe(legacy);
          expect(countHeatmapColumnRows(count, freq, tail, false)).toBe(legacy);
          expect(countHeatmapColumnRows(count, freq, tail, true)).toBe(legacy + 1);
        }
      }
    }
  });
});

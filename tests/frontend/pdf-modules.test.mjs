import { buildPdfModulePositions } from "../../public/js/heatmap-layout.js";

// Frozen copy of today's PDF computations as of commit 0e5c85d (pdf-generator.js ~438-457 and ~536-545).
// Deliberate pin: the flag-off result must never drift. Includes today's closing-label quirk
// floor((max-1)/freq)+1, which can sit one lower than the heatmap's closing number.
function legacyReference(moduleFreq, maxSectionsPerCable, totalSections) {
  const modulesBySection = Array.from({ length: totalSections }, () => null);
  modulesBySection[0] = 1;
  for (let sectionIndex = moduleFreq; sectionIndex < maxSectionsPerCable; sectionIndex += moduleFreq) {
    const moduleNum = Math.floor(sectionIndex / moduleFreq) + 1;
    if (sectionIndex < totalSections) {
      modulesBySection[sectionIndex] = moduleNum;
    }
  }
  const lastModuleNum = Math.floor((maxSectionsPerCable - 1) / moduleFreq) + 1;
  const lastModuleSection = maxSectionsPerCable - 1;
  if (lastModuleSection < totalSections && !modulesBySection[lastModuleSection]) {
    modulesBySection[lastModuleSection] = lastModuleNum;
  }
  const separatorRows = [];
  for (let boundaryS = moduleFreq; boundaryS < maxSectionsPerCable; boundaryS += moduleFreq) {
    const moduleNum = Math.floor(boundaryS / moduleFreq) + 1;
    if (moduleNum % 2 !== 0) continue;
    separatorRows.push(boundaryS);
  }
  return { modulesBySection, separatorRows };
}

describe("buildPdfModulePositions flag off", () => {
  for (const maxSections of [1, 5, 20, 105, 107]) {
    for (const moduleFreq of [1, 3, 4, 5]) {
      for (const totalSections of [maxSections, maxSections + 5]) {
        it(`matches legacy: max=${maxSections} freq=${moduleFreq} total=${totalSections}`, () => {
          const actual = buildPdfModulePositions({ moduleFreq, maxSections, totalSections, ebFront: false });
          expect(actual).toEqual(legacyReference(moduleFreq, maxSections, totalSections));
        });
      }
    }
  }
});

describe("buildPdfModulePositions flag on", () => {
  const result = buildPdfModulePositions({ moduleFreq: 4, maxSections: 107, totalSections: 112, ebFront: true });

  it("shifts numbers up by one and drops the row-less front EB", () => {
    expect(result.modulesBySection[0]).toBe(2);
    expect(result.modulesBySection[4]).toBe(3);
    expect(result.modulesBySection).not.toContain(1);
    expect(result.modulesBySection).toHaveLength(112);
  });

  it("separates under even, non-closing EBs only", () => {
    expect(result.separatorRows).toContain(0);
    expect(result.separatorRows).toContain(8);
    expect(result.separatorRows).not.toContain(4);
    expect(result.separatorRows).not.toContain(106);
  });
});

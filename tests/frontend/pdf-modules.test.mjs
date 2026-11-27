import { buildPdfModulePositions, getModuleLayout } from "../../public/js/heatmap-layout.js";

// Frozen copy of the PDF computations as of commit 0e5c85d (pdf-generator.js ~438-457 and ~536-545).
// Deliberate pin for everything EXCEPT the closing label: that one used floor((max-1)/freq)+1, one lower
// than the heatmap's closing number, and was fixed on request (see the closing-label tests below).
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
        it(`matches legacy except the closing label: max=${maxSections} freq=${moduleFreq} total=${totalSections}`, () => {
          const actual = buildPdfModulePositions({ moduleFreq, maxSections, totalSections, ebFront: false });
          const legacy = legacyReference(moduleFreq, maxSections, totalSections);
          const expected = [...legacy.modulesBySection];
          const closing = getModuleLayout(maxSections, moduleFreq, false).find((m) => m.kind === "closing");
          if (closing && closing.afterSection < totalSections) expected[closing.afterSection] = closing.num;
          expect(actual.modulesBySection).toEqual(expected);
          expect(actual.separatorRows).toEqual(legacy.separatorRows);
          expect(actual.frontModuleNum).toBeNull();
        });
      }
    }
  }

  it("labels the closing EB with the heatmap's number (107 sections, N=4: EB28, not EB27)", () => {
    const { modulesBySection } = buildPdfModulePositions({ moduleFreq: 4, maxSections: 107, totalSections: 107, ebFront: false });
    expect(modulesBySection[106]).toBe(28);
    expect(legacyReference(4, 107, 107).modulesBySection[106]).toBe(27);
  });
});

describe("buildPdfModulePositions flag on", () => {
  const result = buildPdfModulePositions({ moduleFreq: 4, maxSections: 107, totalSections: 112, ebFront: true });

  it("reports the front EB so the PDF can label it above the first row", () => {
    expect(result.frontModuleNum).toBe(1);
  });

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

describe("buildPdfModulePositions flag on, last section on a regular position", () => {
  // 105 sections, N=4: the last section (104) is itself a regular EB position, so no extra closing EB is added.
  const result = buildPdfModulePositions({ moduleFreq: 4, maxSections: 105, totalSections: 105, ebFront: true });

  it("numbers the last three EB rows 26, 27 and 28", () => {
    expect(result.modulesBySection[96]).toBe(26);
    expect(result.modulesBySection[100]).toBe(27);
    expect(result.modulesBySection[104]).toBe(28);
  });

  it("has no duplicate EB numbers", () => {
    const nums = result.modulesBySection.filter(Boolean);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it("separates under row 104 because EB28 is even and not a closing EB", () => {
    expect(result.separatorRows).toContain(104);
    expect(result.separatorRows).not.toContain(100);
  });
});

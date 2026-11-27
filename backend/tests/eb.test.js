const { calculateEBRange, countEBModules, getModuleLayout } = require("../utils/eb");
const { legacyCalculateEBRange, legacyCountEBModules } = require("./helpers/legacyEb");

describe("calculateEBRange", () => {
  const baseConfig = { moduleFrequency: 4, sectionsPerCable: 20 };

  it("returns a single EB when start and end map to the same equipment box", () => {
    expect(calculateEBRange(0, 0, baseConfig)).toMatch(/^EB\d{2}$/);
  });

  it("returns range string when start and end map to different module numbers", () => {
    const r = calculateEBRange(0, 12, baseConfig);
    expect(r).toContain(" - ");
    expect(r).toMatch(/EB\d{2}/);
  });

  it("defaults moduleFrequency when missing", () => {
    const r = calculateEBRange(0, 0, { sectionsPerCable: 16 });
    expect(r).toBeTruthy();
    expect(r).not.toBe("-");
  });

  it("still resolves a label for minimal cable length (single section)", () => {
    const r = calculateEBRange(0, 0, { moduleFrequency: 4, sectionsPerCable: 1 });
    expect(r).toMatch(/^EB\d{2}$/);
  });

  it("treats inverted start/end same as ordered range", () => {
    const a = calculateEBRange(8, 2, baseConfig);
    const b = calculateEBRange(2, 8, baseConfig);
    expect(a).toBe(b);
  });

  it("labels a range with the modules on either side, highest first", () => {
    expect(calculateEBRange(5, 6, baseConfig)).toBe("EB03 - EB02");
    expect(calculateEBRange(4, 4, baseConfig)).toBe("EB02");
  });

  it("uses the closing module at the last active section", () => {
    // 20 sections, one module every 4: EB01..EB05 at 0,4,8,12,16 and closing EB06 at 19.
    expect(calculateEBRange(17, 18, baseConfig)).toBe("EB06 - EB05");
    expect(calculateEBRange(19, 19, baseConfig)).toBe("EB06");
  });

  it("ends at the closing module when the range runs into the tail sections", () => {
    expect(calculateEBRange(17, 22, baseConfig)).toBe("EB06 - EB05");
  });

  it("never produces a Tail Adaptor label or a placeholder", () => {
    for (let start = 0; start < 25; start++) {
      for (let end = start; end < 25; end++) {
        const r = calculateEBRange(start, end, baseConfig);
        expect(r).toMatch(/^EB\d{2}( - EB\d{2})?$/);
      }
    }
  });
});

describe("front eBird layout", () => {
  const slim = (layout) => layout.map(({ num, afterSection, kind }) => ({ num, afterSection, kind }));

  it("flag off matches the frozen legacy implementation", () => {
    for (const sections of [1, 2, 3, 4, 5, 8, 9, 13, 20, 105, 107]) {
      for (const freq of [1, 2, 3, 4, 5, 7]) {
        const config = { moduleFrequency: freq, sectionsPerCable: sections };
        expect(countEBModules(sections, freq)).toBe(legacyCountEBModules(sections, freq));
        const starts = sections > 20 ? [0, 1, 3, 4, 50, 104].filter((s) => s < sections) : [...Array(sections).keys()];
        for (const start of starts) {
          for (let end = start; end < sections; end++) {
            expect(calculateEBRange(start, end, config)).toBe(legacyCalculateEBRange(start, end, config));
          }
        }
      }
    }
  });

  it("flag on, N=4, 12 sections", () => {
    expect(slim(getModuleLayout(12, 4, true))).toEqual([
      { num: 1, afterSection: -1, kind: "front" },
      { num: 2, afterSection: 0, kind: "first" },
      { num: 3, afterSection: 4, kind: "regular" },
      { num: 4, afterSection: 8, kind: "regular" },
      { num: 5, afterSection: 11, kind: "closing" },
    ]);
  });

  it("flag on, N=4: EB01 directly before AS01 and EB02 directly behind it", () => {
    for (const sections of [1, 2, 5]) {
      const layout = slim(getModuleLayout(sections, 4, true));
      expect(layout[0]).toEqual({ num: 1, afterSection: -1, kind: "front" });
      expect(layout[1]).toEqual({ num: 2, afterSection: 0, kind: "first" });
    }
    expect(slim(getModuleLayout(1, 4, true))).toHaveLength(2);
    expect(slim(getModuleLayout(2, 4, true))).toEqual([
      { num: 1, afterSection: -1, kind: "front" },
      { num: 2, afterSection: 0, kind: "first" },
      { num: 3, afterSection: 1, kind: "closing" },
    ]);
  });

  it("flag on, N=1", () => {
    const layout = getModuleLayout(4, 1, true);
    expect(layout.map((m) => m.num)).toEqual([1, 2, 3, 4, 5]);
    expect(layout.map((m) => m.afterSection)).toEqual([-1, 0, 1, 2, 3]);
  });

  it("counts for 105 and 107 sections", () => {
    expect(countEBModules(105, 4, true)).toBe(28);
    expect(countEBModules(105, 4)).toBe(27);
    expect(countEBModules(107, 4, true)).toBe(29);
  });

  it("flag on shifts every flag-off number by one", () => {
    const off = getModuleLayout(107, 4, false);
    const on = getModuleLayout(107, 4, true);
    expect(on[0]).toMatchObject({ num: 1, afterSection: -1, kind: "front" });
    expect(on.slice(1).map((m) => [m.num, m.afterSection])).toEqual(off.map((m) => [m.num + 1, m.afterSection]));
  });

  it("returns an empty layout without sections and falls back to N=4", () => {
    expect(getModuleLayout(0, 4, true)).toEqual([]);
    expect(countEBModules(0, 4, true)).toBe(0);
    expect(getModuleLayout(9, 0)).toEqual(getModuleLayout(9, 4));
    expect(getModuleLayout(9, 2.5)).toEqual(getModuleLayout(9, 4));
  });

  it("calculateEBRange with ebFront", () => {
    const config = { moduleFrequency: 4, sectionsPerCable: 20, ebFront: true };
    expect(calculateEBRange(4, 4, config)).toBe("EB03");
    expect(calculateEBRange(0, 12, config)).toBe("EB05 - EB02");
  });
});

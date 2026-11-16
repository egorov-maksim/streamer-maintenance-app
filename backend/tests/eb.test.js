const { calculateEBRange } = require("../utils/eb");

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

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
});

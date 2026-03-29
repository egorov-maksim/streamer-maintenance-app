const { splitSectionRange, validateRangeForType } = require("../utils/sectionType");

describe("splitSectionRange", () => {
  const cfg = { sectionsPerCable: 10, useRopeForTail: false };

  it("returns active-only when range is entirely before cable end", () => {
    const r = splitSectionRange(0, 5, cfg);
    expect(r.active).toEqual({ start: 0, end: 5 });
    expect(r.tail).toBeNull();
  });

  it("returns tail-only when range is in tail global indices", () => {
    const r = splitSectionRange(10, 12, cfg);
    expect(r.active).toBeNull();
    expect(r.tail).toEqual({ start: 0, end: 2 });
  });

  it("returns null tail when useRopeForTail eliminates tail sections", () => {
    const r = splitSectionRange(10, 10, { sectionsPerCable: 10, useRopeForTail: true });
    expect(r.active).toBeNull();
    expect(r.tail).toBeNull();
  });

  it("splits crossing active and tail", () => {
    const r = splitSectionRange(8, 11, cfg);
    expect(r.active).toEqual({ start: 8, end: 9 });
    expect(r.tail).toEqual({ start: 0, end: 1 });
  });

  it("normalizes inverted start/end", () => {
    const a = splitSectionRange(5, 2, cfg);
    const b = splitSectionRange(2, 5, cfg);
    expect(a).toEqual(b);
  });
});

describe("validateRangeForType", () => {
  it("accepts valid active range", () => {
    const r = validateRangeForType(0, 5, "active", { sectionsPerCable: 10, useRopeForTail: false });
    expect(r.valid).toBe(true);
  });

  it("rejects active range beyond last active section", () => {
    const r = validateRangeForType(0, 10, "active", { sectionsPerCable: 10, useRopeForTail: false });
    expect(r.valid).toBe(false);
    expect(r.message).toBeDefined();
  });

  it("accepts valid tail range", () => {
    const r = validateRangeForType(0, 4, "tail", { sectionsPerCable: 10, useRopeForTail: false });
    expect(r.valid).toBe(true);
  });

  it("rejects tail when rope mode has no tail", () => {
    const r = validateRangeForType(0, 0, "tail", { sectionsPerCable: 10, useRopeForTail: true });
    expect(r.valid).toBe(false);
  });

  it("rejects invalid section_type string", () => {
    const r = validateRangeForType(0, 0, "main", { sectionsPerCable: 10, useRopeForTail: false });
    expect(r.valid).toBe(false);
  });
});

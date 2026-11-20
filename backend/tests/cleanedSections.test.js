const { collectCleanedSections, summarizeSectionCoverage } = require("../utils/cleanedSections");

const ev = (streamerId, start, end, cleanedAt, sectionType = "active") => ({
  streamerId,
  sectionIndexStart: start,
  sectionIndexEnd: end,
  sectionType,
  cleanedAt,
});

describe("collectCleanedSections", () => {
  it("counts unique active and tail sections across overlapping events", () => {
    const config = { sectionsPerCable: 10, sectionsPerCableMap: { 1: 10 } };
    const events = [ev(1, 0, 3), ev(1, 2, 5), ev(1, 0, 1, null, "tail")];
    const { active, tail, all } = collectCleanedSections(events, config);
    expect(active.size).toBe(6);
    expect(tail.size).toBe(2);
    expect(all.size).toBe(8);
    expect(tail.has("1-10")).toBe(true);
  });
});

describe("summarizeSectionCoverage", () => {
  const config = { numCables: 2, sectionsPerCable: 10, sectionsPerCableMap: { 1: 10, 2: 10 }, useRopeForTail: true };
  const window = { windowStart: "2024-03-10", now: "2024-03-21", thresholdDays: 10 };

  it("computes coverage, coverage at window start and overdue sections", () => {
    const events = [ev(1, 0, 4, "2024-03-01T10:00:00.000Z"), ev(1, 5, 9, "2024-03-20T10:00:00.000Z")];
    const s = summarizeSectionCoverage(events, config, window);
    expect(s.cleanedSections).toBe(10);
    expect(s.totalSections).toBe(20);
    expect(s.coveragePct).toBe(50);
    expect(s.coverageAtStartPct).toBe(25);
    expect(s.overdueSections).toBe(15);
    expect(s.totalActiveSections).toBe(20);
    expect(s.lastCleanedAt).toBe("2024-03-20T10:00:00.000Z");
  });

  it("ignores indices outside a streamer's section count", () => {
    const s = summarizeSectionCoverage([ev(1, 0, 40, "2024-03-20T10:00:00.000Z")], config, window);
    expect(s.cleanedSections).toBe(10);
    expect(s.cleanedSections).toBeLessThanOrEqual(s.totalSections);
    expect(s.coveragePct).toBeLessThanOrEqual(100);
  });

  it("reports zero coverage and everything overdue without events", () => {
    const s = summarizeSectionCoverage([], config, window);
    expect(s.coveragePct).toBe(0);
    expect(s.coverageAtStartPct).toBe(0);
    expect(s.lastCleanedAt).toBeNull();
    expect(s.overdueSections).toBe(20);
  });

  it("adds tail sections to the total when the vessel does not use rope for the tail", () => {
    const cfg = { ...config, useRopeForTail: false };
    const s = summarizeSectionCoverage([ev(1, 0, 4, "2024-03-20T10:00:00.000Z", "tail")], cfg, window);
    expect(s.totalSections).toBe(30);
    expect(s.cleanedSections).toBe(5);
    expect(s.coveragePct).toBe(16.7);
    expect(s.totalActiveSections).toBe(20);
  });
});

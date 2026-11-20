const { buildNoiseOverview, buildEfficiencyPairs } = require("../utils/overviewNoise");

const map = { 1: 3, 2: 3 };
const rows = (uploadId, c1, c2) =>
  [1, 2, 3].flatMap((s) => [
    { uploadId, cableNumber: 1, sectionNumber: s, rmsValue: c1 },
    { uploadId, cableNumber: 2, sectionNumber: s, rmsValue: c2 },
  ]);
const up = (id, measuredAt) => ({ id, measuredAt, uploadedAt: measuredAt });
const uploads = [up(1, "2024-02-01T00:00:00.000Z"), up(2, "2024-03-10T00:00:00.000Z")];
const noiseRows = [...rows(1, 10, 4), ...rows(2, 5, 4)];
const START = "2024-02-15T00:00:00.000Z";
const END = "2024-03-16T00:00:00.000Z";

describe("buildNoiseOverview", () => {
  it("computes latest, previous, worst streamers and history", () => {
    const r = buildNoiseOverview(uploads, noiseRows, map, 2, START, END);
    expect(r.latestAvgRms).toBe(4.5);
    expect(r.previousAvgRms).toBe(7);
    expect(r.deltaPct).toBe(-35.7);
    expect(r.worstStreamers[0]).toEqual({ streamerId: 1, avgRms: 5 });
    expect(r.worstStreamers).toHaveLength(2);
    expect(r.rmsHistory).toHaveLength(2);
    expect(r.rmsHistory[0]).toEqual({ uploadId: 1, measuredAt: uploads[0].measuredAt, avgRms: 7 });
    expect(r.uploadsInWindow).toBe(1);
  });

  it("has no previous value when the older upload is inside the window", () => {
    const r = buildNoiseOverview(uploads, noiseRows, map, 2, "2024-01-01T00:00:00.000Z", END);
    expect(r.previousAvgRms).toBeNull();
    expect(r.deltaPct).toBeNull();
    expect(r.uploadsInWindow).toBe(2);
  });

  it("handles no uploads and compares instants, not strings", () => {
    const empty = buildNoiseOverview([], [], map, 2, START, END);
    expect(empty.latestAvgRms).toBeNull();
    expect(empty.rmsHistory).toEqual([]);
    expect(empty.uploadsInWindow).toBe(0);
    const edge = buildNoiseOverview([up(1, "2024-03-16T00:00:00.000Z"), up(2, "2024-02-15T00:00:00.000Z")], [], map, 2, START, END);
    expect(edge.uploadsInWindow).toBe(1); // start inclusive, end exclusive
  });
});

describe("buildEfficiencyPairs", () => {
  const ev = { id: 1, streamerId: 1, sectionIndexStart: 0, sectionIndexEnd: 2, sectionType: "active", cleanedAt: "2024-02-20T00:00:00.000Z" };

  it("computes the improvement of cleaned cells inside the pair", () => {
    const byId = new Map([[1, rows(1, 10, 4)], [2, rows(2, 5, 4)]]);
    const pairs = buildEfficiencyPairs(uploads, byId, [ev]);
    expect(pairs).toEqual([
      {
        beforeUploadId: 1,
        afterUploadId: 2,
        beforeMeasuredAt: uploads[0].measuredAt,
        afterMeasuredAt: uploads[1].measuredAt,
        meanImprovementPct: 50,
        improvedSharePct: 100,
        cellsPaired: 3,
      },
    ]);
  });

  it("ignores events outside the pair (null numbers)", () => {
    const byId = new Map([[1, rows(1, 10, 4)], [2, rows(2, 5, 4)]]);
    const [p] = buildEfficiencyPairs(uploads, byId, [{ ...ev, cleanedAt: "2024-03-12T00:00:00.000Z" }]);
    expect(p.meanImprovementPct).toBeNull();
    expect(p.improvedSharePct).toBeNull();
    expect(p.cellsPaired).toBe(0);
  });

  it("keeps the newest 8 pairs of 12 uploads, oldest first", () => {
    const many = Array.from({ length: 12 }, (_, i) => up(i + 1, new Date(Date.UTC(2024, 0, i + 1)).toISOString()));
    const pairs = buildEfficiencyPairs(many, new Map(), []);
    expect(pairs).toHaveLength(8);
    expect(pairs[0].beforeUploadId).toBe(4);
    expect(pairs[7].afterUploadId).toBe(12);
  });
});

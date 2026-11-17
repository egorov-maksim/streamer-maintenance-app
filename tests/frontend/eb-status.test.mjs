import { latestEbCleaningMap, applyEbCleaningStatus, daysSince } from "../../public/js/eb-status.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-03T12:00:00Z");
const ago = (days) => new Date(NOW - days * DAY).toISOString();

/** Minimal stand-in for an element: the helper only touches dataset, title and aria-label. */
function fakeCell() {
  const attrs = {};
  return { dataset: {}, title: "", setAttribute: (k, v) => { attrs[k] = v; }, attrs };
}

describe("latestEbCleaningMap", () => {
  it("keeps the first (newest) entry per streamer and eBird", () => {
    const map = latestEbCleaningMap([
      { streamerId: 3, ebNumber: 2, cleanedAt: ago(1) },
      { streamerId: 3, ebNumber: 2, cleanedAt: ago(9) },
      { streamerId: 4, ebNumber: 2, cleanedAt: ago(5) },
    ]);
    expect(map.get("3:2")).toBe(ago(1));
    expect(map.get("4:2")).toBe(ago(5));
    expect(map.size).toBe(2);
  });

  it("tolerates a missing list", () => {
    expect(latestEbCleaningMap(undefined).size).toBe(0);
  });
});

describe("applyEbCleaningStatus", () => {
  it("marks a cleaned eBird with its age and status label", () => {
    const cell = fakeCell();
    applyEbCleaningStatus(cell, 3, 2, new Map([["3:2", ago(4)]]), NOW);
    expect(cell.dataset.ebDays).toBe("4");
    expect(cell.title).toBe("Streamer 3, EB02: cleaned 4 days ago");
    expect(cell.attrs["aria-label"]).toBe(cell.title);
  });

  it("leaves an eBird without a date unpainted", () => {
    const cell = fakeCell();
    applyEbCleaningStatus(cell, 3, 2, new Map(), NOW);
    expect(cell.dataset.ebDays).toBeUndefined();
    expect(cell.title).toBe("Streamer 3, EB02: no cleaning date entered");
  });

  it("says today for a date cleaned today or in the future", () => {
    const cell = fakeCell();
    applyEbCleaningStatus(cell, 1, 1, new Map([["1:1", ago(-1)]]), NOW);
    expect(cell.dataset.ebDays).toBe("0");
    expect(cell.title).toBe("Streamer 1, EB01: cleaned today");
  });
});

describe("daysSince", () => {
  it("counts whole days", () => {
    expect(daysSince(ago(1.5), NOW)).toBe(1);
  });
});

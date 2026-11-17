import { latestEbCleaningMap, applyEbCleaningStatus, daysSince, buildEbTooltipHtml } from "../../public/js/eb-status.js";

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
    expect(cell.attrs["aria-label"]).toBe("Streamer 3, EB02: cleaned 4 days ago");
    expect(cell.title).toBe("");
  });

  it("leaves an eBird without a date unpainted", () => {
    const cell = fakeCell();
    applyEbCleaningStatus(cell, 3, 2, new Map(), NOW);
    expect(cell.dataset.ebDays).toBeUndefined();
    expect(cell.attrs["aria-label"]).toBe("Streamer 3, EB02: no cleaning date entered");
  });

  it("says today for a date cleaned today or in the future", () => {
    const cell = fakeCell();
    applyEbCleaningStatus(cell, 1, 1, new Map([["1:1", ago(-1)]]), NOW);
    expect(cell.dataset.ebDays).toBe("0");
    expect(cell.attrs["aria-label"]).toBe("Streamer 1, EB01: cleaned today");
  });
});

describe("daysSince", () => {
  it("counts whole days", () => {
    expect(daysSince(ago(1.5), NOW)).toBe(1);
  });
});

describe("buildEbTooltipHtml", () => {
  it("shows the newest date, its age and up to four earlier dates", () => {
    const entries = [0, 3, 8, 15, 20, 40].map((d) => ({ cleanedAt: ago(d) }));
    const html = buildEbTooltipHtml({ streamerId: 2, ebNumber: 3, entries, now: NOW });
    expect(html).toContain("Streamer 2, EB03");
    expect(html).toContain("0 days ago");
    expect(html).toContain("Earlier dates");
    expect(html.match(/tooltip-value/g)).toHaveLength(5);
  });

  it("marks an age over seven days as old", () => {
    const html = buildEbTooltipHtml({ streamerId: 1, ebNumber: 1, entries: [{ cleanedAt: ago(9) }], now: NOW });
    expect(html).toContain('tooltip-age old');
  });

  it("says no date was entered and leaves out an empty hint", () => {
    const html = buildEbTooltipHtml({ streamerId: 1, ebNumber: 1, entries: [], now: NOW });
    expect(html).toContain("No date entered");
    expect(html).not.toContain("tooltip-section");
  });

  it("adds the hint line when given", () => {
    const html = buildEbTooltipHtml({ streamerId: 1, ebNumber: 1, entries: [], hint: "Read only" });
    expect(html).toContain("Read only");
  });
});

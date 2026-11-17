import { buildSectionTooltipHtml, sectionEventsNewestFirst } from "../../public/js/section-tooltip.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-03T12:00:00Z");
const ago = (days) => new Date(NOW - days * DAY).toISOString();

const ev = (o) => ({ streamerId: 10, sectionType: "active", sectionIndexStart: 0, sectionIndexEnd: 9, cleaningMethod: "rope", cleanedAt: ago(1), ...o });

const base = { streamerId: 10, sectionIndex: 5, isTail: false, relIndex: 5, sectionLabel: "AS06", now: NOW };

describe("sectionEventsNewestFirst", () => {
  it("keeps only events covering the section, newest first", () => {
    const events = [
      ev({ cleanedAt: ago(10), cleaningMethod: "scraper" }),
      ev({ cleanedAt: ago(2) }),
      ev({ streamerId: 9 }),
      ev({ sectionIndexStart: 6 }),
      ev({ sectionType: "tail" }),
    ];
    const out = sectionEventsNewestFirst(events, 10, 5, false, 5);
    expect(out.map((e) => e.cleanedAt)).toEqual([ago(2), ago(10)]);
  });

  it("matches tail sections by their index within the tail", () => {
    const events = [ev({ sectionType: "tail", sectionIndexStart: 1, sectionIndexEnd: 1 })];
    expect(sectionEventsNewestFirst(events, 10, 13, true, 1)).toHaveLength(1);
    expect(sectionEventsNewestFirst(events, 10, 12, true, 0)).toHaveLength(0);
  });
});

describe("buildSectionTooltipHtml", () => {
  it("shows last method, days ago, total count and at most five recent cleanings", () => {
    const events = [
      ev({ cleanedAt: ago(42), cleaningMethod: "scraper-rope", cleaningCount: 2 }),
      ...[50, 60, 70, 80, 90].map((d) => ev({ cleanedAt: ago(d) })),
    ];
    const html = buildSectionTooltipHtml({ ...base, events });
    expect(html).toContain("Streamer 10, Section AS06");
    expect(html).toContain(">scraper-rope<");
    expect(html).toContain("42 days ago");
    expect(html).toMatch(/Total Times Cleaned<\/span>\s*<span class="tooltip-value">7</);
    expect(html.match(/class="tooltip-method"/g)).toHaveLength(5);
  });

  it("says Never when the section has no cleanings", () => {
    const html = buildSectionTooltipHtml({ ...base, events: [] });
    expect(html).toContain("Never");
    expect(html).not.toContain("Last 5 cleanings");
  });

  it("includes extra markup such as RMS noise", () => {
    const html = buildSectionTooltipHtml({ ...base, events: [], extraHtml: "<b>RMS 24.16</b>" });
    expect(html).toContain("<b>RMS 24.16</b>");
  });

  it("escapes stored method names", () => {
    const html = buildSectionTooltipHtml({ ...base, events: [ev({ cleaningMethod: "<img>" })] });
    expect(html).not.toContain("<img>");
    expect(html).toContain("&lt;img&gt;");
  });

  it("lists methods left out of the count", () => {
    const html = buildSectionTooltipHtml({ ...base, events: [], disabledMethods: ["scue"] });
    expect(html).toContain("Not counted: SCUE");
  });
});

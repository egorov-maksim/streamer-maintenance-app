import {
  DEFAULT_TOOLTIP_RECENT_COUNT,
  parseTooltipRecentCount,
  loadTooltipRecentCount,
  saveTooltipRecentCount,
} from "../../public/js/tooltip-history-prefs.js";

function fakeStorage() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

describe("tooltip recent-cleanings preference", () => {
  beforeEach(() => { globalThis.localStorage = fakeStorage(); });
  afterAll(() => { delete globalThis.localStorage; });

  it("defaults to 3", () => {
    expect(DEFAULT_TOOLTIP_RECENT_COUNT).toBe(3);
    expect(loadTooltipRecentCount()).toBe(3);
  });

  it("remembers a saved count", () => {
    expect(saveTooltipRecentCount("6")).toBe(6);
    expect(loadTooltipRecentCount()).toBe(6);
  });

  it("clamps to 1..20 and ignores unusable input", () => {
    expect(parseTooltipRecentCount(0)).toBe(1);
    expect(parseTooltipRecentCount(99)).toBe(20);
    expect(parseTooltipRecentCount("2.6")).toBe(3);
    expect(parseTooltipRecentCount("")).toBeNull();
    expect(parseTooltipRecentCount("abc")).toBeNull();
    saveTooltipRecentCount(4);
    expect(saveTooltipRecentCount("abc")).toBe(4);
    expect(loadTooltipRecentCount()).toBe(4);
  });

  it("falls back to the default when the stored value is junk", () => {
    localStorage.setItem("tooltipRecentCleanings", "nope");
    expect(loadTooltipRecentCount()).toBe(3);
  });
});

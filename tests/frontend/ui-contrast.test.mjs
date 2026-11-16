import { scrapingAgeStyle, readableTextColor } from "../../public/js/heatmap-legend.js";
import { methodLabel } from "../../public/js/ui.js";

/** WCAG contrast ratio between two "rgb(r,g,b)" / "#rrggbb" colours. */
function contrast(a, b) {
  const parse = (c) =>
    c.startsWith("#")
      ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
      : c.match(/\d+/g).slice(0, 3).map(Number);
  const lum = (c) => {
    const [r, g, bl] = parse(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("heatmap cell text contrast", () => {
  const prefs = { ageBreaks: [4, 7, 10, 14] };

  it("keeps the section number readable (4.5:1) for every age and for never-cleaned cells", () => {
    for (const days of [null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 20, 60]) {
      const style = scrapingAgeStyle(days, prefs);
      expect(contrast(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses white text on dark backgrounds and dark text on light ones", () => {
    expect(readableTextColor(15, 23, 42)).toBe("#ffffff");
    expect(readableTextColor(253, 224, 71)).toBe("#111827");
  });
});

describe("methodLabel", () => {
  it("shows stored method values under the names used on the method tiles", () => {
    expect(methodLabel("scue")).toBe("SCUE");
    expect(methodLabel("scraper-rope")).toBe("Scraper&Rope");
    expect(methodLabel("rope")).toBe("Rope");
  });

  it("falls back to the stored value for unknown methods", () => {
    expect(methodLabel("pressure-wash")).toBe("pressure-wash");
    expect(methodLabel(null)).toBe("");
  });
});

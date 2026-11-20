import { formatDelta, deltaTone, formatKm, formatDays } from "../../public/js/overview-format.js";

describe("formatDelta", () => {
  it("shows an arrow, sign and unit", () => {
    expect(formatDelta(12, "pct")).toBe("▲ +12%");
    expect(formatDelta(-3, "pct")).toBe("▼ -3%");
    expect(formatDelta(5, "pts")).toBe("▲ +5 pts");
    expect(formatDelta(-2.5, "pts")).toBe("▼ -2.5 pts");
  });
  it("handles zero and missing values", () => {
    expect(formatDelta(0, "pct")).toBe("= 0%");
    expect(formatDelta(0, "pts")).toBe("= 0 pts");
    expect(formatDelta(null, "pct")).toBe("—");
    expect(formatDelta(undefined, "pts")).toBe("—");
    expect(formatDelta(NaN, "pct")).toBe("—");
  });
});

describe("deltaTone", () => {
  it("treats higher as good for coverage-like keys", () => {
    for (const k of ["coverage", "distance", "improvement", "events"]) {
      expect(deltaTone(k, 5)).toBe("good");
      expect(deltaTone(k, -5)).toBe("bad");
    }
  });
  it("treats higher as bad for noise, overdue and days since cleaning", () => {
    for (const k of ["noise", "overdue", "daysSinceCleaning"]) {
      expect(deltaTone(k, 8)).toBe("bad");
      expect(deltaTone(k, -8)).toBe("good");
    }
  });
  it("is neutral for zero, null and unknown keys", () => {
    expect(deltaTone("coverage", 0)).toBe("neutral");
    expect(deltaTone("noise", 0)).toBe("neutral");
    expect(deltaTone("x", null)).toBe("neutral");
    expect(deltaTone("x", 4)).toBe("neutral");
  });
});

describe("formatKm", () => {
  it("uses one decimal and thousands separators", () => {
    expect(formatKm(12.345)).toBe("12.3");
    expect(formatKm(0)).toBe("0.0");
    expect(formatKm(1234.56)).toBe("1,234.6");
  });
  it("shows a dash for missing values", () => {
    expect(formatKm(null)).toBe("—");
    expect(formatKm(NaN)).toBe("—");
  });
});

describe("formatDays", () => {
  it("formats day counts", () => {
    expect(formatDays(0)).toBe("today");
    expect(formatDays(1)).toBe("1 d");
    expect(formatDays(4)).toBe("4 d");
  });
  it("says no data for null", () => {
    expect(formatDays(null)).toBe("no data");
    expect(formatDays(undefined)).toBe("no data");
  });
});

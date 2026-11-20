const { parseDays, buildPeriods, kpi, deltaPoints, fillDailyKm } = require("../utils/overviewPeriods");

describe("overviewPeriods", () => {
  it("parseDays defaults to 30 and accepts only 7/30/90", () => {
    expect(parseDays(undefined)).toBe(30);
    expect(parseDays("")).toBe(30);
    expect(parseDays("7")).toBe(7);
    expect(parseDays("90")).toBe(90);
    expect(parseDays("14")).toBeNull();
    expect(parseDays("abc")).toBeNull();
  });

  it("buildPeriods uses whole UTC days ending at the start of tomorrow", () => {
    expect(buildPeriods(30, new Date("2024-03-15T10:00:00Z"))).toEqual({
      end: "2024-03-16T00:00:00.000Z",
      start: "2024-02-15T00:00:00.000Z",
      prevStart: "2024-01-16T00:00:00.000Z",
    });
  });

  it("kpi computes a one-decimal percentage delta or null", () => {
    expect(kpi(10, 8)).toEqual({ value: 10, previous: 8, deltaPct: 25 });
    expect(kpi(10, 3).deltaPct).toBe(233.3);
    expect(kpi(5, 0).deltaPct).toBeNull();
    expect(kpi(null, 3).deltaPct).toBeNull();
    expect(kpi(3, null).deltaPct).toBeNull();
  });

  it("deltaPoints subtracts percentages", () => {
    expect(deltaPoints(68, 63)).toBe(5);
    expect(deltaPoints(null, 63)).toBeNull();
    expect(deltaPoints(10.3, 10.1)).toBe(0.2);
  });

  it("fillDailyKm lists every UTC day of the window and fills gaps with 0 km", () => {
    const rows = [
      { date: "2024-03-10", meters: 300 },
      { date: "2024-03-12", meters: 200 },
    ];
    expect(fillDailyKm(rows, "2024-03-09T00:00:00.000Z", "2024-03-14T00:00:00.000Z")).toEqual([
      { date: "2024-03-09", km: 0 },
      { date: "2024-03-10", km: 0.3 },
      { date: "2024-03-11", km: 0 },
      { date: "2024-03-12", km: 0.2 },
      { date: "2024-03-13", km: 0 },
    ]);
    expect(fillDailyKm([], "2024-03-09T00:00:00.000Z", "2024-03-10T00:00:00.000Z")).toEqual([{ date: "2024-03-09", km: 0 }]);
  });
});

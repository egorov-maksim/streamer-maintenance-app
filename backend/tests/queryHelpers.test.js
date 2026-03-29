const { buildEventsWhereClause } = require("../utils/queryHelpers");

describe("buildEventsWhereClause", () => {
  it("returns empty clause when no filters", () => {
    const { sql, params } = buildEventsWhereClause({});
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  it("filters by project_number", () => {
    const { sql, params } = buildEventsWhereClause({ project: "P99" });
    expect(sql).toContain("project_number = ?");
    expect(params).toEqual(["P99"]);
  });

  it("adds date range when start and end provided", () => {
    const { sql, params } = buildEventsWhereClause({
      project: "P1",
      start: "2024-01-01",
      end: "2024-01-31",
    });
    expect(sql).toContain("DATE(cleaned_at) BETWEEN");
    expect(params).toEqual(["P1", "2024-01-01", "2024-01-31"]);
  });

  it("uses open start when only start provided", () => {
    const { sql, params } = buildEventsWhereClause({ start: "2024-06-01" });
    expect(sql).toContain(">=");
    expect(params).toEqual(["2024-06-01"]);
  });

  it("uses open end when only end provided", () => {
    const { sql, params } = buildEventsWhereClause({ end: "2024-06-30" });
    expect(sql).toContain("<=");
    expect(params).toEqual(["2024-06-30"]);
  });

  it("handles missing project with valid dates", () => {
    const { sql, params } = buildEventsWhereClause({
      start: "2024-01-01",
      end: "2024-01-02",
    });
    expect(sql.includes("WHERE")).toBe(true);
    expect(params.length).toBe(2);
  });
});

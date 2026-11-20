const { app, request, resetDb, login, createProject, activateProject } = require("./helpers/app");
const { runAsync } = require("../db");
const {
  computeSectionCleanCounts,
  groupSectionCleanCounts,
  rankMostCleaned,
  summarizeByStreamer,
} = require("../utils/sectionCleanCounts");

const evt = (streamerId, start, end, extra = {}) => ({
  streamerId,
  sectionIndexStart: start,
  sectionIndexEnd: end,
  sectionType: "active",
  cleaningMethod: "rope",
  cleanedAt: "2024-03-10T10:00:00.000Z",
  cleaningCount: 1,
  ...extra,
});

const countsOf = (sections, streamerId, sectionType = "active") =>
  Object.fromEntries(
    sections.filter((s) => s.streamerId === streamerId && s.sectionType === sectionType).map((s) => [s.sectionIndex, s.count])
  );

describe("computeSectionCleanCounts", () => {
  it("counts each section once per event that covers it", () => {
    const sections = computeSectionCleanCounts([evt(1, 0, 3), evt(1, 2, 5), evt(1, 3, 3)]);
    expect(countsOf(sections, 1)).toEqual({ 0: 1, 1: 1, 2: 2, 3: 3, 4: 1, 5: 1 });
  });

  it("keeps streamers apart and tail sections apart from active ones", () => {
    const sections = computeSectionCleanCounts([evt(1, 0, 1), evt(2, 0, 1), evt(1, 0, 1, { sectionType: "tail" })]);
    expect(countsOf(sections, 1)).toEqual({ 0: 1, 1: 1 });
    expect(countsOf(sections, 2)).toEqual({ 0: 1, 1: 1 });
    expect(countsOf(sections, 1, "tail")).toEqual({ 0: 1, 1: 1 });
  });

  it("treats an inverted range like an ordered one", () => {
    expect(countsOf(computeSectionCleanCounts([evt(1, 4, 2)]), 1)).toEqual({ 2: 1, 3: 1, 4: 1 });
  });

  it("leaves out active sections beyond a streamer's sections override", () => {
    const sections = computeSectionCleanCounts([evt(1, 2, 7), evt(2, 2, 7), evt(1, 0, 4, { sectionType: "tail" })], {
      sectionsPerCable: 8,
      sectionsPerCableMap: { 1: 4, 2: 8 },
    });
    expect(countsOf(sections, 1)).toEqual({ 2: 1, 3: 1 });
    expect(Object.keys(countsOf(sections, 2))).toHaveLength(6);
    // Tail sections are not limited by the active-section count.
    expect(Object.keys(countsOf(sections, 1, "tail"))).toHaveLength(5);
  });

  it("adds an event's cleaning_count and falls back to 1 for missing or invalid values", () => {
    const sections = computeSectionCleanCounts([
      evt(1, 0, 0, { cleaningCount: 3 }),
      evt(1, 0, 0, { cleaningCount: null }),
      evt(1, 0, 0, { cleaningCount: 0 }),
      evt(1, 0, 0, { cleaningCount: -2 }),
    ]);
    expect(countsOf(sections, 1)).toEqual({ 0: 6 });
  });

  it("splits the count by method and keeps the latest cleaning date", () => {
    const [section] = computeSectionCleanCounts([
      evt(1, 0, 0, { cleaningMethod: "rope", cleanedAt: "2024-03-01T00:00:00.000Z" }),
      evt(1, 0, 0, { cleaningMethod: "scraper", cleanedAt: "2024-03-09T00:00:00.000Z" }),
      evt(1, 0, 0, { cleaningMethod: "rope", cleanedAt: "2024-03-05T00:00:00.000Z" }),
    ]);
    expect(section.byMethod).toEqual({ rope: 2, scraper: 1 });
    expect(section.lastCleanedAt).toBe("2024-03-09T00:00:00.000Z");
  });
});

describe("most frequently cleaned ranking", () => {
  const sections = computeSectionCleanCounts([evt(1, 0, 9), evt(1, 3, 5), evt(1, 4, 4), evt(2, 0, 1), evt(2, 0, 1)]);
  const groups = groupSectionCleanCounts(sections);

  it("joins neighbouring sections with the same count into one range", () => {
    const streamer1 = groups.filter((g) => g.streamerId === 1).map((g) => [g.sectionIndexStart, g.sectionIndexEnd, g.count]);
    expect(streamer1).toEqual([
      [0, 2, 1],
      [3, 3, 2],
      [4, 4, 3],
      [5, 5, 2],
      [6, 9, 1],
    ]);
  });

  it("does not join sections cleaned equally often by different methods", () => {
    const mixed = groupSectionCleanCounts(
      computeSectionCleanCounts([evt(1, 0, 0), evt(1, 1, 1, { cleaningMethod: "scraper" })])
    );
    expect(mixed).toHaveLength(2);
  });

  it("ranks the highest count first and applies the limit", () => {
    const top = rankMostCleaned(groups, 2);
    expect(top.map((g) => [g.streamerId, g.sectionIndexStart, g.sectionIndexEnd, g.count])).toEqual([
      [1, 4, 4, 3],
      [2, 0, 1, 2],
    ]);
  });

  it("summarizes per streamer", () => {
    expect(summarizeByStreamer(sections)).toEqual([
      { streamerId: 1, sectionsCleaned: 10, totalCleanings: 14, maxCount: 3 },
      { streamerId: 2, sectionsCleaned: 2, totalCleanings: 4, maxCount: 2 },
    ]);
  });
});

describe("GET /api/stats/section-clean-counts", () => {
  let auth;

  async function addEvent(projectNumber, vesselTag, streamerId, start, end, cleanedAt, method = "rope") {
    await runAsync(
      `INSERT INTO cleaning_events
         (streamer_id, section_index_start, section_index_end, section_type, cleaning_method, cleaned_at, project_number, vessel_tag)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
      [streamerId, start, end, method, cleanedAt, projectNumber, vesselTag]
    );
  }

  const get = (query, who = auth) => request(app).get(`/api/stats/section-clean-counts${query}`).set("Authorization", who);

  beforeEach(async () => {
    await resetDb();
    const ttn = await createProject({ projectNumber: "TTN-1", vesselTag: "TTN", numCables: 2, sectionsPerCable: 8 });
    await createProject({ projectNumber: "RAM-1", vesselTag: "RAM", numCables: 2, sectionsPerCable: 8 });
    await activateProject(ttn);
    // Streamer 2 is shorter than the project default.
    await runAsync("INSERT INTO streamer_deployments (project_id, streamer_id, sections_per_cable) VALUES (?, 2, 4)", [ttn.id]);
    await addEvent("TTN-1", "TTN", 1, 0, 5, "2024-03-01T10:00:00.000Z");
    await addEvent("TTN-1", "TTN", 1, 2, 3, "2024-03-05T10:00:00.000Z", "scraper");
    await addEvent("TTN-1", "TTN", 1, 2, 3, "2024-03-09T10:00:00.000Z");
    await addEvent("TTN-1", "TTN", 2, 0, 7, "2024-03-09T10:00:00.000Z");
    await addEvent("RAM-1", "RAM", 1, 0, 7, "2024-03-09T10:00:00.000Z");
    auth = await login("ttnviewer");
  });

  it("returns per-section counts and the most cleaned range for a project", async () => {
    const res = await get("?project=TTN-1");
    expect(res.status).toBe(200);
    expect(res.body.maxCount).toBe(3);
    expect(res.body.mostCleaned[0]).toMatchObject({
      streamerId: 1,
      sectionType: "active",
      sectionIndexStart: 2,
      sectionIndexEnd: 3,
      sectionCount: 2,
      count: 3,
      byMethod: { rope: 2, scraper: 1 },
      lastCleanedAt: "2024-03-09T10:00:00.000Z",
    });
    expect(countsOf(res.body.sections, 1)).toEqual({ 0: 1, 1: 1, 2: 3, 3: 3, 4: 1, 5: 1 });
  });

  it("applies the per-streamer sections override", async () => {
    const res = await get("?project=TTN-1");
    expect(countsOf(res.body.sections, 2)).toEqual({ 0: 1, 1: 1, 2: 1, 3: 1 });
    expect(res.body.perStreamer).toEqual([
      { streamerId: 1, sectionsCleaned: 6, totalCleanings: 10, maxCount: 3 },
      { streamerId: 2, sectionsCleaned: 4, totalCleanings: 4, maxCount: 1 },
    ]);
    expect(res.body.sectionsCleaned).toBe(10);
    expect(res.body.totalCleanings).toBe(14);
  });

  it("applies the date filter", async () => {
    const res = await get("?project=TTN-1&start=2024-03-04&end=2024-03-06");
    expect(countsOf(res.body.sections, 1)).toEqual({ 2: 1, 3: 1 });
    expect(res.body.mostCleaned).toHaveLength(1);
  });

  it("honours the ranking limit", async () => {
    const res = await get("?project=TTN-1&limit=1");
    expect(res.body.mostCleaned).toHaveLength(1);
  });

  it("returns an empty result when nothing was cleaned", async () => {
    const res = await get("?project=TTN-1&start=2030-01-01&end=2030-01-02");
    expect(res.body).toMatchObject({ sectionsCleaned: 0, totalCleanings: 0, maxCount: 0, mostCleaned: [], sections: [] });
  });

  it("keeps a vessel-scoped user out of another vessel's project", async () => {
    expect((await get("?project=RAM-1")).status).toBe(403);
    // Without a project, only the caller's own vessel is counted.
    const res = await get("");
    expect(res.body.totalCleanings).toBe(14);
  });

  it("requires a login", async () => {
    const res = await request(app).get("/api/stats/section-clean-counts?project=TTN-1");
    expect(res.status).toBe(401);
  });
});

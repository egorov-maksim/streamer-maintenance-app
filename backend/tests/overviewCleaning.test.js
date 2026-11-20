const { request, app, resetDb, login, createProject, activateProject } = require("./helpers/app");
const { runAsync } = require("../db");

const NOW = new Date("2024-03-15T10:00:00.000Z");
// days=30: start 2024-02-15T00:00Z, end 2024-03-16T00:00Z, prevStart 2024-01-16T00:00Z

async function addEvent(project, { start = 0, end = 3, at, streamer = 1, type = "active" }) {
  await runAsync(
    `INSERT INTO cleaning_events
       (streamer_id, section_index_start, section_index_end, cleaning_method, cleaned_at, project_number, vessel_tag, section_type)
     VALUES (?, ?, ?, 'rope', ?, ?, ?, ?)`,
    [streamer, start, end, at, project.projectNumber, project.vesselTag, type]
  );
}

async function setLength(project, len) {
  await runAsync("UPDATE projects SET section_length = ? WHERE project_number = ?", [len, project.projectNumber]);
}

const get = (path, token) => request(app).get(path).set("Authorization", token);

describe("GET /api/overview (cleaning)", () => {
  let sup;
  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask"] });
    jest.setSystemTime(NOW);
    await resetDb();
    sup = await login("sup");
  });
  afterEach(() => jest.useRealTimers());

  it("validates input and roles", async () => {
    await createProject({ projectNumber: "A", vesselTag: "TTN" });
    expect((await get("/api/overview", sup)).status).toBe(400);
    expect((await get("/api/overview?vessel=TTN&days=14", sup)).status).toBe(400);
    expect((await get("/api/overview?vessel=NOPE", sup)).status).toBe(404);
    expect((await get("/api/overview?vessel=TTN", await login("ttnadmin"))).status).toBe(403);
    expect((await get("/api/overview?vessel=TTN", await login("grand"))).status).toBe(200);
    expect((await get("/api/overview/vessels", await login("ttnadmin"))).status).toBe(403);
  });

  it("lists vessels sorted", async () => {
    await createProject({ projectNumber: "B", vesselTag: "TTN" });
    await createProject({ projectNumber: "C", vesselTag: "RAM" });
    await createProject({ projectNumber: "D", vesselTag: "TTN" });
    const res = await get("/api/overview/vessels", sup);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ vessels: ["RAM", "TTN"] });
  });

  it("sums distance and events across all of the vessel's projects", async () => {
    const a = await createProject({ projectNumber: "A", vesselTag: "TTN" });
    const b = await createProject({ projectNumber: "B", vesselTag: "TTN" });
    await activateProject(a);
    await setLength(a, 75);
    await setLength(b, 50);
    await addEvent(a, { at: "2024-03-10T10:00:00.000Z" });
    await addEvent(b, { at: "2024-03-11T10:00:00.000Z" });
    const res = await get("/api/overview?vessel=TTN&days=30", sup);
    expect(res.status).toBe(200);
    expect(res.body.vessel).toBe("TTN");
    expect(res.body.days).toBe(30);
    expect(res.body.project).toEqual({ projectNumber: "A", projectName: null });
    expect(res.body.cleaning.distanceKm.value).toBe((4 * 75 + 4 * 50) / 1000);
    expect(res.body.cleaning.events.value).toBe(2);
    expect(res.body.cleaning.dailyDistanceKm).toEqual([
      { date: "2024-03-10", km: 0.3 },
      { date: "2024-03-11", km: 0.2 },
    ]);
    expect(res.body.freshness.lastCleaningAt).toBe("2024-03-11T10:00:00.000Z");
    expect(res.body.freshness.daysSinceLastCleaning).toBe(4);
    expect(res.body.freshness.lastNoiseUploadAt).toBeNull();
  });

  it("applies window boundaries, date-only values and the previous window", async () => {
    const a = await createProject({ projectNumber: "A", vesselTag: "TTN" });
    await activateProject(a);
    await setLength(a, 100);
    await addEvent(a, { at: "2024-02-15T00:00:00.000Z" }); // exactly start: in
    await addEvent(a, { at: "2024-03-16T00:00:00.000Z" }); // exactly end: out
    await addEvent(a, { at: "2024-03-10" }); // date-only: in
    await addEvent(a, { at: "2024-02-14T23:59:59.000Z" }); // previous
    const res = await get("/api/overview?vessel=TTN&days=30", sup);
    expect(res.body.cleaning.events).toEqual({ value: 2, previous: 1, deltaPct: 100 });
    expect(res.body.cleaning.distanceKm).toEqual({ value: 0.8, previous: 0.4, deltaPct: 100 });
  });

  it("coverage matches /api/stats and ignores other projects", async () => {
    const a = await createProject({ projectNumber: "A", vesselTag: "TTN", numCables: 2, sectionsPerCable: 10, useRopeForTail: 0 });
    const b = await createProject({ projectNumber: "B", vesselTag: "TTN", numCables: 2, sectionsPerCable: 10 });
    await activateProject(a);
    await addEvent(a, { at: "2024-03-10T10:00:00.000Z", start: 0, end: 4 });
    await addEvent(a, { at: "2024-01-10T10:00:00.000Z", start: 5, end: 6, streamer: 2 });
    await addEvent(a, { at: "2024-03-12T10:00:00.000Z", start: 0, end: 1, type: "tail" });
    await addEvent(b, { at: "2024-03-12T10:00:00.000Z", start: 0, end: 9, streamer: 2 });
    const res = await get("/api/overview?vessel=TTN&days=30", sup);
    const stats = (await get("/api/stats?project=A", await login("grand"))).body;
    const c = res.body.cleaning.coverage;
    expect(c.cleanedSections).toBe(stats.uniqueCleanedSections);
    expect(c.totalSections).toBe(stats.totalAvailableSections + stats.totalAvailableTail);
    expect(c.cleanedSections).toBe(9);
    expect(c.atWindowStartPct).toBe(Math.round((2 / 30) * 1000) / 10);
    expect(c.deltaPoints).toBe(Math.round((c.pct - c.atWindowStartPct) * 10) / 10);
    expect(res.body.cleaning.overdueSections).toEqual({ count: 20 - 5, thresholdDays: 10, totalActiveSections: 20 });
  });

  it("handles a vessel with no active project and no events", async () => {
    await createProject({ projectNumber: "A", vesselTag: "RAM" });
    const res = await get("/api/overview?vessel=RAM", sup);
    expect(res.status).toBe(200);
    expect(res.body.project).toBeNull();
    expect(res.body.cleaning.coverage).toBeNull();
    expect(res.body.cleaning.overdueSections).toBeNull();
    expect(res.body.cleaning.dailyDistanceKm).toEqual([]);
    expect(res.body.cleaning.distanceKm.value).toBe(0);
    expect(res.body.freshness.lastCleaningAt).toBeNull();
    expect(res.body.freshness.daysSinceLastCleaning).toBeNull();
  });
});

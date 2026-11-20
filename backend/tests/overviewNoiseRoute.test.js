const { request, app, resetDb, login, createProject, activateProject } = require("./helpers/app");
const { runAsync } = require("../db");

const NOW = new Date("2024-03-15T10:00:00.000Z");
const get = (path, token) => request(app).get(path).set("Authorization", token);

async function addUpload(project, recordedAt, rmsByCable) {
  const res = await runAsync(
    "INSERT INTO noise_uploads (project_number, vessel_tag, recorded_at) VALUES (?, ?, ?)",
    [project.projectNumber, project.vesselTag, recordedAt]
  );
  const id = res.lastID;
  for (const [cable, rms] of Object.entries(rmsByCable)) {
    for (let s = 1; s <= 3; s++) {
      await runAsync("INSERT INTO noise_data (upload_id, cable_number, section_number, rms_value) VALUES (?, ?, ?, ?)", [
        id,
        Number(cable),
        s,
        rms,
      ]);
    }
  }
  return id;
}

async function addEvent(project, at, { start = 0, end = 2, streamer = 1 } = {}) {
  await runAsync(
    `INSERT INTO cleaning_events
       (streamer_id, section_index_start, section_index_end, cleaning_method, cleaned_at, project_number, vessel_tag, section_type)
     VALUES (?, ?, ?, 'rope', ?, ?, ?, 'active')`,
    [streamer, start, end, at, project.projectNumber, project.vesselTag]
  );
}

describe("GET /api/overview (noise and efficiency)", () => {
  let sup;
  let p;
  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask"] });
    jest.setSystemTime(NOW);
    await resetDb();
    sup = await login("sup");
    p = await createProject({ projectNumber: "A", vesselTag: "TTN", numCables: 2, sectionsPerCable: 3, useRopeForTail: 0 });
    await activateProject(p);
  });
  afterEach(() => jest.useRealTimers());

  it("reports noise, efficiency and freshness; matches the stats endpoint", async () => {
    const u1 = await addUpload(p, "2024-03-01T00:00:00.000Z", { 1: 10, 2: 4 });
    const u2 = await addUpload(p, "2024-03-12T00:00:00.000Z", { 1: 5, 2: 4 });
    await addEvent(p, "2024-03-05T10:00:00.000Z");
    await addEvent(p, "2024-03-06T10:00:00.000Z", { streamer: 2 });
    const res = await get("/api/overview?vessel=TTN&days=30", sup);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.freshness.lastNoiseUploadAt).toBe("2024-03-12T00:00:00.000Z");
    expect(b.freshness.daysSinceLastNoiseUpload).toBe(3);
    expect(b.noise.latestAvgRms).toBe(4.5);
    expect(b.noise.previousAvgRms).toBeNull(); // both uploads inside the 30 day window
    expect(b.noise.uploadsInWindow).toBe(2);
    expect(b.noise.worstStreamers[0]).toEqual({ streamerId: 1, avgRms: 5 });
    expect(b.noise.rmsHistory).toHaveLength(2);
    expect(b.efficiency.status).toBe("ok");
    expect(b.efficiency.reason).toBeNull();
    // cable 1: 50% ; cable 2: 0% -> mean 25, improved share 50
    expect(b.efficiency.meanImprovementPct).toBe(25);
    expect(b.efficiency.improvedSharePct).toBe(50);
    expect(b.efficiency.pairs).toHaveLength(1);
    expect(b.efficiency.distancePerCleaningDayKm).toBe(0.225); // 6 sections * 75 m / 2 days
    const stats = (
      await get(`/api/stats/cleaning-noise-efficiency?project=A&uploadBeforeId=${u1}&uploadAfterId=${u2}`, await login("grand"))
    ).body;
    expect(b.efficiency.meanImprovementPct).toBe(stats.meanImprovementPct);
    expect(b.efficiency.improvedSharePct).toBe(stats.improvedSharePct);
  });

  it("insufficient_uploads with one upload", async () => {
    await addUpload(p, "2024-03-12T00:00:00.000Z", { 1: 5, 2: 4 });
    const b = (await get("/api/overview?vessel=TTN", sup)).body;
    expect(b.efficiency.status).toBe("insufficient_uploads");
    expect(b.efficiency.reason).toEqual(expect.any(String));
    expect(b.efficiency.reason.length).toBeGreaterThan(0);
    expect(b.efficiency.meanImprovementPct).toBeNull();
    expect(b.efficiency.pairs).toEqual([]);
    expect(b.noise.latestAvgRms).toBe(4.5);
  });

  it("no_events when nothing was cleaned between the newest uploads", async () => {
    await addUpload(p, "2024-03-01T00:00:00.000Z", { 1: 10, 2: 4 });
    await addUpload(p, "2024-03-12T00:00:00.000Z", { 1: 5, 2: 4 });
    await addEvent(p, "2024-02-20T10:00:00.000Z");
    const b = (await get("/api/overview?vessel=TTN", sup)).body;
    expect(b.efficiency.status).toBe("no_events");
    expect(b.efficiency.reason.length).toBeGreaterThan(0);
    expect(b.efficiency.meanImprovementPct).toBeNull();
    expect(b.efficiency.improvedSharePct).toBeNull();
    expect(b.efficiency.pairs).toHaveLength(1);
    expect(b.efficiency.distancePerCleaningDayKm).toBe(0.225); // independent of noise: one cleaning day in the window
  });

  it("previous average and days since come from uploads before the window", async () => {
    await addUpload(p, "2024-01-20T00:00:00.000Z", { 1: 10, 2: 4 });
    await addUpload(p, "2024-03-15T01:00:00.000Z", { 1: 5, 2: 4 });
    const b = (await get("/api/overview?vessel=TTN&days=30", sup)).body;
    expect(b.noise.previousAvgRms).toBe(7);
    expect(b.noise.deltaPct).toBe(-35.7);
    expect(b.noise.uploadsInWindow).toBe(1);
    expect(b.freshness.daysSinceLastNoiseUpload).toBe(0);
  });

  it("returns nulls without an active project", async () => {
    await resetDb();
    await createProject({ projectNumber: "B", vesselTag: "RAM" });
    const res = await get("/api/overview?vessel=RAM", sup);
    expect(res.status).toBe(200);
    expect(res.body.noise).toBeNull();
    expect(res.body.efficiency.status).toBe("no_active_project");
    expect(res.body.freshness.lastNoiseUploadAt).toBeNull();
    expect(res.body.freshness.daysSinceLastNoiseUpload).toBeNull();
  });

  it("an active project without uploads has empty noise", async () => {
    const b = (await get("/api/overview?vessel=TTN", sup)).body;
    expect(b.noise.latestAvgRms).toBeNull();
    expect(b.noise.rmsHistory).toEqual([]);
    expect(b.efficiency.status).toBe("insufficient_uploads");
    expect(b.freshness.lastNoiseUploadAt).toBeNull();
  });
});

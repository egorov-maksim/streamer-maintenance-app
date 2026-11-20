const { app, request, resetDb, login, createProject } = require("./helpers/app");
const { runAsync } = require("../db");
const { toIsoUtc, parseRecordedAt, withMeasuredAt } = require("../utils/noiseUploadTime");

const noiseData = { 1: { 1: 4, 2: 4, 3: 4, 4: 4 } };
const quieter = { 1: { 1: 2, 2: 2, 3: 2, 4: 2 } };

describe("noise upload sequence time", () => {
  let auth;
  beforeEach(async () => {
    await resetDb();
    await createProject({ projectNumber: "TTN-1", numCables: 2, sectionsPerCable: 4 });
    auth = await login("ttnadmin");
  });

  const upload = (body) =>
    request(app).post("/api/noise-data").set("Authorization", auth).send({ projectNumber: "TTN-1", noiseData, ...body });
  const list = () => request(app).get("/api/noise-data/uploads?project=TTN-1").set("Authorization", auth);

  it("stores the sequence time entered with the upload", async () => {
    const res = await upload({ label: "seq 12", recordedAt: "2024-03-01T08:30:00+02:00" });
    expect(res.status).toBe(201);
    expect(res.body.recordedAt).toBe("2024-03-01T06:30:00.000Z");
    expect(res.body.measuredAt).toBe("2024-03-01T06:30:00.000Z");
  });

  it("falls back to the upload time when no sequence time is given", async () => {
    const res = await upload({ label: "seq 12" });
    expect(res.status).toBe(201);
    expect(res.body.recordedAt).toBeNull();
    expect(res.body.measuredAt).toBe(toIsoUtc(res.body.uploadedAt));
    const [row] = (await list()).body;
    expect(row.timeSource).toBe("uploaded");
  });

  it("rejects an invalid sequence time and leaves no upload behind", async () => {
    const res = await upload({ recordedAt: "last tuesday" });
    expect(res.status).toBe(400);
    expect((await list()).body).toEqual([]);
  });

  it("orders uploads by sequence time, not by upload order", async () => {
    // Uploaded first but recorded later.
    const late = await upload({ label: "late", recordedAt: "2024-03-20T00:00:00Z" });
    const early = await upload({ label: "early", recordedAt: "2024-03-01T00:00:00Z" });
    const rows = (await list()).body;
    expect(rows.map((r) => r.id)).toEqual([late.body.uploadId, early.body.uploadId]);
    const latest = await request(app).get("/api/noise-data?project=TTN-1").set("Authorization", auth);
    expect(latest.body.uploadId).toBe(late.body.uploadId);
  });

  it("lets the sequence time be edited and cleared afterwards", async () => {
    const created = await upload({ label: "seq 12" });
    const id = created.body.uploadId;
    const set = await request(app)
      .patch(`/api/noise-data/uploads/${id}`)
      .set("Authorization", auth)
      .send({ recordedAt: "2024-03-05T12:00:00Z" });
    expect(set.status).toBe(200);
    expect(set.body.recordedAt).toBe("2024-03-05T12:00:00.000Z");
    expect(set.body.timeSource).toBe("recorded");

    const bad = await request(app).patch(`/api/noise-data/uploads/${id}`).set("Authorization", auth).send({ recordedAt: "nope" });
    expect(bad.status).toBe(400);

    const cleared = await request(app).patch(`/api/noise-data/uploads/${id}`).set("Authorization", auth).send({ recordedAt: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.recordedAt).toBeNull();
    expect(cleared.body.measuredAt).toBe(toIsoUtc(cleared.body.uploadedAt));
  });

  it("reads SQLite's zoneless default timestamp as UTC", () => {
    expect(toIsoUtc("2024-03-01 06:30:00")).toBe("2024-03-01T06:30:00.000Z");
    expect(toIsoUtc(null)).toBeNull();
    expect(parseRecordedAt("")).toEqual({ value: null });
    expect(withMeasuredAt({ uploadedAt: "2024-03-01 06:30:00", recordedAt: null }).measuredAt).toBe("2024-03-01T06:30:00.000Z");
  });
});

describe("cleaning noise efficiency: cleaning window vs. the two uploads", () => {
  let auth;
  let beforeId;
  let afterId;

  async function addEvent(cleanedAt, streamerId = 1) {
    const result = await runAsync(
      `INSERT INTO cleaning_events
         (streamer_id, section_index_start, section_index_end, section_type, cleaning_method, cleaned_at, project_number, vessel_tag)
       VALUES (?, 0, 3, 'active', 'rope', ?, 'TTN-1', 'TTN')`,
      [streamerId, cleanedAt]
    );
    return result.lastID;
  }

  const efficiency = (query = "") =>
    request(app)
      .get(`/api/stats/cleaning-noise-efficiency?project=TTN-1${query}`)
      .set("Authorization", auth);

  beforeEach(async () => {
    await resetDb();
    await createProject({ projectNumber: "TTN-1", numCables: 2, sectionsPerCable: 4 });
    auth = await login("ttnadmin");
    const post = (body) =>
      request(app).post("/api/noise-data").set("Authorization", auth).send({ projectNumber: "TTN-1", ...body });
    beforeId = (await post({ label: "before", noiseData, recordedAt: "2024-03-01T00:00:00Z" })).body.uploadId;
    afterId = (await post({ label: "after", noiseData: quieter, recordedAt: "2024-03-10T00:00:00Z" })).body.uploadId;
  });

  it("gives no warning when every cleaning is between the uploads", async () => {
    await addEvent("2024-03-05T10:00:00.000Z");
    const res = await efficiency();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.warnings).toEqual([]);
    expect(res.body.ranges[0]).toMatchObject({ period: "inside", outsidePeriod: false });
    expect(res.body.uploadBefore.id).toBe(beforeId);
    expect(res.body.uploadAfter.id).toBe(afterId);
  });

  it("warns and marks the rows when some cleanings are outside the period", async () => {
    const inside = await addEvent("2024-03-05T10:00:00.000Z", 1);
    const early = await addEvent("2024-02-20T10:00:00.000Z", 1);
    const late = await addEvent("2024-03-15T10:00:00.000Z", 1);
    const res = await efficiency();
    expect(res.body.status).toBe("ok");
    expect(res.body.meanImprovementPct).toBe(50);
    expect(res.body.warnings.map((w) => w.code)).toEqual(["events_outside_period"]);
    expect(res.body.warnings[0].message).toMatch(/^2 of 3 cleaning events/);
    const byId = Object.fromEntries(res.body.ranges.map((r) => [r.id, r]));
    expect(byId[inside]).toMatchObject({ period: "inside", outsidePeriod: false });
    expect(byId[early]).toMatchObject({ period: "before", outsidePeriod: true });
    expect(byId[late]).toMatchObject({ period: "after", outsidePeriod: true });
  });

  it("warns, but still computes, when every cleaning is outside the period", async () => {
    await addEvent("2024-03-15T10:00:00.000Z");
    const res = await efficiency("&start=2024-03-14&end=2024-03-16");
    expect(res.body.status).toBe("ok");
    expect(res.body.meanImprovementPct).toBe(50);
    expect(res.body.warnings.map((w) => w.code)).toEqual(["all_events_outside_period"]);
    expect(res.body.ranges[0].outsidePeriod).toBe(true);
  });

  it("warns when the before upload is not older than the after upload", async () => {
    await addEvent("2024-03-05T10:00:00.000Z");
    const res = await efficiency(`&uploadBeforeId=${afterId}&uploadAfterId=${beforeId}`);
    expect(res.body.status).toBe("ok");
    expect(res.body.meanImprovementPct).toBe(-100);
    expect(res.body.warnings.map((w) => w.code)).toEqual(["uploads_reversed"]);
    expect(res.body.ranges[0].outsidePeriod).toBe(false);
  });

  it("says when the check relies on an upload time", async () => {
    await request(app).patch(`/api/noise-data/uploads/${afterId}`).set("Authorization", auth).send({ recordedAt: null });
    await addEvent("2024-02-20T10:00:00.000Z");
    const res = await efficiency();
    expect(res.body.uploadAfter.timeSource).toBe("uploaded");
    expect(res.body.warnings.map((w) => w.code)).toEqual(["all_events_outside_period", "upload_time_used"]);
  });
});

const { app, request, resetDb, login, createProject, activateProject } = require("./helpers/app");

const baseEvent = {
  streamerId: 1,
  sectionIndexStart: 0,
  sectionIndexEnd: 3,
  cleaningMethod: "rope",
  cleanedAt: "2024-03-10T10:00:00.000Z",
};

describe("vessel scoping and payload validation for events", () => {
  let ttnAdmin;
  let ttnViewer;
  beforeEach(async () => {
    await resetDb();
    const ttn = await createProject({ projectNumber: "TTN-1", vesselTag: "TTN", numCables: 12 });
    await createProject({ projectNumber: "RAM-1", vesselTag: "RAM", numCables: 12 });
    await activateProject(ttn);
    ttnAdmin = await login("ttnadmin");
    ttnViewer = await login("ttnviewer");
  });

  it("refuses to create an event on another vessel's project", async () => {
    const res = await request(app)
      .post("/api/events")
      .set("Authorization", ttnAdmin)
      .send({ ...baseEvent, projectNumber: "RAM-1" });
    expect(res.status).toBe(403);
  });

  it("returns 400, not 500, for an unknown project number", async () => {
    const res = await request(app)
      .post("/api/events")
      .set("Authorization", ttnAdmin)
      .send({ ...baseEvent, projectNumber: "NOPE" });
    expect(res.status).toBe(400);
  });

  it("refuses to move an existing event onto another vessel's project", async () => {
    const created = await request(app).post("/api/events").set("Authorization", ttnAdmin).send(baseEvent);
    expect(created.status).toBe(200);
    const res = await request(app)
      .put(`/api/events/${created.body.id}`)
      .set("Authorization", ttnAdmin)
      .send({ ...baseEvent, projectNumber: "RAM-1" });
    expect(res.status).toBe(403);
  });

  it("rejects a streamer id beyond the project's cable count", async () => {
    const res = await request(app)
      .post("/api/events")
      .set("Authorization", ttnAdmin)
      .send({ ...baseEvent, streamerId: 13 });
    expect(res.status).toBe(400);
  });

  it("still accepts the last configured streamer", async () => {
    const res = await request(app)
      .post("/api/events")
      .set("Authorization", ttnAdmin)
      .send({ ...baseEvent, streamerId: 12 });
    expect(res.status).toBe(200);
  });

  it("rejects markup in free-text identifiers", async () => {
    const res = await request(app)
      .post("/api/events")
      .set("Authorization", ttnAdmin)
      .send({ ...baseEvent, cleaningMethod: "<img src=x>" });
    expect(res.status).toBe(400);
  });

  it("bulk import reports per-row scope and bound errors without inserting them", async () => {
    const res = await request(app)
      .post("/api/events/bulk")
      .set("Authorization", ttnAdmin)
      .send({ rows: [baseEvent, { ...baseEvent, projectNumber: "RAM-1" }, { ...baseEvent, streamerId: 13 }] });
    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);
    expect(res.body.errorCount).toBe(2);
  });

  it.each([
    ["/api/last-cleaned?project=RAM-1"],
    ["/api/last-cleaned-filtered?project=RAM-1"],
    ["/api/stats?project=RAM-1"],
    ["/api/stats/filter?project=RAM-1"],
    ["/api/eb-range?start=0&end=3&project=RAM-1"],
  ])("denies %s to a user scoped to another vessel", async (url) => {
    const res = await request(app).get(url).set("Authorization", ttnViewer);
    expect(res.status).toBe(403);
  });

  it("still serves the user's own project geometry", async () => {
    const res = await request(app).get("/api/last-cleaned?project=TTN-1").set("Authorization", ttnViewer);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.lastCleaned)).toHaveLength(12);
  });
});

const { app, request, resetDb, login, createProject, activateProject } = require("./helpers/app");
const { countEBModules } = require("../utils/eb");

const baseEntry = { streamerId: 3, ebNumber: 5, cleanedAt: "2024-03-10T10:00:00.000Z" };

describe("countEBModules", () => {
  it("counts the first, the regular and the closing EB", () => {
    // Sections 1, 5, 9 ... 105 carry an EB (27), plus the closing one at section 107.
    expect(countEBModules(107, 4)).toBe(28);
  });

  it("does not add a closing EB when the last section already has one", () => {
    expect(countEBModules(105, 4)).toBe(27);
  });
});

describe("eBird cleaning entries", () => {
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

  const create = (auth, body) => request(app).post("/api/eb-cleanings").set("Authorization", auth).send(body);
  const list = (auth, query = "") => request(app).get(`/api/eb-cleanings${query}`).set("Authorization", auth);

  it("stores an entry on the active project and lists it", async () => {
    const created = await create(ttnAdmin, baseEntry);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ ...baseEntry, projectNumber: "TTN-1", vesselTag: "TTN", addedByUsertag: "ttnadmin" });

    const res = await list(ttnViewer, "?project=TTN-1");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(created.body.id);
  });

  it("lists newest first", async () => {
    await create(ttnAdmin, baseEntry);
    await create(ttnAdmin, { ...baseEntry, cleanedAt: "2024-03-20T10:00:00.000Z" });
    const res = await list(ttnAdmin);
    expect(res.body.map((row) => row.cleanedAt)).toEqual(["2024-03-20T10:00:00.000Z", "2024-03-10T10:00:00.000Z"]);
  });

  it("deletes an entry", async () => {
    const created = await create(ttnAdmin, baseEntry);
    const del = await request(app).delete(`/api/eb-cleanings/${created.body.id}`).set("Authorization", ttnAdmin);
    expect(del.status).toBe(200);
    expect((await list(ttnAdmin)).body).toHaveLength(0);
  });

  it("answers 404 when deleting an entry that does not exist", async () => {
    const del = await request(app).delete("/api/eb-cleanings/9999").set("Authorization", ttnAdmin);
    expect(del.status).toBe(404);
  });

  it("refuses viewers", async () => {
    expect((await create(ttnViewer, baseEntry)).status).toBe(403);
    const created = await create(ttnAdmin, baseEntry);
    const del = await request(app).delete(`/api/eb-cleanings/${created.body.id}`).set("Authorization", ttnViewer);
    expect(del.status).toBe(403);
  });

  it("refuses another vessel's project", async () => {
    expect((await create(ttnAdmin, { ...baseEntry, projectNumber: "RAM-1" })).status).toBe(403);
  });

  it("returns 400 for an unknown project", async () => {
    expect((await create(ttnAdmin, { ...baseEntry, projectNumber: "NOPE" })).status).toBe(400);
  });

  it("rejects an eBird number the streamer does not have", async () => {
    expect((await create(ttnAdmin, { ...baseEntry, ebNumber: 0 })).status).toBe(400);
    expect((await create(ttnAdmin, { ...baseEntry, ebNumber: 29 })).status).toBe(400);
    expect((await create(ttnAdmin, { ...baseEntry, ebNumber: 28 })).status).toBe(200);
  });

  it("rejects a streamer outside the cable count", async () => {
    expect((await create(ttnAdmin, { ...baseEntry, streamerId: 13 })).status).toBe(400);
  });

  it("rejects a missing or malformed date", async () => {
    expect((await create(ttnAdmin, { ...baseEntry, cleanedAt: "yesterday" })).status).toBe(400);
    expect((await create(ttnAdmin, { streamerId: 3, ebNumber: 5 })).status).toBe(400);
  });

  it("goes away with its project", async () => {
    await create(ttnAdmin, baseEntry);
    const { runAsync, getAllCamelized } = require("../db");
    await runAsync("DELETE FROM projects WHERE project_number = ?", ["TTN-1"]);
    expect(await getAllCamelized("SELECT * FROM eb_cleaning_events")).toHaveLength(0);
  });
});

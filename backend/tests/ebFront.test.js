const { request, ready, resetDb, login, createProject, activateProject } = require("./helpers/app");
const { runAsync, allAsync, applyMigrations } = require("../db");
const { resolveEffectiveConfig } = require("../utils/effectiveConfig");

const projectBody = (projectNumber, extra = {}) => ({
  projectNumber,
  vesselTag: "TTN",
  numCables: 12,
  sectionsPerCable: 107,
  sectionLength: 75,
  moduleFrequency: 4,
  channelsPerSection: 6,
  useRopeForTail: true,
  ...extra,
});

async function listProject(auth, id) {
  const res = await request(require("./helpers/app").app).get("/api/projects").set("Authorization", auth);
  return res.body.find((p) => p.id === id);
}

describe("ebFront project setting", () => {
  const { app } = require("./helpers/app");
  beforeEach(resetDb);

  it("adds eb_front with default 0 to a database created before the column existed", async () => {
    await ready();
    let dropped = true;
    try {
      await runAsync("ALTER TABLE projects DROP COLUMN eb_front");
    } catch (err) {
      dropped = false;
    }
    if (dropped) {
      await runAsync("INSERT INTO projects (project_number, vessel_tag) VALUES ('OLD-1', 'TTN')");
      await applyMigrations();
      const cols = await allAsync("PRAGMA table_info(projects)");
      expect(cols.some((c) => c.name === "eb_front")).toBe(true);
    } else {
      await runAsync("INSERT INTO projects (project_number, vessel_tag) VALUES ('OLD-1', 'TTN')");
    }
    const auth = await login("grand");
    const res = await request(app).get("/api/projects").set("Authorization", auth);
    const old = res.body.find((p) => p.projectNumber === "OLD-1");
    expect(old.ebFront).toBe(false);
  });

  it("POST /api/projects stores ebFront true and GET returns boolean true", async () => {
    const auth = await login("grand");
    const post = await request(app).post("/api/projects").set("Authorization", auth).send(projectBody("EF-1", { ebFront: true }));
    expect(post.status).toBe(200);
    expect(post.body.ebFront).toBe(true);
    expect((await listProject(auth, post.body.id)).ebFront).toBe(true);
  });

  it("POST without ebFront stores false", async () => {
    const auth = await login("grand");
    const post = await request(app).post("/api/projects").set("Authorization", auth).send(projectBody("EF-2"));
    expect(post.body.ebFront).toBe(false);
    expect((await listProject(auth, post.body.id)).ebFront).toBe(false);
  });

  it("PUT /api/projects/:id without ebFront keeps the stored flag", async () => {
    const auth = await login("grand");
    const post = await request(app).post("/api/projects").set("Authorization", auth).send(projectBody("EF-3", { ebFront: true }));
    const put = await request(app).put(`/api/projects/${post.body.id}`).set("Authorization", auth).send(projectBody("EF-3"));
    expect(put.status).toBe(200);
    expect(put.body.ebFront).toBe(true);
    expect((await listProject(auth, post.body.id)).ebFront).toBe(true);
  });

  it("PUT /api/projects/:id with ebFront false clears it", async () => {
    const auth = await login("grand");
    const post = await request(app).post("/api/projects").set("Authorization", auth).send(projectBody("EF-4", { ebFront: true }));
    const put = await request(app).put(`/api/projects/${post.body.id}`).set("Authorization", auth).send(projectBody("EF-4", { ebFront: false }));
    expect(put.body.ebFront).toBe(false);
    expect((await listProject(auth, post.body.id)).ebFront).toBe(false);
  });

  it("PUT /api/config on a vessel-scoped user keeps the flag when omitted and changes it when present", async () => {
    const project = await createProject({ projectNumber: "EF-5", ebFront: 1 });
    await activateProject(project);
    const auth = await login("ttnsuper");
    const body = { numCables: 12, sectionsPerCable: 107, sectionLength: 75, moduleFrequency: 4, channelsPerSection: 6, useRopeForTail: true };
    const kept = await request(app).put("/api/config").set("Authorization", auth).send(body);
    expect(kept.status).toBe(200);
    expect(kept.body.ebFront).toBe(true);
    const cleared = await request(app).put("/api/config").set("Authorization", auth).send({ ...body, ebFront: false });
    expect(cleared.body.ebFront).toBe(false);
    const set = await request(app).put("/api/config").set("Authorization", auth).send({ ...body, ebFront: true });
    expect(set.body.ebFront).toBe(true);
  });

  it("an explicit ebFront null keeps the stored flag on both PUT paths", async () => {
    const auth = await login("grand");
    const post = await request(app).post("/api/projects").set("Authorization", auth).send(projectBody("EF-6", { ebFront: true }));
    const put = await request(app).put(`/api/projects/${post.body.id}`).set("Authorization", auth).send(projectBody("EF-6", { ebFront: null }));
    expect(put.status).toBe(200);
    expect(put.body.ebFront).toBe(true);
    expect((await listProject(auth, post.body.id)).ebFront).toBe(true);

    const project = await createProject({ projectNumber: "EF-7", ebFront: 1 });
    await activateProject(project);
    const vessel = await login("ttnsuper");
    const body = { numCables: 12, sectionsPerCable: 107, sectionLength: 75, moduleFrequency: 4, channelsPerSection: 6, useRopeForTail: true };
    const kept = await request(app).put("/api/config").set("Authorization", vessel).send({ ...body, ebFront: null });
    expect(kept.status).toBe(200);
    expect(kept.body.ebFront).toBe(true);
  });

  it("GET /api/config returns ebFront from the active project, false without one", async () => {
    const auth = await login("grand");
    const none = await request(app).get("/api/config").set("Authorization", auth);
    expect(none.body.ebFront).toBe(false);
    const project = await createProject({ projectNumber: "EF-6", ebFront: 1 });
    await activateProject(project);
    const res = await request(app).get("/api/config").set("Authorization", auth);
    expect(res.body.ebFront).toBe(true);
  });

  it("resolveEffectiveConfig returns ebFront for an explicit project, false otherwise", async () => {
    await createProject({ projectNumber: "EF-ON", ebFront: 1 });
    await createProject({ projectNumber: "EF-OFF" });
    expect((await resolveEffectiveConfig({ projectNumber: "EF-ON", vesselTag: "TTN" })).ebFront).toBe(true);
    expect((await resolveEffectiveConfig({ projectNumber: "EF-OFF", vesselTag: "TTN" })).ebFront).toBe(false);
    expect((await resolveEffectiveConfig({ vesselTag: "TTN" })).ebFront).toBe(false);
  });
});

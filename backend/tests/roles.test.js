const { app, request, resetDb, login, createProject, activateProject } = require("./helpers/app");
const { runAsync, getAsync } = require("../db");
const { loadUsersFromEnv, isGlobalUser, getVesselScope } = require("../middleware/auth");

async function addEvent(projectNumber, vesselTag) {
  await runAsync(
    `INSERT INTO cleaning_events
       (streamer_id, section_index_start, section_index_end, cleaning_method, cleaned_at, project_number, vessel_tag)
     VALUES (1, 0, 3, 'rope', '2024-03-10T10:00:00.000Z', ?, ?)`,
    [projectNumber, vesselTag]
  );
}

async function countEvents(projectNumber) {
  const row = await getAsync("SELECT COUNT(*) AS n FROM cleaning_events WHERE project_number = ?", [projectNumber]);
  return row.n;
}

describe("AUTH_USERS role model", () => {
  const original = process.env.AUTH_USERS;
  let warn;
  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.AUTH_USERS = original;
    warn.mockRestore();
  });

  it("makes grandsuperuser global whatever the vessel tag or GLOBAL flag says", () => {
    process.env.AUTH_USERS = "a:h:grandsuperuser:ALL,b:h:grandsuperuser:TTN:false";
    const users = loadUsersFromEnv();
    for (const name of ["a", "b"]) {
      expect(users[name].isGlobal).toBe(true);
      expect(isGlobalUser(users[name])).toBe(true);
      expect(getVesselScope(users[name])).toBeNull();
    }
  });

  it("ignores the GLOBAL flag for every other role", () => {
    process.env.AUTH_USERS = "s:h:superuser:TTN:true,a:h:admin:TTN:true,v:h:viewer:RAM:yes";
    const users = loadUsersFromEnv();
    expect(getVesselScope(users.s)).toBe("TTN");
    expect(getVesselScope(users.a)).toBe("TTN");
    expect(getVesselScope(users.v)).toBe("RAM");
    for (const name of ["s", "a", "v"]) {
      expect(users[name].isGlobal).toBe(false);
      expect(isGlobalUser(users[name])).toBe(false);
    }
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("skips non-grand users that have no vessel tag", () => {
    process.env.AUTH_USERS = "s:h:superuser:,a:h:admin:ALL,v:h:viewer:ALL:true,ok:h:viewer:TTN";
    expect(Object.keys(loadUsersFromEnv())).toEqual(["ok"]);
  });

  it("does not trust a stale isGlobal flag on a session", () => {
    expect(isGlobalUser({ role: "superuser", isGlobal: true, vesselTag: "TTN" })).toBe(false);
  });
});

describe("role permissions on vessel-scoped and global endpoints", () => {
  let auth;
  let ttn;
  beforeEach(async () => {
    await resetDb();
    ttn = await createProject({ projectNumber: "TTN-1", vesselTag: "TTN" });
    await createProject({ projectNumber: "RAM-1", vesselTag: "RAM" });
    await activateProject(ttn);
    await addEvent("TTN-1", "TTN");
    await addEvent("TTN-1", "TTN");
    await addEvent("RAM-1", "RAM");
    auth = {
      grand: await login("grand"),
      superuser: await login("ttnsuper"),
      admin: await login("ttnadmin"),
      viewer: await login("ttnviewer"),
    };
  });

  const clear = (who, query) => request(app).delete(`/api/events${query}`).set("Authorization", auth[who]);

  describe("bulk Clear All Events", () => {
    it("is refused for Admin and Viewer", async () => {
      for (const who of ["admin", "viewer"]) {
        const res = await clear(who, "?project=TTN-1&confirm=DELETE");
        expect(res.status).toBe(403);
      }
      expect(await countEvents("TTN-1")).toBe(2);
    });

    it("needs the typed DELETE confirmation", async () => {
      for (const query of ["?project=TTN-1", "?project=TTN-1&confirm=delete", "?project=TTN-1&confirm=yes"]) {
        const res = await clear("superuser", query);
        expect(res.status).toBe(400);
      }
      expect((await clear("grand", "")).status).toBe(400);
      expect(await countEvents("TTN-1")).toBe(2);
      expect(await countEvents("RAM-1")).toBe(1);
    });

    it("lets a SuperUser clear a project on their own vessel", async () => {
      const res = await clear("superuser", "?project=TTN-1&confirm=DELETE");
      expect(res.status).toBe(200);
      expect(res.body.deletedCount).toBe(2);
      expect(await countEvents("RAM-1")).toBe(1);
    });

    it("does not let a SuperUser clear another vessel's project", async () => {
      const res = await clear("superuser", "?project=RAM-1&confirm=DELETE");
      expect(res.status).toBe(200);
      expect(res.body.deletedCount).toBe(0);
      expect(await countEvents("RAM-1")).toBe(1);
    });

    it("does not let a SuperUser clear all projects", async () => {
      const res = await clear("superuser", "?confirm=DELETE");
      expect(res.status).toBe(403);
      expect(await countEvents("TTN-1")).toBe(2);
    });

    it("lets GrandSuperUser clear any project, or everything", async () => {
      const one = await clear("grand", "?project=RAM-1&confirm=DELETE");
      expect(one.status).toBe(200);
      expect(one.body.deletedCount).toBe(1);
      const all = await clear("grand", "?confirm=DELETE");
      expect(all.status).toBe(200);
      expect(all.body.deletedCount).toBe(2);
    });
  });

  it("still lets an Admin delete a single event on their vessel, but not a Viewer", async () => {
    const row = await getAsync("SELECT id FROM cleaning_events WHERE project_number = 'TTN-1' LIMIT 1");
    const denied = await request(app).delete(`/api/events/${row.id}`).set("Authorization", auth.viewer);
    expect(denied.status).toBe(403);
    const ok = await request(app).delete(`/api/events/${row.id}`).set("Authorization", auth.admin);
    expect(ok.status).toBe(200);
    expect(await countEvents("TTN-1")).toBe(1);
  });

  it("limits project editing to SuperUser and above", async () => {
    const body = { projectNumber: "TTN-2", projectName: "Second" };
    for (const who of ["admin", "viewer"]) {
      const res = await request(app).post("/api/projects").set("Authorization", auth[who]).send(body);
      expect(res.status).toBe(403);
    }
    const res = await request(app).post("/api/projects").set("Authorization", auth.superuser).send(body);
    expect(res.status).toBe(200);
  });

  it("keeps global-only actions for GrandSuperUser", async () => {
    const restore = await request(app)
      .post("/api/backups/streamer_backup_missing.db/restore")
      .set("Authorization", auth.superuser);
    expect(restore.status).toBe(403);

    const cleanup = await request(app)
      .post("/api/cleanup-streamers")
      .set("Authorization", auth.superuser)
      .send({ maxStreamerId: 12 });
    expect(cleanup.status).toBe(403);

    const grandRestore = await request(app)
      .post("/api/backups/streamer_backup_missing.db/restore")
      .set("Authorization", auth.grand);
    expect(grandRestore.status).not.toBe(403);
  });

  it("reports only GrandSuperUser as global in the session", async () => {
    const grand = await request(app).get("/api/session").set("Authorization", auth.grand);
    expect(grand.body.isGlobal).toBe(true);
    const superuser = await request(app).get("/api/session").set("Authorization", auth.superuser);
    expect(superuser.body.isGlobal).toBe(false);
    expect(superuser.body.vesselTag).toBe("TTN");
  });
});

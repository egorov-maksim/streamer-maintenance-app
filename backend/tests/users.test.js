const path = require("path");
const sqlite3 = require("sqlite3");
const { app, request, resetDb, login } = require("./helpers/app");
const { getAsync, runAsync } = require("../db");
const { reseedUsers } = require("../userStore");

const PASSWORD = "new-password-1";

describe("user accounts in the database", () => {
  let grand;
  let ttnSuper;

  beforeEach(async () => {
    await resetDb();
    grand = await login("grand");
    ttnSuper = await login("ttnsuper");
  });

  const list = (auth) => request(app).get("/api/users").set("Authorization", auth);
  const create = (auth, body) => request(app).post("/api/users").set("Authorization", auth).send(body);
  const update = (auth, id, body) => request(app).put(`/api/users/${id}`).set("Authorization", auth).send(body);
  const remove = (auth, id) => request(app).delete(`/api/users/${id}`).set("Authorization", auth);
  const idOf = async (username) => (await getAsync("SELECT id FROM users WHERE username = ?", [username])).id;
  const tryLogin = (username, password) => request(app).post("/api/login").send({ username, password });

  describe("import from AUTH_USERS", () => {
    it("copies the .env users with their existing password hashes", async () => {
      const rows = (await list(grand)).body.users;
      expect(rows.map((u) => u.username).sort()).toEqual(["grand", "ramadmin", "ttnadmin", "ttnsuper", "ttnviewer"]);
      expect((await tryLogin("ttnadmin", process.env.TEST_PASSWORD)).status).toBe(200);
    });

    it("does not import again once the database has users", async () => {
      await remove(grand, await idOf("ramadmin"));
      await reseedUsers();
      expect((await list(grand)).body.users.map((u) => u.username)).not.toContain("ramadmin");
      expect((await tryLogin("ramadmin", process.env.TEST_PASSWORD)).status).toBe(401);
    });

    it("never returns password hashes", async () => {
      const res = await list(grand);
      expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
      expect(res.body.users[0]).not.toHaveProperty("passwordHash");
    });

    it("accepts the username in any letter case and reports the stored spelling", async () => {
      const res = await tryLogin("TTNAdmin", process.env.TEST_PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body.username).toBe("ttnadmin");
    });
  });

  describe("who can see and manage whom", () => {
    it("is closed to Admin and Viewer", async () => {
      for (const who of ["ttnadmin", "ttnviewer"]) {
        const auth = await login(who);
        expect((await list(auth)).status).toBe(403);
        expect((await create(auth, { username: "sneaky", password: PASSWORD, role: "viewer" })).status).toBe(403);
      }
    });

    it("shows a SuperUser only their own vessel", async () => {
      const res = await list(ttnSuper);
      expect(res.body.users.map((u) => u.username).sort()).toEqual(["ttnadmin", "ttnsuper", "ttnviewer"]);
      expect(res.body.assignableRoles).toEqual(["superuser", "admin", "viewer"]);
      expect(res.body.canChooseVessel).toBe(false);
    });

    it("lets a SuperUser create SuperUser, Admin and Viewer accounts on their own vessel", async () => {
      for (const role of ["superuser", "admin", "viewer"]) {
        const res = await create(ttnSuper, { username: `new-${role}`, password: PASSWORD, role, vesselTag: "RAM" });
        expect(res.status).toBe(201);
        // The vessel is always the SuperUser's own, whatever was asked for.
        expect(res.body.vesselTag).toBe("TTN");
        expect((await tryLogin(`new-${role}`, PASSWORD)).body.vesselTag).toBe("TTN");
      }
    });

    it("does not let a SuperUser create or promote to GrandSuperUser", async () => {
      expect((await create(ttnSuper, { username: "boss", password: PASSWORD, role: "grandsuperuser" })).status).toBe(403);
      expect((await update(ttnSuper, await idOf("ttnadmin"), { role: "grandsuperuser" })).status).toBe(403);
    });

    it("keeps a SuperUser away from other vessels and from GrandSuperUser accounts", async () => {
      for (const username of ["ramadmin", "grand"]) {
        const id = await idOf(username);
        expect((await update(ttnSuper, id, { password: PASSWORD })).status).toBe(403);
        expect((await remove(ttnSuper, id)).status).toBe(403);
      }
      expect((await tryLogin("ramadmin", process.env.TEST_PASSWORD)).status).toBe(200);
    });

    it("lets a SuperUser manage another SuperUser on their vessel", async () => {
      const created = await create(ttnSuper, { username: "ttnsuper2", password: PASSWORD, role: "superuser" });
      expect((await update(ttnSuper, created.body.id, { role: "admin" })).status).toBe(200);
      expect((await remove(ttnSuper, created.body.id)).status).toBe(200);
    });

    it("lets GrandSuperUser create accounts on any vessel, including another GrandSuperUser", async () => {
      const ram = await create(grand, { username: "ramsuper", password: PASSWORD, role: "superuser", vesselTag: "RAM" });
      expect(ram.status).toBe(201);
      expect(ram.body.vesselTag).toBe("RAM");
      const second = await create(grand, { username: "grand2", password: PASSWORD, role: "grandsuperuser", vesselTag: "RAM" });
      expect(second.status).toBe(201);
      expect(second.body.vesselTag).toBeNull();
      expect((await tryLogin("grand2", PASSWORD)).body.isGlobal).toBe(true);
    });
  });

  describe("validation", () => {
    it("requires a password of at least 8 characters", async () => {
      expect((await create(grand, { username: "shorty", password: "1234567", role: "viewer", vesselTag: "TTN" })).status).toBe(400);
      expect((await update(grand, await idOf("ttnadmin"), { password: "short" })).status).toBe(400);
      expect((await create(grand, { username: "shorty", password: "12345678", role: "viewer", vesselTag: "TTN" })).status).toBe(201);
    });

    it("rejects a duplicate username, in any letter case", async () => {
      const res = await create(grand, { username: "TTNadmin", password: PASSWORD, role: "viewer", vesselTag: "TTN" });
      expect(res.status).toBe(409);
    });

    it("rejects bad usernames, unknown roles and a missing vessel", async () => {
      const base = { password: PASSWORD, role: "viewer", vesselTag: "TTN" };
      expect((await create(grand, { ...base, username: "a" })).status).toBe(400);
      expect((await create(grand, { ...base, username: "<b>x</b>" })).status).toBe(400);
      expect((await create(grand, { ...base, username: "okname", role: "owner" })).status).toBe(400);
      expect((await create(grand, { ...base, username: "okname", vesselTag: "" })).status).toBe(400);
      expect((await create(grand, { ...base, username: "okname", vesselTag: "ALL" })).status).toBe(400);
    });
  });

  describe("editing and deleting", () => {
    it("changes a password: the new one works, the old one does not", async () => {
      const res = await update(grand, await idOf("ttnadmin"), { password: PASSWORD });
      expect(res.status).toBe(200);
      expect((await tryLogin("ttnadmin", process.env.TEST_PASSWORD)).status).toBe(401);
      expect((await tryLogin("ttnadmin", PASSWORD)).status).toBe(200);
    });

    it("logs the user out when their password, role or vessel changes", async () => {
      const admin = await login("ttnadmin");
      expect((await request(app).get("/api/session").set("Authorization", admin)).status).toBe(200);
      await update(grand, await idOf("ttnadmin"), { role: "viewer" });
      expect((await request(app).get("/api/session").set("Authorization", admin)).status).toBe(401);
      const again = await tryLogin("ttnadmin", process.env.TEST_PASSWORD);
      expect(again.body.role).toBe("viewer");
    });

    it("moves a user to another vessel", async () => {
      const res = await update(grand, await idOf("ttnadmin"), { vesselTag: "RAM" });
      expect(res.body.vesselTag).toBe("RAM");
      expect((await tryLogin("ttnadmin", process.env.TEST_PASSWORD)).body.vesselTag).toBe("RAM");
    });

    it("deletes a user and ends their sessions", async () => {
      const viewer = await login("ttnviewer");
      expect((await remove(ttnSuper, await idOf("ttnviewer"))).status).toBe(200);
      expect((await request(app).get("/api/session").set("Authorization", viewer)).status).toBe(401);
      expect((await tryLogin("ttnviewer", process.env.TEST_PASSWORD)).status).toBe(401);
    });

    it("lets a manager change their own password and stay logged in", async () => {
      const res = await update(ttnSuper, await idOf("ttnsuper"), { password: PASSWORD });
      expect(res.status).toBe(200);
      expect((await request(app).get("/api/session").set("Authorization", ttnSuper)).status).toBe(200);
      expect((await tryLogin("ttnsuper", PASSWORD)).status).toBe(200);
    });

    it("does not let anyone change their own role or vessel, or delete themselves", async () => {
      const superId = await idOf("ttnsuper");
      expect((await update(ttnSuper, superId, { role: "admin" })).status).toBe(400);
      expect((await remove(ttnSuper, superId)).status).toBe(400);
      const grandId = await idOf("grand");
      expect((await update(grand, grandId, { role: "superuser", vesselTag: "TTN" })).status).toBe(400);
      expect((await remove(grand, grandId)).status).toBe(400);
    });

    it("protects the last GrandSuperUser", async () => {
      // A second GrandSuperUser can be demoted or deleted...
      const second = await create(grand, { username: "grand2", password: PASSWORD, role: "grandsuperuser" });
      const grand2 = `Bearer ${(await tryLogin("grand2", PASSWORD)).body.token}`;
      const grandId = await idOf("grand");
      // ...by the other one, leaving a single GrandSuperUser.
      expect((await remove(grand2, grandId)).status).toBe(200);
      // The one that is left cannot be removed or demoted, even by a direct request.
      expect((await remove(grand2, second.body.id)).status).toBe(400);
      expect((await update(grand2, second.body.id, { role: "viewer", vesselTag: "TTN" })).status).toBe(400);
      expect((await getAsync("SELECT COUNT(*) AS n FROM users WHERE role = 'grandsuperuser'")).n).toBe(1);
    });

    it("returns 404 for an unknown user", async () => {
      expect((await update(grand, 99999, { password: PASSWORD })).status).toBe(404);
      expect((await remove(grand, 99999)).status).toBe(404);
    });
  });

  describe("backup restore", () => {
    const restore = (auth, filename) =>
      request(app).post(`/api/backups/${encodeURIComponent(filename)}/restore`).set("Authorization", auth);

    it("brings back the accounts in the backup and logs out everyone but the restorer", async () => {
      const backup = await request(app).post("/api/backups").set("Authorization", grand);
      await remove(grand, await idOf("ttnviewer"));
      await update(grand, await idOf("ttnadmin"), { password: PASSWORD });

      expect((await restore(grand, path.basename(backup.body.path))).status).toBe(200);

      expect((await tryLogin("ttnviewer", process.env.TEST_PASSWORD)).status).toBe(200);
      expect((await tryLogin("ttnadmin", process.env.TEST_PASSWORD)).status).toBe(200);
      expect((await tryLogin("ttnadmin", PASSWORD)).status).toBe(401);
      expect((await request(app).get("/api/session").set("Authorization", ttnSuper)).status).toBe(401);
      expect((await request(app).get("/api/session").set("Authorization", grand)).status).toBe(200);
    });

    it("copes with a backup taken before users were stored in the database", async () => {
      const backup = await request(app).post("/api/backups").set("Authorization", grand);
      // Make the backup file look like one from an older version: no users table at all.
      await new Promise((resolve, reject) => {
        const old = new sqlite3.Database(backup.body.path);
        old.run("DROP TABLE users", (err) => old.close(() => (err ? reject(err) : resolve())));
      });
      await create(grand, { username: "later", password: PASSWORD, role: "viewer", vesselTag: "TTN" });

      expect((await restore(grand, path.basename(backup.body.path))).status).toBe(200);

      // The table is recreated and filled from AUTH_USERS again.
      expect((await tryLogin("grand", process.env.TEST_PASSWORD)).status).toBe(200);
      expect((await tryLogin("later", PASSWORD)).status).toBe(401);
      expect((await list(grand)).body.users).toHaveLength(5);
    });
  });

  it("imports from AUTH_USERS again when a restore leaves no users", async () => {
    await runAsync("DELETE FROM users");
    await reseedUsers();
    expect((await tryLogin("grand", process.env.TEST_PASSWORD)).status).toBe(200);
  });
});

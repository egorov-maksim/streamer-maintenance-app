const fs = require("fs");
const path = require("path");
const { app, request, resetDb, login, createProject } = require("./helpers/app");
const sqlite3 = require("sqlite3");
const { getAsync, allAsync } = require("../db");

describe("database backups", () => {
  beforeEach(resetDb);

  it("writes backup files to the directory named by BACKUP_DIR", async () => {
    const auth = await login("grand");
    const res = await request(app).post("/api/backups").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(path.dirname(res.body.path)).toBe(process.env.BACKUP_DIR);
    expect(fs.existsSync(res.body.path)).toBe(true);
  });

  it("restores a backup into the running database without a restart", async () => {
    const auth = await login("grand");
    await createProject({ projectNumber: "BEFORE-1" });

    const backupRes = await request(app).post("/api/backups").set("Authorization", auth);
    const filename = path.basename(backupRes.body.path);

    // Mutate after the backup: this project must disappear once the backup is restored.
    await createProject({ projectNumber: "AFTER-1" });
    expect(await getAsync("SELECT COUNT(*) AS n FROM projects")).toEqual({ n: 2 });

    const restoreRes = await request(app)
      .post(`/api/backups/${encodeURIComponent(filename)}/restore`)
      .set("Authorization", auth);
    expect(restoreRes.status).toBe(200);

    // Same process, same connection: the restored content is live immediately.
    const rows = await request(app).get("/api/projects").set("Authorization", auth);
    expect(rows.body.map((p) => p.projectNumber)).toEqual(["BEFORE-1"]);

    // And a write after restore lands on the restored database, not on a stale page cache.
    await createProject({ projectNumber: "POST-RESTORE" });
    const after = await request(app).get("/api/projects").set("Authorization", auth);
    expect(after.body.map((p) => p.projectNumber).sort()).toEqual(["BEFORE-1", "POST-RESTORE"]);
  });

  it("has finished upgrading an older backup's schema by the time the restore returns", async () => {
    const auth = await login("grand");
    const backupRes = await request(app).post("/api/backups").set("Authorization", auth);

    // Make the backup look like one from before the noise sequence time was added.
    await new Promise((resolve, reject) => {
      const old = new sqlite3.Database(backupRes.body.path);
      old.run("ALTER TABLE noise_uploads DROP COLUMN recorded_at", (err) => old.close(() => (err ? reject(err) : resolve())));
    });

    const restoreRes = await request(app)
      .post(`/api/backups/${encodeURIComponent(path.basename(backupRes.body.path))}/restore`)
      .set("Authorization", auth);
    expect(restoreRes.status).toBe(200);

    // No waiting: the column must already be back when the request completes.
    const columns = await allAsync("PRAGMA table_info(noise_uploads)");
    expect(columns.map((c) => c.name)).toContain("recorded_at");
  });
});

const { app, request, resetDb, login, createProject } = require("./helpers/app");
const { getAsync } = require("../db");

describe("POST /api/noise-data", () => {
  let auth;
  beforeEach(async () => {
    await resetDb();
    await createProject({ projectNumber: "TTN-1", numCables: 2, sectionsPerCable: 4 });
    auth = await login("ttnadmin");
  });

  it("stores a valid upload with one row per positive measurement", async () => {
    const res = await request(app)
      .post("/api/noise-data")
      .set("Authorization", auth)
      .send({ projectNumber: "TTN-1", label: "run 1", noiseData: { 1: { 1: 2.5, 2: 0, 3: 4 }, 2: { 1: 1.25 } } });
    expect(res.status).toBe(201);
    const count = await getAsync("SELECT COUNT(*) AS n FROM noise_data WHERE upload_id = ?", [res.body.uploadId]);
    expect(count.n).toBe(3);
  });

  it("rejects a non-numeric RMS value and leaves no upload header behind", async () => {
    const res = await request(app)
      .post("/api/noise-data")
      .set("Authorization", auth)
      .send({ projectNumber: "TTN-1", noiseData: { 1: { 1: "abc" } } });
    expect(res.status).toBe(400);
    expect(await getAsync("SELECT COUNT(*) AS n FROM noise_uploads")).toEqual({ n: 0 });
  });

  it("rejects a non-numeric cable or section key and leaves no upload header behind", async () => {
    const res = await request(app)
      .post("/api/noise-data")
      .set("Authorization", auth)
      .send({ projectNumber: "TTN-1", noiseData: { x: { 1: 5 } } });
    expect(res.status).toBe(400);
    expect(await getAsync("SELECT COUNT(*) AS n FROM noise_uploads")).toEqual({ n: 0 });
  });
});

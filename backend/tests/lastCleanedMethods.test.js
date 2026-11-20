const { app, request, resetDb, login, createProject, activateProject } = require("./helpers/app");

const ROPE_DATE = "2024-03-01T10:00:00.000Z";
const SCUE_DATE = "2024-03-10T10:00:00.000Z";

describe("GET /api/last-cleaned with an excludeMethods filter", () => {
  let admin;
  beforeEach(async () => {
    await resetDb();
    const project = await createProject({ projectNumber: "TTN-1", vesselTag: "TTN", numCables: 12 });
    await activateProject(project);
    admin = await login("ttnadmin");
    const post = (body) => request(app).post("/api/events").set("Authorization", admin).send(body);
    // Sections 0-3 by rope, then sections 2-5 by SCUE nine days later.
    await post({ streamerId: 1, sectionIndexStart: 0, sectionIndexEnd: 3, cleaningMethod: "rope", cleanedAt: ROPE_DATE });
    await post({ streamerId: 1, sectionIndexStart: 2, sectionIndexEnd: 5, cleaningMethod: "scue", cleanedAt: SCUE_DATE });
  });

  const lastCleaned = async (query) => {
    const res = await request(app).get(`/api/last-cleaned${query}`).set("Authorization", admin);
    expect(res.status).toBe(200);
    return res.body.lastCleaned[1];
  };

  it("counts every method when no filter is given", async () => {
    const sections = await lastCleaned("");
    expect(sections[0]).toBe(ROPE_DATE);
    expect(sections[2]).toBe(SCUE_DATE);
    expect(sections[5]).toBe(SCUE_DATE);
  });

  it("ignores events of excluded methods", async () => {
    const sections = await lastCleaned("?excludeMethods=scue");
    expect(sections[2]).toBe(ROPE_DATE);
    expect(sections[3]).toBe(ROPE_DATE);
    // Only SCUE ever touched sections 4-5, so they read as never cleaned.
    expect(sections[4]).toBeNull();
    expect(sections[5]).toBeNull();
  });

  it("accepts several methods", async () => {
    const sections = await lastCleaned("?excludeMethods=scue,knife");
    expect(sections[2]).toBe(ROPE_DATE);
    expect((await lastCleaned("?excludeMethods=scue,rope")).every((d) => d === null)).toBe(true);
  });

  it("keeps events whose method is not in the exclusion list", async () => {
    await request(app).post("/api/events").set("Authorization", admin).send({
      streamerId: 1, sectionIndexStart: 8, sectionIndexEnd: 8, cleaningMethod: "legacy-import", cleanedAt: SCUE_DATE,
    });
    expect((await lastCleaned("?excludeMethods=scue"))[8]).toBe(SCUE_DATE);
  });

  it("combines with the project filter", async () => {
    const sections = await lastCleaned("?project=TTN-1&excludeMethods=rope");
    expect(sections[0]).toBeNull();
    expect(sections[4]).toBe(SCUE_DATE);
  });

  it("rejects a method that is not a plain label", async () => {
    const res = await request(app)
      .get(`/api/last-cleaned?excludeMethods=${encodeURIComponent("<b>rope</b>")}`)
      .set("Authorization", admin);
    expect(res.status).toBe(400);
  });
});

// tests/stats.test.js
// Tests for statistics endpoints

const assert = require("node:assert");
const { describe, it, before } = require("node:test");
const request = require("supertest");

// Set DB_FILE before requiring server
process.env.DB_FILE = "./backend/test.db";
process.env.AUTH_USERS = "superuser:super123:superuser,admin:admin123:admin,viewer:view123:viewer";

const { app } = require("../backend/server");

describe("Statistics API", () => {
  let adminToken = null;
  let viewerToken = null;

  before(async () => {
    // Get tokens
    const adminRes = await request(app)
      .post("/api/login")
      .send({ username: "admin", password: "admin123" });
    adminToken = adminRes.body.token;

    const viewerRes = await request(app)
      .post("/api/login")
      .send({ username: "viewer", password: "view123" });
    viewerToken = viewerRes.body.token;

    // Create some test events for stats
    await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        cableId: "cable-0",
        sectionIndexStart: 0,
        sectionIndexEnd: 10,
        cleaningMethod: "rope",
        cleanedAt: new Date().toISOString(),
        vesselTag: "TTN"
      });
  });

  describe("GET /api/stats/filter", () => {
    it("should return overall stats without filters", async () => {
      const res = await request(app)
        .get("/api/stats/filter")
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);

      assert.ok(res.body.totalEvents !== undefined, "totalEvents should be present");
      assert.ok(res.body.totalSectionsCleaned !== undefined, "totalSectionsCleaned should be present");
      assert.ok(res.body.totalDistance !== undefined, "totalDistance should be present");
      assert.ok(res.body.uniqueSectionsCleaned !== undefined, "uniqueSectionsCleaned should be present");
    });

    it("should return filtered stats with date range", async () => {
      const today = new Date().toISOString().split("T")[0];
      const res = await request(app)
        .get("/api/stats/filter")
        .query({ start: today, end: today })
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);

      assert.ok(res.body.totalEvents !== undefined);
      assert.ok(res.body.totalSectionsCleaned !== undefined);
    });

    it("should return filtered stats by project", async () => {
      // Create a project and event
      const projectRes = await request(app)
        .post("/api/projects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          projectNumber: "STATS-001",
          projectName: "Stats Test"
        });

      await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cableId: "cable-1",
          sectionIndexStart: 0,
          sectionIndexEnd: 5,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: "STATS-001"
        });

      const res = await request(app)
        .get("/api/stats/filter")
        .query({ project: "STATS-001" })
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);

      assert.ok(res.body.totalEvents >= 1);
    });

    it("should reject request without token", async () => {
      await request(app)
        .get("/api/stats/filter")
        .expect(401);
    });
  });

  describe("GET /api/last-cleaned", () => {
    it("should return last cleaned data for all cables", async () => {
      const res = await request(app)
        .get("/api/last-cleaned")
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);

      assert.ok(typeof res.body === "object", "Response should be an object");
      // Should have cable-0 to cable-N entries
      assert.ok(res.body["cable-0"] !== undefined, "Should have cable-0 data");
    });

    it("should filter by project", async () => {
      const res = await request(app)
        .get("/api/last-cleaned")
        .query({ project: "STATS-001" })
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);

      assert.ok(typeof res.body === "object");
    });

    it("should reject request without token", async () => {
      await request(app)
        .get("/api/last-cleaned")
        .expect(401);
    });
  });
});

// tests/stats.test.js
// Tests for statistics endpoints

const assert = require("node:assert");
const { describe, it, before } = require("node:test");
const request = require("supertest");
const { app, loginAs, authHeader } = require("./helpers");

describe("Statistics API", () => {
  let adminToken = null;
  let viewerToken = null;
  let superuserToken = null;

  before(async () => {
    adminToken = await loginAs("admin", "admin123");
    viewerToken = await loginAs("viewer", "view123");
    superuserToken = await loginAs("superuser", "super123");

    await request(app)
      .post("/api/events")
      .set(authHeader(adminToken))
      .send({
        streamerId: 1,
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
        .set(authHeader(viewerToken))
        .expect(200);

      assert.ok(res.body.events !== undefined, "events should be present");
      assert.ok(res.body.totalDistance !== undefined, "totalDistance should be present");
      assert.ok(res.body.uniqueCleanedSections !== undefined, "uniqueCleanedSections should be present");
    });

    it("should return filtered stats with date range", async () => {
      const today = new Date().toISOString().split("T")[0];
      const res = await request(app)
        .get("/api/stats/filter")
        .query({ start: today, end: today })
        .set(authHeader(viewerToken))
        .expect(200);

      assert.ok(res.body.events !== undefined);
      assert.ok(res.body.totalDistance !== undefined);
    });

    it("should return filtered stats by project", async () => {
      await request(app)
        .post("/api/projects")
        .set(authHeader(superuserToken))
        .send({
          projectNumber: "STATS-001",
          projectName: "Stats Test"
        });

      await request(app)
        .post("/api/events")
        .set(authHeader(adminToken))
        .send({
          streamerId: 2,
          sectionIndexStart: 0,
          sectionIndexEnd: 5,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: "STATS-001"
        });

      const res = await request(app)
        .get("/api/stats/filter")
        .query({ project: "STATS-001" })
        .set(authHeader(viewerToken))
        .expect(200);

      assert.ok(res.body.events >= 1);
    });
  });

  describe("GET /api/last-cleaned", () => {
    it("should return last cleaned data keyed by streamer id", async () => {
      const res = await request(app)
        .get("/api/last-cleaned")
        .set(authHeader(viewerToken))
        .expect(200);

      assert.ok(typeof res.body === "object", "Response should be an object");
      assert.ok(res.body.lastCleaned !== undefined, "lastCleaned map should be present");
      assert.ok(res.body.lastCleaned[1] !== undefined, "Should have streamer 1 data");
    });

    it("should filter by project", async () => {
      const res = await request(app)
        .get("/api/last-cleaned")
        .query({ project: "STATS-001" })
        .set(authHeader(viewerToken))
        .expect(200);

      assert.ok(typeof res.body === "object");
      assert.ok(res.body.lastCleaned !== undefined);
    });
  });
});

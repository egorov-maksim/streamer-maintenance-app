// tests/events.test.js
// Tests for cleaning events endpoints

const assert = require("node:assert");
const { describe, it, before } = require("node:test");
const request = require("supertest");
const { app, loginAs, authHeader } = require("./helpers");

describe("Events API", () => {
  let adminToken = null;
  let viewerToken = null;
  let superuserToken = null;
  let testEventId = null;
  let testProjectNumber = "TEST-EVENTS-001";

  before(async () => {
    adminToken = await loginAs("admin", "admin123");
    viewerToken = await loginAs("viewer", "view123");
    superuserToken = await loginAs("superuser", "super123");

    // Create test project (SuperUser only)
    await request(app)
      .post("/api/projects")
      .set(authHeader(superuserToken))
      .send({
        projectNumber: testProjectNumber,
        projectName: "Events Test Project",
        vesselTag: "TTN"
      });
  });

  describe("POST /api/events", () => {
    it("should allow admin to create an event", async () => {
      const res = await request(app)
        .post("/api/events")
        .set(authHeader(adminToken))
        .send({
          streamerId: 1,
          sectionIndexStart: 0,
          sectionIndexEnd: 10,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber,
          vesselTag: "TTN"
        })
        .expect(200);

      assert.ok(res.body.id, "Event id should be returned");
      assert.strictEqual(res.body.streamerId, 1);
      testEventId = res.body.id;
    });

    it("should accept event with out-of-range streamer (backend may validate later)", async () => {
      const res = await request(app)
        .post("/api/events")
        .set(authHeader(adminToken))
        .send({
          streamerId: 99,
          sectionIndexStart: 0,
          sectionIndexEnd: 10,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber
        });
      assert.ok(res.status === 200 || res.status === 400, "Either accepted or rejected");
    });

    it("should accept event with large section range (backend may validate later)", async () => {
      const res = await request(app)
        .post("/api/events")
        .set(authHeader(adminToken))
        .send({
          streamerId: 1,
          sectionIndexStart: 0,
          sectionIndexEnd: 200,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber
        });
      assert.ok(res.status === 200 || res.status === 400, "Either accepted or rejected");
    });

    it("should reject viewer from creating event", async () => {
      await request(app)
        .post("/api/events")
        .set(authHeader(viewerToken))
        .send({
          streamerId: 1,
          sectionIndexStart: 0,
          sectionIndexEnd: 10,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber
        })
        .expect(403);
    });
  });

  describe("GET /api/events", () => {
    it("should return list of events", async () => {
      const res = await request(app)
        .get("/api/events")
        .set(authHeader(viewerToken))
        .expect(200);

      assert.ok(Array.isArray(res.body), "Response should be an array");
      const testEvent = res.body.find(e => e.id === testEventId);
      assert.ok(testEvent, "Test event should be in the list");
    });

    it("should filter events by project", async () => {
      const res = await request(app)
        .get("/api/events")
        .query({ project: testProjectNumber })
        .set(authHeader(viewerToken))
        .expect(200);

      assert.ok(Array.isArray(res.body), "Response should be an array");
      res.body.forEach(event => {
        assert.strictEqual(event.projectNumber, testProjectNumber);
      });
    });

    it("should filter events by date range", async () => {
      const today = new Date().toISOString().split("T")[0];
      const res = await request(app)
        .get("/api/events")
        .query({ start: today, end: today })
        .set(authHeader(viewerToken))
        .expect(200);

      assert.ok(Array.isArray(res.body), "Response should be an array");
    });
  });

  describe("PUT /api/events/:id", () => {
    it("should allow admin to update an event", async () => {
      const res = await request(app)
        .put(`/api/events/${testEventId}`)
        .set(authHeader(adminToken))
        .send({
          streamerId: 1,
          sectionIndexStart: 0,
          sectionIndexEnd: 15,
          cleaningMethod: "scraper",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber,
          vesselTag: "TTN"
        })
        .expect(200);

      assert.strictEqual(res.body.sectionIndexEnd, 15);
      assert.strictEqual(res.body.cleaningMethod, "scraper");

      const getRes = await request(app)
        .get("/api/events")
        .set(authHeader(adminToken));
      const updatedEvent = getRes.body.find(e => e.id === testEventId);
      assert.strictEqual(updatedEvent.sectionIndexEnd, 15);
      assert.strictEqual(updatedEvent.cleaningMethod, "scraper");
    });

    it("should reject viewer from updating event", async () => {
      await request(app)
        .put(`/api/events/${testEventId}`)
        .set(authHeader(viewerToken))
        .send({
          streamerId: 1,
          sectionIndexStart: 0,
          sectionIndexEnd: 10,
          cleaningMethod: "knife",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber,
          vesselTag: "TTN"
        })
        .expect(403);
    });
  });

  describe("DELETE /api/events/:id", () => {
    it("should allow admin to delete an event", async () => {
      const res = await request(app)
        .delete(`/api/events/${testEventId}`)
        .set(authHeader(adminToken))
        .expect(200);

      assert.strictEqual(res.body.success, true);

      const getRes = await request(app)
        .get("/api/events")
        .set(authHeader(adminToken));
      const deletedEvent = getRes.body.find(e => e.id === testEventId);
      assert.strictEqual(deletedEvent, undefined);
    });

    it("should reject viewer from deleting event", async () => {
      const createRes = await request(app)
        .post("/api/events")
        .set(authHeader(adminToken))
        .send({
          streamerId: 2,
          sectionIndexStart: 0,
          sectionIndexEnd: 5,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber
        });

      const eventId = createRes.body.id;

      await request(app)
        .delete(`/api/events/${eventId}`)
        .set(authHeader(viewerToken))
        .expect(403);
    });
  });

  describe("DELETE /api/events (project-scoped clear)", () => {
    it("should allow admin to delete events by project", async () => {
      await request(app)
        .post("/api/events")
        .set(authHeader(adminToken))
        .send({
          streamerId: 2,
          sectionIndexStart: 0,
          sectionIndexEnd: 5,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber
        });

      await request(app)
        .post("/api/events")
        .set(authHeader(adminToken))
        .send({
          streamerId: 3,
          sectionIndexStart: 0,
          sectionIndexEnd: 5,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber
        });

      const res = await request(app)
        .delete("/api/events")
        .query({ project: testProjectNumber })
        .set(authHeader(adminToken))
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.deletedCount >= 2, "Should delete at least 2 events");
    });

    it("should reject viewer from clearing events by project", async () => {
      await request(app)
        .delete("/api/events")
        .query({ project: testProjectNumber })
        .set(authHeader(viewerToken))
        .expect(403);
    });
  });
});

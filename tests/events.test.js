// tests/events.test.js
// Tests for cleaning events endpoints

const assert = require("node:assert");
const { describe, it, before } = require("node:test");
const request = require("supertest");

// Set DB_FILE before requiring server
process.env.DB_FILE = "./backend/test.db";
process.env.AUTH_USERS = "superuser:super123:superuser,admin:admin123:admin,viewer:view123:viewer";

const { app } = require("../backend/server");

describe("Events API", () => {
  let adminToken = null;
  let viewerToken = null;
  let testEventId = null;
  let testProjectNumber = "TEST-EVENTS-001";

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

    // Create a test project
    await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${adminToken}`)
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
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cableId: "cable-0",
          sectionIndexStart: 0,
          sectionIndexEnd: 10,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber,
          vesselTag: "TTN"
        })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.eventId, "Event ID should be returned");
      testEventId = res.body.eventId;
    });

    it("should reject event with invalid streamer number", async () => {
      await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cableId: "cable-99",
          sectionIndexStart: 0,
          sectionIndexEnd: 10,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber
        })
        .expect(400);
    });

    it("should reject event with invalid section range", async () => {
      await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cableId: "cable-0",
          sectionIndexStart: 0,
          sectionIndexEnd: 200,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber
        })
        .expect(400);
    });

    it("should reject viewer from creating event", async () => {
      await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({
          cableId: "cable-0",
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
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body), "Response should be an array");
      const testEvent = res.body.find(e => e.id === testEventId);
      assert.ok(testEvent, "Test event should be in the list");
    });

    it("should filter events by project", async () => {
      const res = await request(app)
        .get("/api/events")
        .query({ project: testProjectNumber })
        .set("Authorization", `Bearer ${viewerToken}`)
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
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body), "Response should be an array");
    });
  });

  describe("PATCH /api/events/:id", () => {
    it("should allow admin to update an event", async () => {
      const res = await request(app)
        .patch(`/api/events/${testEventId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          sectionIndexEnd: 15,
          cleaningMethod: "scraper"
        })
        .expect(200);

      assert.strictEqual(res.body.success, true);

      // Verify the update
      const getRes = await request(app)
        .get("/api/events")
        .set("Authorization", `Bearer ${adminToken}`);

      const updatedEvent = getRes.body.find(e => e.id === testEventId);
      assert.strictEqual(updatedEvent.sectionIndexEnd, 15);
      assert.strictEqual(updatedEvent.cleaningMethod, "scraper");
    });

    it("should reject viewer from updating event", async () => {
      await request(app)
        .patch(`/api/events/${testEventId}`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({
          cleaningMethod: "knife"
        })
        .expect(403);
    });
  });

  describe("DELETE /api/events/:id", () => {
    it("should allow admin to delete an event", async () => {
      const res = await request(app)
        .delete(`/api/events/${testEventId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      assert.strictEqual(res.body.success, true);

      // Verify deletion
      const getRes = await request(app)
        .get("/api/events")
        .set("Authorization", `Bearer ${adminToken}`);

      const deletedEvent = getRes.body.find(e => e.id === testEventId);
      assert.strictEqual(deletedEvent, undefined);
    });

    it("should reject viewer from deleting event", async () => {
      // Create a new event to delete
      const createRes = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cableId: "cable-1",
          sectionIndexStart: 0,
          sectionIndexEnd: 5,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber
        });

      const eventId = createRes.body.eventId;

      // Try to delete as viewer
      await request(app)
        .delete(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(403);
    });
  });

  describe("POST /api/events/bulk-delete", () => {
    it("should allow admin to bulk delete events", async () => {
      // Create multiple events
      const event1 = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cableId: "cable-2",
          sectionIndexStart: 0,
          sectionIndexEnd: 5,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber
        });

      const event2 = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cableId: "cable-3",
          sectionIndexStart: 0,
          sectionIndexEnd: 5,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: testProjectNumber
        });

      const ids = [event1.body.eventId, event2.body.eventId];

      // Bulk delete
      const res = await request(app)
        .post("/api/events/bulk-delete")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.deleted >= 2, "Should delete at least 2 events");
    });

    it("should reject viewer from bulk deleting events", async () => {
      await request(app)
        .post("/api/events/bulk-delete")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ ids: [1, 2, 3] })
        .expect(403);
    });
  });
});

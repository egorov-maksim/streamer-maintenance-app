// tests/config.test.js
// Tests for configuration endpoints

const assert = require("node:assert");
const { describe, it } = require("node:test");
const request = require("supertest");
const { app, loginAs, authHeader } = require("./helpers");

describe("Configuration API", () => {
  describe("GET /api/config", () => {
    it("should return config with valid token", async () => {
      const token = await loginAs("superuser", "super123");
      
      const res = await request(app)
        .get("/api/config")
        .set(authHeader(token));

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.numCables, "numCables should be present");
      assert.ok(res.body.sectionsPerCable, "sectionsPerCable should be present");
      assert.ok(res.body.sectionLength, "sectionLength should be present");
    });

    it("should reject request without token", async () => {
      const res = await request(app)
        .get("/api/config");

      assert.strictEqual(res.status, 401);
    });

    it("should allow viewer to get config", async () => {
      const token = await loginAs("viewer", "view123");
      
      const res = await request(app)
        .get("/api/config")
        .set(authHeader(token));

      assert.strictEqual(res.status, 200);
    });
  });

  describe("PUT /api/config", () => {
    it("should allow superuser to update config", async () => {
      const token = await loginAs("superuser", "super123");
      
      const res = await request(app)
        .put("/api/config")
        .set(authHeader(token))
        .send({
          numCables: 10,
          sectionsPerCable: 100,
          sectionLength: 75,
          moduleFrequency: 4,
          channelsPerSection: 6,
          useRopeForTail: true,
          vesselTag: "TTN"
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    it("should allow admin to update config", async () => {
      const token = await loginAs("admin", "admin123");
      
      const res = await request(app)
        .put("/api/config")
        .set(authHeader(token))
        .send({
          numCables: 12,
          sectionsPerCable: 107,
          sectionLength: 75,
          moduleFrequency: 4,
          channelsPerSection: 6,
          useRopeForTail: true,
          vesselTag: "TTN"
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    it("should reject viewer from updating config", async () => {
      const token = await loginAs("viewer", "view123");
      
      const res = await request(app)
        .put("/api/config")
        .set(authHeader(token))
        .send({
          numCables: 8,
          sectionsPerCable: 100
        });

      assert.strictEqual(res.status, 403);
    });

    it("should reject request without token", async () => {
      const res = await request(app)
        .put("/api/config")
        .send({ numCables: 10 });

      assert.strictEqual(res.status, 401);
    });
  });
});

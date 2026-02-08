// tests/projects.test.js
// Tests for project management endpoints

const assert = require("node:assert");
const { describe, it, before } = require("node:test");
const request = require("supertest");

// Set DB_FILE before requiring server
process.env.DB_FILE = "./backend/test.db";
process.env.AUTH_USERS = "superuser:super123:superuser,admin:admin123:admin,viewer:view123:viewer";

const { app } = require("../backend/server");

describe("Projects API", () => {
  let superuserToken = null;
  let adminToken = null;
  let viewerToken = null;
  let testProjectId = null;

  before(async () => {
    // Get tokens for all roles
    const superRes = await request(app)
      .post("/api/login")
      .send({ username: "superuser", password: "super123" });
    superuserToken = superRes.body.token;

    const adminRes = await request(app)
      .post("/api/login")
      .send({ username: "admin", password: "admin123" });
    adminToken = adminRes.body.token;

    const viewerRes = await request(app)
      .post("/api/login")
      .send({ username: "viewer", password: "view123" });
    viewerToken = viewerRes.body.token;
  });

  describe("POST /api/projects", () => {
    it("should allow admin to create a project", async () => {
      const res = await request(app)
        .post("/api/projects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          projectNumber: "TEST-001",
          projectName: "Test Project",
          vesselTag: "TTN",
          numCables: 12,
          sectionsPerCable: 107,
          sectionLength: 75,
          moduleFrequency: 4,
          channelsPerSection: 6,
          useRopeForTail: true
        })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.projectId, "Project ID should be returned");
      testProjectId = res.body.projectId;
    });

    it("should reject duplicate project number", async () => {
      await request(app)
        .post("/api/projects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          projectNumber: "TEST-001",
          projectName: "Duplicate",
          vesselTag: "TTN"
        })
        .expect(400);
    });

    it("should reject viewer from creating project", async () => {
      await request(app)
        .post("/api/projects")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({
          projectNumber: "TEST-002",
          projectName: "Should Fail"
        })
        .expect(403);
    });

    it("should reject request without token", async () => {
      await request(app)
        .post("/api/projects")
        .send({
          projectNumber: "TEST-003",
          projectName: "No Auth"
        })
        .expect(401);
    });
  });

  describe("GET /api/projects", () => {
    it("should return list of projects", async () => {
      const res = await request(app)
        .get("/api/projects")
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body), "Response should be an array");
      const testProject = res.body.find(p => p.projectNumber === "TEST-001");
      assert.ok(testProject, "Test project should be in the list");
      assert.strictEqual(testProject.projectName, "Test Project");
    });

    it("should reject request without token", async () => {
      await request(app)
        .get("/api/projects")
        .expect(401);
    });
  });

  describe("POST /api/projects/:id/activate", () => {
    it("should allow admin to activate a project", async () => {
      const res = await request(app)
        .post(`/api/projects/${testProjectId}/activate`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      assert.strictEqual(res.body.success, true);
    });

    it("should reject viewer from activating project", async () => {
      await request(app)
        .post(`/api/projects/${testProjectId}/activate`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(403);
    });
  });

  describe("POST /api/projects/:id/deactivate", () => {
    it("should allow admin to deactivate a project", async () => {
      const res = await request(app)
        .post(`/api/projects/${testProjectId}/deactivate`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      assert.strictEqual(res.body.success, true);
    });

    it("should reject viewer from deactivating project", async () => {
      // First activate it
      await request(app)
        .post(`/api/projects/${testProjectId}/activate`)
        .set("Authorization", `Bearer ${adminToken}`);

      // Try to deactivate as viewer
      await request(app)
        .post(`/api/projects/${testProjectId}/deactivate`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(403);
    });
  });

  describe("DELETE /api/projects/:id", () => {
    it("should reject normal delete if project has events", async () => {
      // Create an event for the project first
      await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cableId: "cable-0",
          sectionIndexStart: 0,
          sectionIndexEnd: 5,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: "TEST-001",
          vesselTag: "TTN"
        });

      // Try to delete without force
      await request(app)
        .delete(`/api/projects/${testProjectId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("should allow force delete with confirmation", async () => {
      const res = await request(app)
        .delete(`/api/projects/${testProjectId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ force: "true", confirm: "TEST-001" })
        .expect(200);

      assert.strictEqual(res.body.success, true);
    });

    it("should reject viewer from deleting project", async () => {
      // Create a new project to delete
      const createRes = await request(app)
        .post("/api/projects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          projectNumber: "TEST-DELETE",
          projectName: "To Delete"
        });

      const projectId = createRes.body.projectId;

      // Try to delete as viewer
      await request(app)
        .delete(`/api/projects/${projectId}`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .expect(403);

      // Cleanup - delete as admin
      await request(app)
        .delete(`/api/projects/${projectId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ force: "true", confirm: "TEST-DELETE" });
    });
  });
});

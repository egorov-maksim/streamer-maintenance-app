// tests/projects.test.js
// Tests for project management endpoints

const assert = require("node:assert");
const { describe, it, before } = require("node:test");
const request = require("supertest");
const { app, loginAs, authHeader } = require("./helpers");

describe("Projects API", () => {
  let superuserToken = null;
  let adminToken = null;
  let viewerToken = null;
  let testProjectId = null;

  before(async () => {
    superuserToken = await loginAs("superuser", "super123");
    adminToken = await loginAs("admin", "admin123");
    viewerToken = await loginAs("viewer", "view123");
  });

  describe("POST /api/projects", () => {
    it("should allow superuser to create a project", async () => {
      const res = await request(app)
        .post("/api/projects")
        .set(authHeader(superuserToken))
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

      assert.ok(res.body.id, "Project id should be returned");
      assert.strictEqual(res.body.projectNumber, "TEST-001");
      testProjectId = res.body.id;
    });

    it("should reject admin from creating project", async () => {
      await request(app)
        .post("/api/projects")
        .set(authHeader(adminToken))
        .send({
          projectNumber: "TEST-ADMIN",
          projectName: "Admin Create"
        })
        .expect(403);
    });

    it("should reject duplicate project number", async () => {
      await request(app)
        .post("/api/projects")
        .set(authHeader(superuserToken))
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
        .set(authHeader(viewerToken))
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
        .set(authHeader(viewerToken))
        .expect(200);

      assert.ok(Array.isArray(res.body), "Response should be an array");
      const testProject = res.body.find(p => p.projectNumber === "TEST-001");
      assert.ok(testProject, "Test project should be in the list");
      assert.strictEqual(testProject.projectName, "Test Project");
    });
  });

  describe("PUT /api/projects/:id/activate", () => {
    it("should allow superuser to activate a project", async () => {
      const res = await request(app)
        .put(`/api/projects/${testProjectId}/activate`)
        .set(authHeader(superuserToken))
        .expect(200);

      assert.strictEqual(res.body.projectNumber, "TEST-001");
      assert.ok(res.body.id);
    });

    it("should reject viewer from activating project", async () => {
      await request(app)
        .put(`/api/projects/${testProjectId}/activate`)
        .set(authHeader(viewerToken))
        .expect(403);
    });
  });

  describe("POST /api/projects/deactivate", () => {
    it("should allow superuser to deactivate (clear active project)", async () => {
      const res = await request(app)
        .post("/api/projects/deactivate")
        .set(authHeader(superuserToken))
        .expect(200);

      assert.strictEqual(res.body.success, true);
    });

    it("should reject viewer from deactivating", async () => {
      await request(app)
        .put(`/api/projects/${testProjectId}/activate`)
        .set(authHeader(superuserToken));

      await request(app)
        .post("/api/projects/deactivate")
        .set(authHeader(viewerToken))
        .expect(403);
    });
  });

  describe("DELETE /api/projects/:id", () => {
    it("should return 409 when project has events", async () => {
      await request(app)
        .put(`/api/projects/${testProjectId}/activate`)
        .set(authHeader(superuserToken));

      await request(app)
        .post("/api/events")
        .set(authHeader(adminToken))
        .send({
          streamerId: 1,
          sectionIndexStart: 0,
          sectionIndexEnd: 5,
          cleaningMethod: "rope",
          cleanedAt: new Date().toISOString(),
          projectNumber: "TEST-001",
          vesselTag: "TTN"
        });

      const res = await request(app)
        .delete(`/api/projects/${testProjectId}`)
        .set(authHeader(superuserToken))
        .expect(409);

      assert.strictEqual(res.body.requiresConfirmation, true);
      assert.ok(res.body.eventCount >= 1);
    });

    it("should allow force delete via DELETE /api/projects/:id/force", async () => {
      const res = await request(app)
        .delete(`/api/projects/${testProjectId}/force`)
        .set(authHeader(superuserToken))
        .expect(200);

      assert.strictEqual(res.body.success, true);
    });

    it("should reject viewer from deleting project", async () => {
      const createRes = await request(app)
        .post("/api/projects")
        .set(authHeader(superuserToken))
        .send({
          projectNumber: "TEST-DELETE",
          projectName: "To Delete"
        });

      const projectId = createRes.body.id;

      await request(app)
        .delete(`/api/projects/${projectId}`)
        .set(authHeader(viewerToken))
        .expect(403);

      await request(app)
        .delete(`/api/projects/${projectId}/force`)
        .set(authHeader(superuserToken));
    });
  });
});

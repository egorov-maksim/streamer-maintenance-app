// tests/auth.test.js
// Tests for authentication endpoints

const assert = require("node:assert");
const { describe, it } = require("node:test");
const request = require("supertest");
const { app } = require("./helpers");

describe("Authentication API", () => {
  describe("POST /api/login", () => {
    it("should login successfully with valid superuser credentials", async () => {
      const res = await request(app)
        .post("/api/login")
        .send({ username: "superuser", password: "super123" });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token, "Token should be returned");
      assert.strictEqual(res.body.username, "superuser");
      assert.strictEqual(res.body.role, "superuser");
    });

    it("should login successfully with valid admin credentials", async () => {
      const res = await request(app)
        .post("/api/login")
        .send({ username: "admin", password: "admin123" });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token, "Token should be returned");
      assert.strictEqual(res.body.username, "admin");
      assert.strictEqual(res.body.role, "admin");
    });

    it("should login successfully with valid viewer credentials", async () => {
      const res = await request(app)
        .post("/api/login")
        .send({ username: "viewer", password: "view123" });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token, "Token should be returned");
      assert.strictEqual(res.body.username, "viewer");
      assert.strictEqual(res.body.role, "viewer");
    });

    it("should reject login with invalid credentials", async () => {
      const res = await request(app)
        .post("/api/login")
        .send({ username: "invalid", password: "wrong" });

      assert.strictEqual(res.status, 401);
    });

    it("should reject login with missing credentials", async () => {
      const res = await request(app)
        .post("/api/login")
        .send({ username: "admin" });

      assert.strictEqual(res.status, 400);
    });
  });

  describe("GET /api/session", () => {
    it("should return session info with valid token", async () => {
      // Login first to get a token
      const loginRes = await request(app)
        .post("/api/login")
        .send({ username: "superuser", password: "super123" });
      
      const token = loginRes.body.token;

      const res = await request(app)
        .get("/api/session")
        .set("Authorization", `Bearer ${token}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.username, "superuser");
      assert.strictEqual(res.body.role, "superuser");
    });

    it("should reject request without token", async () => {
      const res = await request(app)
        .get("/api/session");

      assert.strictEqual(res.status, 401);
    });

    it("should reject request with invalid token", async () => {
      const res = await request(app)
        .get("/api/session")
        .set("Authorization", "Bearer invalid-token-12345");

      assert.strictEqual(res.status, 401);
    });
  });

  describe("POST /api/logout", () => {
    it("should logout successfully with valid token", async () => {
      // Login to get a fresh token
      const loginRes = await request(app)
        .post("/api/login")
        .send({ username: "admin", password: "admin123" });

      const token = loginRes.body.token;

      // Logout
      const logoutRes = await request(app)
        .post("/api/logout")
        .set("Authorization", `Bearer ${token}`);

      assert.strictEqual(logoutRes.status, 200);

      // Verify token is invalidated
      const sessionRes = await request(app)
        .get("/api/session")
        .set("Authorization", `Bearer ${token}`);

      assert.strictEqual(sessionRes.status, 401);
    });

    it("should accept logout without token (no-op)", async () => {
      const res = await request(app)
        .post("/api/logout");

      assert.strictEqual(res.status, 200);
    });
  });
});

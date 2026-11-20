const { app, request, resetDb, login } = require("./helpers/app");
const { isSupervisorAllowed } = require("../middleware/auth");

describe("supervisor lock-in", () => {
  describe("isSupervisorAllowed", () => {
    it("allows exactly the three overview pairs", () => {
      expect(isSupervisorAllowed("GET", "/api/session")).toBe(true);
      expect(isSupervisorAllowed("GET", "/api/overview")).toBe(true);
      expect(isSupervisorAllowed("GET", "/api/overview/")).toBe(true);
      expect(isSupervisorAllowed("GET", "/api/overview/vessels")).toBe(true);
      expect(isSupervisorAllowed("GET", "/api/overview/vessels/")).toBe(true);
    });

    it("ignores a query string", () => {
      expect(isSupervisorAllowed("GET", "/api/overview?x=1")).toBe(true);
      expect(isSupervisorAllowed("GET", "/api/stats?x=/api/overview")).toBe(false);
    });

    it("refuses other methods on allowed paths", () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
        expect(isSupervisorAllowed(method, "/api/overview")).toBe(false);
        expect(isSupervisorAllowed(method, "/api/session")).toBe(false);
      }
      expect(isSupervisorAllowed("get", "/api/overview")).toBe(false);
    });

    it("refuses other and look-alike paths", () => {
      for (const p of [
        "/api/stats",
        "/api/overview/vessels/x",
        "/api/overviewx",
        "/api/overview//",
        "/api/overview/vessels//",
        "/api/overview/../stats",
        "/api/Overview",
        "/api/overview%2Fvessels",
        "//api/overview",
        "/api/session/x",
        "api/overview",
        "",
        "/",
      ]) {
        expect(isSupervisorAllowed("GET", p)).toBe(false);
      }
      expect(isSupervisorAllowed("GET", undefined)).toBe(false);
      expect(isSupervisorAllowed(undefined, "/api/overview")).toBe(false);
    });
  });

  describe("through the API", () => {
    let sup;
    beforeEach(async () => {
      await resetDb();
      sup = await login("sup");
    });

    const call = (method, url) => request(app)[method](url).set("Authorization", sup).send({});

    it("lets a supervisor read its own session", async () => {
      const res = await call("get", "/api/session");
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("supervisor");
    });

    it("lets a supervisor read /api/session with trailing slash and query", async () => {
      expect((await call("get", "/api/session/")).status).toBe(200);
      expect((await call("get", "/api/session?a=1")).status).toBe(200);
    });

    const refused = [
      ["get", "/api/stats"],
      ["get", "/api/stats/"],
      ["get", "/api/stats?x=/api/session"],
      ["get", "/api/stats/filter"],
      ["get", "/api/stats/section-clean-counts"],
      ["get", "/api/stats/cleaning-noise-efficiency"],
      ["get", "/api/stats/noise-rms-history"],
      ["get", "/api/eb-range"],
      ["get", "/api/last-cleaned"],
      ["get", "/api/last-cleaned-filtered"],
      ["get", "/api/projects"],
      ["get", "/api/projects/active"],
      ["get", "/api/projects/stats"],
      ["get", "/api/projects/1/streamer-deployments"],
      ["post", "/api/projects"],
      ["put", "/api/projects/1"],
      ["put", "/api/projects/1/activate"],
      ["post", "/api/projects/deactivate"],
      ["delete", "/api/projects/1"],
      ["delete", "/api/projects/1/force"],
      ["put", "/api/projects/1/streamer-deployments"],
      ["delete", "/api/projects/1/streamer-deployments/1"],
      ["post", "/api/cleanup-streamers"],
      ["get", "/api/events"],
      ["post", "/api/events"],
      ["post", "/api/events/bulk"],
      ["put", "/api/events/1"],
      ["delete", "/api/events/1"],
      ["delete", "/api/events"],
      ["get", "/api/config"],
      ["put", "/api/config"],
      ["get", "/api/users"],
      ["post", "/api/users"],
      ["put", "/api/users/1"],
      ["delete", "/api/users/1"],
      ["get", "/api/backups"],
      ["post", "/api/backups"],
      ["post", "/api/backups/x.db/restore"],
      ["get", "/api/noise-data"],
      ["get", "/api/noise-data/uploads"],
      ["post", "/api/noise-data"],
      ["patch", "/api/noise-data/uploads/1"],
      ["delete", "/api/noise-data/uploads/1"],
      ["get", "/api/eb-cleanings"],
      ["post", "/api/eb-cleanings"],
      ["delete", "/api/eb-cleanings/1"],
    ];

    it.each(refused)("refuses %s %s with 403", async (method, url) => {
      const res = await call(method, url);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Access denied" });
    });

    it("refuses a write on the session path", async () => {
      expect((await call("post", "/api/session")).status).not.toBe(200);
    });
  });

  describe("controls", () => {
    beforeEach(async () => {
      await resetDb();
    });

    it("still serves stats to a vessel user", async () => {
      const res = await request(app).get("/api/stats").set("Authorization", await login("ttnadmin"));
      expect(res.status).toBe(200);
    });

    it("still serves users to a grandsuperuser", async () => {
      const res = await request(app).get("/api/users").set("Authorization", await login("grand"));
      expect(res.status).toBe(200);
    });
  });
});

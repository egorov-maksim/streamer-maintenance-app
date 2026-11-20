const { app, request, resetDb, login } = require("./helpers/app");
const { ROLES, loadUsersFromEnv, isGlobalUser, canSeeAllVessels } = require("../middleware/auth");

describe("supervisor role", () => {
  describe("AUTH_USERS parsing", () => {
    const original = process.env.AUTH_USERS;
    afterEach(() => {
      process.env.AUTH_USERS = original;
    });

    it("loads a supervisor without a vessel tag and without global write scope", () => {
      process.env.AUTH_USERS = "s:h:supervisor:ALL";
      expect(loadUsersFromEnv().s).toMatchObject({ role: "supervisor", vesselTag: null, isGlobal: false });
    });

    it("never keeps a vessel tag on a supervisor", () => {
      process.env.AUTH_USERS = "s:h:supervisor:TTN";
      expect(loadUsersFromEnv().s).toMatchObject({ role: "supervisor", vesselTag: null, isGlobal: false });
    });
  });

  describe("helpers", () => {
    it("exposes the role constant", () => {
      expect(ROLES.SUPERVISOR).toBe("supervisor");
    });

    it("isGlobalUser stays grandsuperuser-only", () => {
      expect(isGlobalUser({ role: "supervisor" })).toBe(false);
    });

    it("canSeeAllVessels is true only for supervisor and grandsuperuser", () => {
      expect(canSeeAllVessels({ role: "supervisor" })).toBe(true);
      expect(canSeeAllVessels({ role: "grandsuperuser" })).toBe(true);
      for (const role of ["admin", "viewer", "superuser"]) {
        expect(canSeeAllVessels({ role })).toBe(false);
      }
      expect(canSeeAllVessels(undefined)).toBe(false);
    });
  });

  describe("accounts", () => {
    let grand;
    let ttnSuper;

    beforeEach(async () => {
      await resetDb();
      grand = await login("grand");
      ttnSuper = await login("ttnsuper");
    });

    const create = (auth, body) => request(app).post("/api/users").set("Authorization", auth).send(body);
    const list = (auth) => request(app).get("/api/users").set("Authorization", auth);

    it("logs in the seeded supervisor with no vessel and no global flag", async () => {
      const res = await request(app)
        .post("/api/login")
        .send({ username: "sup", password: process.env.TEST_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ role: "supervisor", isGlobal: false, vesselTag: null });
    });

    it("lets a grandsuperuser create a supervisor", async () => {
      const res = await create(grand, { username: "newsup", password: "long-enough-1", role: "supervisor" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ role: "supervisor", vesselTag: null });
    });

    it("does not let a superuser create a supervisor", async () => {
      const res = await create(ttnSuper, { username: "newsup", password: "long-enough-1", role: "supervisor" });
      expect(res.status).toBe(403);
    });

    it("offers the supervisor role only to a grandsuperuser", async () => {
      const asSuper = await list(ttnSuper);
      expect(asSuper.body.users.map((u) => u.role)).not.toContain("supervisor");
      expect(asSuper.body.assignableRoles).not.toContain("supervisor");
      expect((await list(grand)).body.assignableRoles).toContain("supervisor");
    });

    it("promotes a viewer to supervisor, clears the vessel and ends their session", async () => {
      const viewer = await login("ttnviewer");
      const users = (await list(grand)).body.users;
      const id = users.find((u) => u.username === "ttnviewer").id;
      const res = await request(app).put(`/api/users/${id}`).set("Authorization", grand).send({ role: "supervisor" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ role: "supervisor", vesselTag: null });
      const session = await request(app).get("/api/session").set("Authorization", viewer);
      expect(session.status).toBe(401);
    });
  });
});

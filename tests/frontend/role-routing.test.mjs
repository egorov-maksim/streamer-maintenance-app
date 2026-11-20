import { redirectTarget } from "../../public/js/role-routing.js";

describe("redirectTarget", () => {
  it("sends a supervisor to /overview from any other page", () => {
    expect(redirectTarget("supervisor", "/")).toBe("/overview");
    expect(redirectTarget("supervisor", "/stats")).toBe("/overview");
    expect(redirectTarget("supervisor", "/config")).toBe("/overview");
  });

  it("leaves a supervisor on /overview", () => {
    expect(redirectTarget("supervisor", "/overview")).toBeNull();
  });

  it("sends other roles away from /overview", () => {
    expect(redirectTarget("viewer", "/overview")).toBe("/");
    expect(redirectTarget("admin", "/overview")).toBe("/");
    expect(redirectTarget("superuser", "/overview")).toBe("/");
    expect(redirectTarget(undefined, "/overview")).toBe("/");
  });

  it("lets a grandsuperuser stay on /overview", () => {
    expect(redirectTarget("grandsuperuser", "/overview")).toBeNull();
  });

  it("does nothing for other roles on other pages", () => {
    expect(redirectTarget("admin", "/stats")).toBeNull();
    expect(redirectTarget("viewer", "/")).toBeNull();
    expect(redirectTarget(undefined, "/")).toBeNull();
  });
});

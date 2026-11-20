const { resetDb } = require("./helpers/app");
const { runAsync } = require("../db");
const { loadConfig, saveConfig } = require("../config");

describe("app_config persistence", () => {
  beforeEach(resetDb);

  it("round-trips a null activeProjectNumber as null", async () => {
    await saveConfig({ activeProjectNumber: "P-1" });
    await saveConfig({ activeProjectNumber: null });
    expect((await loadConfig()).activeProjectNumber).toBeNull();
  });

  it("reads a legacy 'null' string written by older versions as null", async () => {
    await runAsync("INSERT INTO app_config (key, value) VALUES ('active_project_number', 'null')");
    expect((await loadConfig()).activeProjectNumber).toBeNull();
  });

  it("keeps a numeric-looking vessel tag as a string", async () => {
    await saveConfig({ vesselTag: "007" });
    expect((await loadConfig()).vesselTag).toBe("007");
  });

  it("coerces numeric and boolean settings to their types", async () => {
    await saveConfig({ numCables: 14, useRopeForTail: false, sectionsPerCable: 120 });
    const cfg = await loadConfig();
    expect(cfg.numCables).toBe(14);
    expect(cfg.sectionsPerCable).toBe(120);
    expect(cfg.useRopeForTail).toBe(false);
  });
});

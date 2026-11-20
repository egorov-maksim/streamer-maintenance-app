const { resetDb, createProject, activateProject } = require("./helpers/app");
const { resolveEffectiveConfig } = require("../utils/effectiveConfig");

describe("resolveEffectiveConfig", () => {
  beforeEach(resetDb);

  it("loads the active project of the given vessel, not the default vessel's", async () => {
    const ttn = await createProject({ projectNumber: "P-TTN", vesselTag: "TTN", numCables: 12 });
    const ram = await createProject({ projectNumber: "P-RAM", vesselTag: "RAM", numCables: 8, sectionsPerCable: 90 });
    await activateProject(ttn);
    await activateProject(ram);
    const config = await resolveEffectiveConfig({ vesselTag: "RAM" });
    expect(config.numCables).toBe(8);
    expect(config.sectionsPerCable).toBe(90);
    expect(Object.keys(config.sectionsPerCableMap)).toHaveLength(8);
    const other = await resolveEffectiveConfig({ vesselTag: "TTN" });
    expect(other.numCables).toBe(12);
  });

  it("resolves an explicit project number", async () => {
    await createProject({ projectNumber: "P-RAM", vesselTag: "RAM", numCables: 8 });
    const config = await resolveEffectiveConfig({ projectNumber: "P-RAM", vesselTag: "TTN" });
    expect(config.numCables).toBe(8);
  });

  it("throws 403 when the project belongs to another vessel than the scope", async () => {
    await createProject({ projectNumber: "P-RAM", vesselTag: "RAM" });
    await expect(
      resolveEffectiveConfig({ projectNumber: "P-RAM", vesselTag: "TTN", vesselScope: "TTN" })
    ).rejects.toMatchObject({ status: 403 });
  });
});

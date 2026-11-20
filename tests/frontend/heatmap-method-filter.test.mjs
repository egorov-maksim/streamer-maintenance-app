import {
  HEATMAP_FILTER_METHODS,
  loadDisabledMethods,
  saveDisabledMethods,
  toggleDisabledMethod,
  filterEventsByMethod,
} from "../../public/js/heatmap-method-filter.js";

/** Minimal localStorage stand-in; the module only uses getItem/setItem. */
function installStorage(initial = {}) {
  const store = { ...initial };
  globalThis.localStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
  };
  return store;
}

const KEY = "heatmapDisabledCleaningMethods";

describe("heatmap method filter preference", () => {
  afterEach(() => {
    delete globalThis.localStorage;
  });

  it("starts with every method switched on", () => {
    installStorage();
    expect(loadDisabledMethods()).toEqual([]);
  });

  it("remembers the switched-off methods", () => {
    installStorage();
    expect(saveDisabledMethods(["scue"])).toEqual(["scue"]);
    expect(loadDisabledMethods()).toEqual(["scue"]);
  });

  it("drops unknown and duplicate values", () => {
    installStorage({ [KEY]: JSON.stringify(["scue", "laser", "scue"]) });
    expect(loadDisabledMethods()).toEqual(["scue"]);
  });

  it("falls back to all methods on when the stored value is unreadable", () => {
    installStorage({ [KEY]: "{not json" });
    expect(loadDisabledMethods()).toEqual([]);
    installStorage({ [KEY]: JSON.stringify([...HEATMAP_FILTER_METHODS]) });
    expect(loadDisabledMethods()).toEqual([]);
  });

  it("refuses to switch every method off", () => {
    const store = installStorage();
    expect(saveDisabledMethods([...HEATMAP_FILTER_METHODS])).toBeNull();
    expect(store[KEY]).toBeUndefined();
  });

  it("works without localStorage", () => {
    expect(loadDisabledMethods()).toEqual([]);
    expect(saveDisabledMethods(["rope"])).toEqual(["rope"]);
  });
});

describe("toggleDisabledMethod", () => {
  it("switches a method off and on again", () => {
    expect(toggleDisabledMethod([], "scue")).toEqual(["scue"]);
    expect(toggleDisabledMethod(["scue"], "scue")).toEqual([]);
  });

  it("keeps the last remaining method on", () => {
    const allButRope = HEATMAP_FILTER_METHODS.filter((m) => m !== "rope");
    expect(toggleDisabledMethod(allButRope, "rope")).toBeNull();
  });
});

describe("filterEventsByMethod", () => {
  const eventList = [
    { id: 1, cleaningMethod: "rope" },
    { id: 2, cleaningMethod: "scue" },
    { id: 3, cleaningMethod: "legacy-import" },
  ];

  it("returns the list untouched when nothing is switched off", () => {
    expect(filterEventsByMethod(eventList, [])).toBe(eventList);
  });

  it("removes switched-off methods and keeps methods it does not know", () => {
    expect(filterEventsByMethod(eventList, ["scue"]).map((e) => e.id)).toEqual([1, 3]);
  });
});

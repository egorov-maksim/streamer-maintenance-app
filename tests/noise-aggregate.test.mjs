import { aggregateNoiseDatasets } from "../public/js/noise-aggregate.js";

describe("aggregateNoiseDatasets", () => {
  test("skips zero/missing values per section", () => {
    const a = { "1": [0, 2, 4] };
    const b = { "1": [6, 0] };
    const { mean, range } = aggregateNoiseDatasets([a, b]);
    expect(mean["1"][0]).toBe(6);
    expect(mean["1"][1]).toBe(2);
    expect(mean["1"][2]).toBe(4);
    expect(range["1"][0]).toEqual({ min: 6, max: 6, count: 1 });
    expect(range["1"][1]).toEqual({ min: 2, max: 2, count: 1 });
  });

  test("averages positive values and reports min, max and count", () => {
    const { mean, range } = aggregateNoiseDatasets([{ "2": [3] }, { "2": [5] }, { "2": [7] }]);
    expect(mean["2"][0]).toBe(5);
    expect(range["2"][0]).toEqual({ min: 3, max: 7, count: 3 });
  });

  test("keeps cables separate", () => {
    const { mean } = aggregateNoiseDatasets([{ "1": [2], "2": [10] }, { "1": [4] }]);
    expect(mean["1"][0]).toBe(3);
    expect(mean["2"][0]).toBe(10);
  });

  test("empty input returns empty results", () => {
    expect(aggregateNoiseDatasets([])).toEqual({ mean: {}, range: {} });
  });
});

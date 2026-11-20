import { formatRangeLabel } from "../../public/js/streamer-utils.js";

describe("formatRangeLabel", () => {
  it("prints the start section before the end section", () => {
    expect(formatRangeLabel({ sectionIndexStart: 4, sectionIndexEnd: 9, sectionType: "active" })).toBe("AS05–AS10");
  });

  it("labels tail sections as tails", () => {
    expect(formatRangeLabel({ sectionIndexStart: 0, sectionIndexEnd: 2, sectionType: "tail" })).toBe("Tail 1–Tail 3");
  });

  it("defaults a missing section type to active", () => {
    expect(formatRangeLabel({ sectionIndexStart: 0, sectionIndexEnd: 0 })).toBe("AS01–AS01");
  });
});

import { createRequire } from "node:module";
import { getEBRangeForSectionRange } from "../../public/js/streamer-utils.js";

const require = createRequire(import.meta.url);
const { calculateEBRange } = require("../../backend/utils/eb.js");

describe("getEBRangeForSectionRange", () => {
  const cfg = { moduleFrequency: 4, sectionsPerCable: 20 };

  it("matches the backend label for every range within the active sections", () => {
    for (let start = 0; start < cfg.sectionsPerCable; start++) {
      for (let end = start; end < cfg.sectionsPerCable; end++) {
        // The frontend separates with an en dash, the backend with a hyphen.
        const frontend = getEBRangeForSectionRange(start, end, cfg).replace(" – ", " - ");
        expect(frontend).toBe(calculateEBRange(start, end, cfg));
      }
    }
  });

  it("shows a dash for ranges that reach the tail sections", () => {
    expect(getEBRangeForSectionRange(20, 22, cfg)).toBe("—");
    expect(getEBRangeForSectionRange(18, 21, cfg)).toBe("—");
  });
});

import { parseCsvEventRows } from "../js/csv-import.js";

const cfg = { numCables: 12 };
const legacyRow = (streamer) => [String(streamer), "1", "4", "rope", "2024-03-10T10:00:00.000Z", "P-1", "TTN"];
const typedRow = (streamer) => [String(streamer), "tail", "1", "2", "rope", "2024-03-10T10:00:00.000Z", "P-1", "TTN"];

describe("parseCsvEventRows", () => {
  it("accepts the last configured streamer", () => {
    const { validRows, parseErrorCount } = parseCsvEventRows([legacyRow(12)], cfg);
    expect(parseErrorCount).toBe(0);
    expect(validRows).toHaveLength(1);
    expect(validRows[0]).toMatchObject({ streamerId: 12, sectionIndexStart: 0, sectionIndexEnd: 3, cleaningMethod: "rope" });
  });

  it("rejects a streamer one past the configured cable count", () => {
    const { validRows, parseErrorCount } = parseCsvEventRows([legacyRow(13)], cfg);
    expect(validRows).toHaveLength(0);
    expect(parseErrorCount).toBe(1);
  });

  it("reads the section type column when present", () => {
    const { validRows } = parseCsvEventRows([typedRow(3)], cfg);
    expect(validRows[0]).toMatchObject({ streamerId: 3, sectionType: "tail", sectionIndexStart: 0, sectionIndexEnd: 1 });
  });

  it("counts unparseable dates as errors", () => {
    const row = legacyRow(1);
    row[4] = "not a date";
    expect(parseCsvEventRows([row], cfg).parseErrorCount).toBe(1);
  });
});

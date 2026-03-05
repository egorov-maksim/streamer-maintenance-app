/**
 * Pure validation for RMS noise CSV uploads.
 * Checks cable count and section numbers against the project's active-section configuration.
 * Tail sections are never present in the CSV file, so only active sections are validated.
 *
 * @param {string} csvText - Raw CSV text from the uploaded file
 * @param {{ numCables: number, sectionsPerCable: number }} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateNoiseCsv(csvText, config) {
  const errors = [];
  const { numCables, sectionsPerCable } = config || {};

  if (!numCables || !sectionsPerCable) {
    return { valid: false, errors: ["Project configuration is missing (numCables or sectionsPerCable)."] };
  }

  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { valid: false, errors: ["CSV has no data rows."] };
  }

  // --- Header: extract cable numbers ---
  const headers = lines[0].split(",");
  const cableNums = [];
  for (let i = 1; i < headers.length; i++) {
    const n = parseInt(headers[i].replace(/[^0-9]/g, ""), 10);
    if (!isNaN(n)) cableNums.push(n);
  }

  if (cableNums.length !== numCables) {
    errors.push(
      `Expected ${numCables} streamer column${numCables !== 1 ? "s" : ""} but found ${cableNums.length} in the CSV header.`
    );
  }

  const outOfRangeCables = cableNums.filter((n) => n < 1 || n > numCables);
  if (outOfRangeCables.length > 0) {
    errors.push(
      `Cable number${outOfRangeCables.length !== 1 ? "s" : ""} out of range (1–${numCables}): ${outOfRangeCables.join(", ")}.`
    );
  }

  // --- Data rows: collect out-of-range section numbers ---
  const badSections = new Set();
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r].split(",");
    const sectionNum = parseInt(cols[0], 10);
    if (isNaN(sectionNum)) continue;
    if (sectionNum < 1 || sectionNum > sectionsPerCable) {
      badSections.add(sectionNum);
    }
  }

  if (badSections.size > 0) {
    const sorted = [...badSections].sort((a, b) => a - b);
    errors.push(
      `Section number${sorted.length !== 1 ? "s" : ""} out of active range (1–${sectionsPerCable}): ${sorted.join(", ")}.`
    );
  }

  return { valid: errors.length === 0, errors };
}

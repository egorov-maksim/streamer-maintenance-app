/**
 * Pure parsing for the cleaning-events CSV import (no DOM, no network) so the row
 * rules can be unit-tested. app.js feeds it the PapaParse rows and sends the result
 * to POST /api/events/bulk.
 *
 * Two layouts are accepted (header row already removed):
 *   legacy: Streamer, First Section, Last Section, Method, Date & Time[, Project[, Vessel]]
 *   typed:  Streamer, Section Type, First Section, Last Section, Method, Date & Time, Project, Vessel[, Added By]
 */

export function normalizeCsvRow(row) {
  return row.map((field) => String(field ?? "").trim().replace(/^"|"$/g, ""));
}

function unquote(value) {
  return value ? value.replace(/"/g, "").trim() : null;
}

/**
 * @param {string[][]} dataRows - CSV rows without the header
 * @param {{ numCables: number }} cfg - active configuration used for the streamer bound
 * @returns {{ validRows: Object[], parseErrorCount: number }}
 */
export function parseCsvEventRows(dataRows, cfg) {
  const numCables = Number(cfg?.numCables);
  const validRows = [];
  let parseErrorCount = 0;

  const hasSectionTypeColumn = dataRows.length > 0 && (() => {
    const firstParts = normalizeCsvRow(dataRows[0]);
    return firstParts.length >= 8 && (firstParts[1] === "active" || firstParts[1] === "tail");
  })();

  for (const rawRow of dataRows) {
    const parts = normalizeCsvRow(rawRow);
    if (!parts.length) continue;
    let streamerNum, startSection, endSection, method, dateTimeStr, projectNumber, vesselTag, sectionType;

    if (hasSectionTypeColumn && parts.length >= 8 && (parts[1] === "active" || parts[1] === "tail")) {
      streamerNum   = parseInt(parts[0], 10);
      sectionType   = parts[1];
      startSection  = parseInt(parts[2], 10);
      endSection    = parseInt(parts[3], 10);
      method        = parts[4];
      dateTimeStr   = parts[5].replace(/"/g, "").trim();
      projectNumber = unquote(parts[6]);
      vesselTag     = unquote(parts[7]) || "TTN";
    } else if (parts.length >= 5) {
      streamerNum   = parseInt(parts[0], 10);
      startSection  = parseInt(parts[1], 10);
      endSection    = parseInt(parts[2], 10);
      method        = parts[3];
      dateTimeStr   = parts[4].replace(/"/g, "").trim();
      projectNumber = unquote(parts[5]);
      vesselTag     = unquote(parts[6]) || "TTN";
      sectionType   = null;
    } else {
      parseErrorCount++;
      continue;
    }

    // Streamers are 1..numCables inclusive; the server enforces the same bound.
    if (
      isNaN(streamerNum) || isNaN(startSection) || isNaN(endSection) ||
      streamerNum < 1 || (Number.isFinite(numCables) && streamerNum > numCables)
    ) { parseErrorCount++; continue; }

    const dateObj = new Date(dateTimeStr);
    if (isNaN(dateObj.getTime())) { parseErrorCount++; continue; }

    const actualStart = Math.min(startSection, endSection) - 1;
    const actualEnd   = Math.max(startSection, endSection) - 1;

    const row = {
      streamerId: streamerNum,
      sectionIndexStart: actualStart,
      sectionIndexEnd: actualEnd,
      cleaningMethod: method,
      cleanedAt: dateObj.toISOString(),
      cleaningCount: 1,
      projectNumber,
      vesselTag,
    };
    if (sectionType) row.sectionType = sectionType;
    validRows.push(row);
  }

  return { validRows, parseErrorCount };
}

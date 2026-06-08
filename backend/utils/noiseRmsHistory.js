// Computes per-upload average RMS noise per streamer across active sections only.
// Pure logic — no DB or HTTP — so vessel operators can trend noise by upload batch.

/**
 * Average water speed for a single upload to correlate noise levels with vessel speed.
 * Returns the mean of SOL and EOL speeds when both are present, or whichever single
 * value exists. Returns null when neither is recorded (gap in the trend line).
 *
 * @param {{ waterSpeedStart: number|null, waterSpeedEnd: number|null }} upload
 * @returns {number|null}
 */
function avgWaterSpeedForUpload(upload) {
  const start = upload.waterSpeedStart ?? null;
  const end = upload.waterSpeedEnd ?? null;
  if (start !== null && end !== null) {
    return Math.round(((start + end) / 2) * 100) / 100;
  }
  if (start !== null) return start;
  if (end !== null) return end;
  return null;
}

/**
 * Average RMS for one streamer within a single upload, counting only active
 * sections (1..maxActiveSection) with positive RMS values (deployed sections).
 *
 * @param {Array<{ cableNumber: number, sectionNumber: number, rmsValue: number }>} rows
 * @param {number} streamerId - 1-based cable / streamer id
 * @param {number} maxActiveSection - highest active section_number (1-based)
 * @returns {number|null} rounded mean, or null when no qualifying cells
 */
function avgRmsForStreamerInUpload(rows, streamerId, maxActiveSection) {
  const values = [];
  for (const row of rows) {
    if (row.cableNumber !== streamerId) continue;
    if (row.sectionNumber < 1 || row.sectionNumber > maxActiveSection) continue;
    if (!row.rmsValue || row.rmsValue <= 0) continue;
    values.push(row.rmsValue);
  }
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(mean * 100) / 100;
}

/**
 * Builds historical average-RMS series per streamer for each noise upload batch,
 * using per-streamer active section limits from streamer_deployments overrides.
 * Also computes a parallel water-speed average array to let operators correlate
 * noise trends with vessel speed across the same upload timeline.
 *
 * @param {Array<{ id: number, uploadedAt: string, label: string|null, waterSpeedStart?: number|null, waterSpeedEnd?: number|null }>} uploads - oldest first
 * @param {Array<{ uploadId: number, cableNumber: number, sectionNumber: number, rmsValue: number }>} noiseRows
 * @param {Object<number, number>} sectionsPerCableMap - streamerId → active section count
 * @param {number} numCables
 * @returns {{ uploads: Array<{ id: number, uploadedAt: string, label: string|null }>, streamers: Array<{ streamerId: number, avgRms: Array<number|null> }>, waterSpeedAvg: Array<number|null> }}
 */
function buildNoiseRmsHistory(uploads, noiseRows, sectionsPerCableMap, numCables) {
  const rowsByUpload = new Map();
  for (const row of noiseRows) {
    if (!rowsByUpload.has(row.uploadId)) rowsByUpload.set(row.uploadId, []);
    rowsByUpload.get(row.uploadId).push(row);
  }

  const streamers = [];
  for (let streamerId = 1; streamerId <= numCables; streamerId++) {
    const maxActive = sectionsPerCableMap[streamerId] ?? 107;
    const avgRms = uploads.map((upload) => {
      const uploadRows = rowsByUpload.get(upload.id) || [];
      return avgRmsForStreamerInUpload(uploadRows, streamerId, maxActive);
    });
    streamers.push({ streamerId, avgRms });
  }

  const waterSpeedAvg = uploads.map(avgWaterSpeedForUpload);

  // Strip speed columns from the public upload objects — callers use waterSpeedAvg instead.
  const publicUploads = uploads.map(({ id, uploadedAt, label }) => ({ id, uploadedAt, label }));

  return { uploads: publicUploads, streamers, waterSpeedAvg };
}

module.exports = {
  avgWaterSpeedForUpload,
  avgRmsForStreamerInUpload,
  buildNoiseRmsHistory,
};

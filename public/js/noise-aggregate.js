/**
 * Merge several RMS datasets (one per sequence) into a per-section average and range.
 *
 * Input and output noise shape: { [cableNumber: string]: number[] }, 0-based section index.
 * Zero or non-finite values mean "section not deployed / no reading" and are ignored,
 * so each section is averaged only over the sequences that have a positive value for it.
 *
 * @param {Array<{ [cable: string]: number[] }>} datasets
 * @returns {{
 *   mean: { [cable: string]: number[] },
 *   range: { [cable: string]: { [section: number]: { min: number, max: number, count: number } } }
 * }}
 */
export function aggregateNoiseDatasets(datasets) {
  const mean = {};
  const range = {};

  // Gather positive readings per cable/section.
  const collected = {};
  datasets.forEach((dataset) => {
    Object.entries(dataset || {}).forEach(([cable, sections]) => {
      if (!Array.isArray(sections)) return;
      if (!collected[cable]) collected[cable] = [];
      sections.forEach((value, idx) => {
        if (!Number.isFinite(value) || value <= 0) return;
        if (!collected[cable][idx]) collected[cable][idx] = [];
        collected[cable][idx].push(value);
      });
    });
  });

  Object.entries(collected).forEach(([cable, sections]) => {
    sections.forEach((values, idx) => {
      if (!values || values.length === 0) return;
      const sum = values.reduce((acc, v) => acc + v, 0);
      if (!mean[cable]) mean[cable] = [];
      mean[cable][idx] = sum / values.length;
      if (!range[cable]) range[cable] = {};
      range[cable][idx] = {
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length,
      };
    });
  });

  return { mean, range };
}

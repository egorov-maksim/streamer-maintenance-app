/**
 * Shared legend preferences and coloring helpers for scraping-age and noise heatmaps.
 * Provides user-adjustable breakpoints persisted in localStorage so both the main
 * dashboard and the planning page stay in sync with matching gradient bars.
 */

const STORAGE_KEY = "heatmapLegendPrefs";

export const DEFAULT_PREFS = {
  /** Day boundaries at which the gradient transitions between color anchors. */
  ageBreaks: [4, 7, 10, 14],
  /** RMS value where the noise gradient transitions from cool (blue) to warm (red). */
  noiseCleanPivot: 5,
  /** RMS value capped to the deepest red in the noise gradient. */
  noisyMax: 20,
};

// Fixed RGB anchors matching --heat-* CSS variables; only the day positions are editable.
const AGE_COLOR_ANCHORS = [
  [34,  197,  94],  // #22c55e  --heat-fresh  (day 0)
  [163, 230,  53],  // #a3e635  --heat-4plus
  [253, 224,  71],  // #fde047  --heat-7plus
  [245, 158,  11],  // #f59e0b  --heat-10plus
  [239,  68,  68],  // #ef4444  --heat-14plus
];

const NEVER_STYLE = {
  backgroundColor: "#9ca3af",
  color: "#ffffff",
  borderColor: "#6b7280",
};

// ---------- Storage I/O ----------

/**
 * Load persisted user preferences from localStorage, merging over defaults so new
 * fields are always available even when an old stored value is present.
 * @returns {{ ageBreaks: number[], noiseCleanPivot: number, noisyMax: number }}
 */
export function loadHeatmapLegendPrefs() {
  try {
    const raw = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS, ageBreaks: [...DEFAULT_PREFS.ageBreaks] };
    const p = JSON.parse(raw);
    return {
      ageBreaks:
        Array.isArray(p.ageBreaks) && p.ageBreaks.length === 4
          ? p.ageBreaks.map(Number)
          : [...DEFAULT_PREFS.ageBreaks],
      noiseCleanPivot:
        typeof p.noiseCleanPivot === "number"
          ? p.noiseCleanPivot
          : DEFAULT_PREFS.noiseCleanPivot,
      noisyMax:
        typeof p.noisyMax === "number" ? p.noisyMax : DEFAULT_PREFS.noisyMax,
    };
  } catch {
    return { ...DEFAULT_PREFS, ageBreaks: [...DEFAULT_PREFS.ageBreaks] };
  }
}

/**
 * Merge partial preferences over the current stored values and persist.
 * @param {Partial<ReturnType<typeof loadHeatmapLegendPrefs>>} partial
 */
export function saveHeatmapLegendPrefs(partial) {
  try {
    const next = { ...loadHeatmapLegendPrefs(), ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota or private-browsing errors.
  }
}

// ---------- Validation ----------

/**
 * Validate and auto-correct age breakpoints so they are strictly increasing
 * integers ≥ 1. Returns the corrected array, or null when input is unusable
 * (wrong length, all NaN, etc.).
 * @param {unknown[]} breaks - expected to have exactly 4 elements
 * @returns {number[]|null}
 */
export function validateAgeBreaks(breaks) {
  if (!Array.isArray(breaks) || breaks.length !== 4) return null;
  const nums = breaks.map((v) => Math.max(1, Math.round(Number(v))));
  if (nums.some((v) => !isFinite(v))) return null;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] <= nums[i - 1]) nums[i] = nums[i - 1] + 1;
  }
  return nums;
}

// ---------- Internal color math ----------

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpRgb(c0, c1, t) {
  return [
    Math.round(lerp(c0[0], c1[0], t)),
    Math.round(lerp(c0[1], c1[1], t)),
    Math.round(lerp(c0[2], c1[2], t)),
  ];
}

/**
 * Quick luma approximation (no gamma correction) returning 0 (dark) – 1 (light).
 * Threshold 0.67 correctly classifies all five anchor colors versus the original CSS text colors.
 */
function perceivedLightness(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function interpolateAgeRgb(days, ageBreaks) {
  const edges = [0, ...ageBreaks]; // [0, b1, b2, b3, b4]
  if (days <= 0) return AGE_COLOR_ANCHORS[0];
  for (let i = 0; i < 4; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    if (days < hi) {
      const t = hi === lo ? 1 : (days - lo) / (hi - lo);
      return lerpRgb(AGE_COLOR_ANCHORS[i], AGE_COLOR_ANCHORS[i + 1], t);
    }
  }
  return AGE_COLOR_ANCHORS[4]; // days >= b4
}

// ---------- Public color API ----------

/**
 * Compute inline style values for a heatmap cell based on days since last scraping.
 * Uses piecewise linear RGB interpolation between the five anchor colors so the
 * gradient is truly continuous rather than banded like the previous bucket approach.
 * Returns the never-cleaned neutral gray when days is null/undefined.
 * @param {number|null} days
 * @param {{ ageBreaks: number[] }} prefs
 * @returns {{ backgroundColor: string, color: string, borderColor: string }}
 */
export function scrapingAgeStyle(days, prefs) {
  if (days === null || days === undefined) return NEVER_STYLE;
  const rgb = interpolateAgeRgb(days, prefs.ageBreaks);
  const bg = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const textColor = perceivedLightness(...rgb) > 0.67 ? "#111827" : "#ffffff";
  const borderRgb = rgb.map((v) => Math.max(0, Math.round(v * 0.78)));
  const border = `rgb(${borderRgb[0]},${borderRgb[1]},${borderRgb[2]})`;
  return { backgroundColor: bg, color: textColor, borderColor: border };
}

/**
 * Map an RMS noise value to a background CSS color using the two-segment gradient:
 *   0 → dark blue, noiseCleanPivot → white, noisyMax → deep red.
 * Returns null for zero / missing data so the caller can show a "no-data" style.
 * @param {number} rms
 * @param {{ noiseCleanPivot: number, noisyMax: number }} prefs
 * @returns {string|null}
 */
export function rmsToColor(rms, prefs) {
  if (!rms || rms <= 0) return null;
  const { noiseCleanPivot, noisyMax } = prefs;
  const val = Math.min(rms, noisyMax);
  if (val <= noiseCleanPivot) {
    const t = noiseCleanPivot > 0 ? val / noiseCleanPivot : 1;
    return `rgb(${Math.round(30 + t * 225)},${Math.round(58 + t * 197)},${Math.round(138 + t * 117)})`;
  }
  const range = noisyMax - noiseCleanPivot;
  const t = range > 0 ? (val - noiseCleanPivot) / range : 1;
  return `rgb(${Math.round(255 - t * 35)},${Math.round(255 - t * 217)},${Math.round(255 - t * 217)})`;
}

/**
 * Choose a readable text color for a noise cell based on its gradient background.
 * Dark text is used only around the pivot where the background is near-white.
 * @param {number} rms
 * @param {{ noiseCleanPivot: number, noisyMax: number }} prefs
 * @returns {string}
 */
export function rmsTextColor(rms, prefs) {
  if (!rms || rms <= 0) return "#6b7280";
  const { noiseCleanPivot, noisyMax } = prefs;
  const lowerBound = noiseCleanPivot / 2;
  const upperBound = noiseCleanPivot + (noisyMax - noiseCleanPivot) * 0.2;
  if (rms <= lowerBound) return "#ffffff";
  if (rms <= upperBound) return "#1a1a1a";
  return "#ffffff";
}

// ---------- Legend bar CSS strings ----------

/**
 * Build a CSS linear-gradient string for the scraping-age legend bar.
 * The five color stops use the same anchor colors as scrapingAgeStyle so the bar
 * always visually matches the cell coloring even when breakpoints change.
 * @param {{ ageBreaks: number[] }} prefs
 * @returns {string}
 */
export function scrapingAgeLegendGradient(prefs) {
  const [b1, b2, b3, b4] = prefs.ageBreaks;
  const pct = (d) => `${Math.round((d / b4) * 100)}%`;
  const hex = (anchor) => rgbToHex(...anchor);
  return [
    "linear-gradient(to right",
    `${hex(AGE_COLOR_ANCHORS[0])} 0%`,
    `${hex(AGE_COLOR_ANCHORS[1])} ${pct(b1)}`,
    `${hex(AGE_COLOR_ANCHORS[2])} ${pct(b2)}`,
    `${hex(AGE_COLOR_ANCHORS[3])} ${pct(b3)}`,
    `${hex(AGE_COLOR_ANCHORS[4])} 100%)`,
  ].join(", ");
}

/**
 * Build a CSS linear-gradient string for the noise legend bar that exactly
 * matches the three color points produced by rmsToColor at 0, cleanPivot, and max.
 * @param {{ noiseCleanPivot: number, noisyMax: number }} prefs
 * @returns {string}
 */
export function noiseLegendGradient(prefs) {
  const { noiseCleanPivot, noisyMax } = prefs;
  const pivotPct = `${Math.round((noiseCleanPivot / noisyMax) * 100)}%`;
  return `linear-gradient(to right, #1e3a8a 0%, #ffffff ${pivotPct}, #dc2626 100%)`;
}

// ---------- Tick renderers ----------

/**
 * Populate tick labels under the scraping-age gradient bar.
 * Tick positions are proportional to the max breakpoint so they always align
 * with the gradient stops.
 * @param {Element} ticksEl - container element for the tick spans
 * @param {{ ageBreaks: number[] }} prefs
 */
export function renderAgeTicks(ticksEl, prefs) {
  const [b1, b2, b3, b4] = prefs.ageBreaks;
  const ticks = [
    { val: 0,  pct: 0 },
    { val: b1, pct: Math.round((b1 / b4) * 100) },
    { val: b2, pct: Math.round((b2 / b4) * 100) },
    { val: b3, pct: Math.round((b3 / b4) * 100) },
    { val: b4, pct: 100, suffix: "+" },
  ];
  ticksEl.innerHTML = ticks
    .map(({ val, pct, suffix = "" }) =>
      `<span class="heatmap-legend-tick-item" style="left:${pct}%">${val}d${suffix}</span>`
    )
    .join("");
}

/**
 * Populate tick labels under the noise gradient bar.
 * Five evenly-spaced ticks show the actual RMS values at 0%, 25%, 50%, 75%, 100%
 * of noisyMax so crew can read off the threshold scale at a glance.
 * @param {Element} ticksEl - container element for the tick spans
 * @param {{ noisyMax: number }} prefs
 */
export function renderNoiseTicks(ticksEl, prefs) {
  const { noisyMax } = prefs;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t, i) => ({
    pct: Math.round(t * 100),
    label: i === 4 ? `${Math.round(noisyMax)}+` : String(+(noisyMax * t).toFixed(1)),
  }));
  ticksEl.innerHTML = ticks
    .map(({ pct, label }) =>
      `<span class="heatmap-legend-tick-item" style="left:${pct}%">${label}</span>`
    )
    .join("");
}

// ---------- Heatmap repaint ----------

/**
 * Apply continuous scraping-age inline styles to all active and tail section cells.
 * Reads days from dataset.scrapingDays (set by app.js) or falls back to
 * dataset.daysText (set by planning-page.js). Both store numeric strings or "—" for never.
 * @param {Element} container - the heatmap grid container element
 * @param {{ ageBreaks: number[] }} prefs
 */
export function paintScrapingAgeCells(container, prefs) {
  const cells = container.querySelectorAll(
    ".hm-vcell.hm-active-section, .hm-vcell.hm-tail-section"
  );
  cells.forEach((cell) => {
    const raw = cell.dataset.scrapingDays ?? cell.dataset.daysText;
    const days =
      !raw || raw === "—" || raw === "none" ? null : Number(raw);
    const style = scrapingAgeStyle(Number.isFinite(days) ? days : null, prefs);
    cell.style.backgroundColor = style.backgroundColor;
    cell.style.color = style.color;
    cell.style.borderColor = style.borderColor;
  });
}

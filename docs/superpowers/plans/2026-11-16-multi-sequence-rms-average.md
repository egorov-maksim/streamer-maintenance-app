# Multi-sequence RMS average Implementation Plan

> **For agentic workers:** Implemented inline in this session (native execution) because the change is small and confined to the browser planning view. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Planning, let the user tick several RMS sequences and see the average RMS per section across them, with the lowest–highest range per section shown in the section tooltip.

**Architecture:** Purely client-side. The existing `GET /api/noise-data?uploadId=` is called once per ticked upload; a pure function merges those datasets into a per-section mean (the existing `noiseData` shape, so the heatmap overlay and suggestions table pick it up unchanged) plus a per-section min/max range. No backend or schema change.

**Tech Stack:** Vanilla browser JS modules (`public/js`), Jest ESM tests (`tests/**/*.test.mjs`).

**Spec:** Design agreed in conversation (option B): average plus range; checkbox list for selection. Recorded here.

## Global Constraints

- Averaging skips zero/missing values per section, as the existing single-upload code does (zero = section not deployed on that cable).
- Sections with no positive value in any selected sequence are absent from the result.
- Noise data shape is unchanged: `{ [cableNumber: string]: number[] }`, 0-based section index.
- Single-sequence view behaves exactly as before.

## Review Focus

- Selected sequences cover different sections (one has a section the other lacks) → the average uses only sequences with a value for that section, and count reflects it.
- A sequence contains a 0 for a section → that zero is not averaged in.
- Exactly one ticked sequence → treated as the normal single-upload view, no range shown.
- Project changes or a ticked upload is deleted → selection is cleared/pruned, no stale data shown.
- A ticked sequence fails to load → the error is surfaced and the view falls back to the single selected upload instead of showing a partial average silently.

---

### Task 1: Pure aggregation module

**Files:**
- Create: `public/js/noise-aggregate.js`
- Test: `tests/noise-aggregate.test.mjs`

**Interfaces:**
- Produces: `aggregateNoiseDatasets(datasets: Array<{ [cable: string]: number[] }>) => { mean: NoiseData, range: { [cable: string]: { [section: number]: { min: number, max: number, count: number } } } }` where `NoiseData = { [cable: string]: number[] }`. Returns `{ mean: {}, range: {} }` for an empty array.

- [ ] **Step 1: Write the failing test** (`tests/noise-aggregate.test.mjs`)

```js
import { aggregateNoiseDatasets } from "../public/js/noise-aggregate.js";

test("means and ranges across sequences, skipping zero/missing", () => {
  const a = { "1": [0, 2, 4] };
  const b = { "1": [6, 0] };
  const { mean, range } = aggregateNoiseDatasets([a, b]);
  expect(mean["1"][0]).toBe(6);            // only b has value
  expect(mean["1"][1]).toBe(2);            // only a has value
  expect(mean["1"][2]).toBe(4);
  expect(range["1"][0]).toEqual({ min: 6, max: 6, count: 1 });
  expect(range["1"][1]).toEqual({ min: 2, max: 2, count: 1 });
});

test("averages two positive values and reports min/max/count", () => {
  const { mean, range } = aggregateNoiseDatasets([{ "2": [3] }, { "2": [5] }, { "2": [7] }]);
  expect(mean["2"][0]).toBe(5);
  expect(range["2"][0]).toEqual({ min: 3, max: 7, count: 3 });
});

test("empty input returns empty results", () => {
  expect(aggregateNoiseDatasets([])).toEqual({ mean: {}, range: {} });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/noise-aggregate.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `aggregateNoiseDatasets` in `public/js/noise-aggregate.js`**

Per cable, per section index: collect positive numbers across datasets; mean = sum/count; range = min/max/count. Sections with no positive value are omitted. Array-length of mean arrays = max length seen.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/noise-aggregate.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/js/noise-aggregate.js tests/noise-aggregate.test.mjs
git commit -m "feat: add pure multi-sequence RMS aggregation"
```

### Task 2: Sequence checkbox picker in the planning toolbar

**Files:**
- Modify: `public/planning.html` (add a `<details id="noise-compare-panel">` beside `#noise-upload-selector`, hidden until uploads exist)
- Modify: `public/planning-page.js` (populate checkboxes in `populateUploadSelector`-adjacent helper; clear on project change)
- Modify: `public/styles.css` (small panel style, reuse existing `.noise-*` tokens)

**Interfaces:**
- Consumes: `noiseUploads` from state (`{ id, label, measuredAt, uploadedAt }`).
- Produces: module variable `selectedNoiseUploadIds: Set<number>` and `populateComparePicker(uploads)`.

- [ ] **Step 1:** Add the `<details>` markup with summary text "Average of sequences" and a container `#noise-compare-list`.
- [ ] **Step 2:** In `refreshNoiseForProject`, prune `selectedNoiseUploadIds` to ids still present and repopulate checkboxes; clear the set when project is null.
- [ ] **Step 3:** Manual check in browser (Task 4).
- [ ] **Step 4: Commit** `feat: add sequence picker for averaging RMS uploads`

### Task 3: Load and display the aggregate

**Files:**
- Modify: `public/planning-page.js`

**Interfaces:**
- Consumes: `aggregateNoiseDatasets` (Task 1), `API.getNoiseData(uploadId, project)`.
- Produces: module variable `noiseRange` (null in single mode) used by tooltip.

- [ ] **Step 1:** Add `applyNoiseSelection()`: 0 ticked → load the selector's upload (current behavior), `noiseRange = null`; 1 ticked → load that upload, `noiseRange = null`; ≥2 ticked → `Promise.all` of `API.getNoiseData` for each, aggregate, `setNoiseData(mean)`, `noiseRange = range`. On any failure, show error toast and fall back to single selected upload.
- [ ] **Step 2:** Checkbox `change` → `applyNoiseSelection()` → `updateNoiseToolbarStatus()` → `updatePlanningHeatmapCardTitle()` → `renderPlanningHeatmap()`.
- [ ] **Step 3:** Status text when ≥2 ticked: `Average of N sequences.` 
- [ ] **Step 4:** In `attachSectionTooltips`, when `noiseRange` has `count >= 2` for the cell, append `Range: min–max (N sequences)` under the RMS row.
- [ ] **Step 5: Commit** `feat: average RMS per section across selected sequences`

### Task 4: Verification

- [ ] **Step 1:** `npm test` — all existing backend and new frontend tests pass.
- [ ] **Step 2:** Run the app and exercise the picker with two or more uploads in a seeded project; confirm the heatmap colours, suggestions table average, and tooltip range change with the selection and revert with one or none ticked.
- [ ] **Step 3: Commit** any fixes; push branch and open draft PR against `dev`.

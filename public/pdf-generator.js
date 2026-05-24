/**
 * PDF Report Generator
 * pdf-generator.js (ES module)
 */

import { safeGet, setStatus } from "./js/ui.js";
import { config, getActiveProject } from "./js/state.js";
import { formatAS, formatSectionLabel, eventDistance, fmtKm, formatEB, getEBRangeForSectionRange } from "./js/streamer-utils.js";
import { getAuthHeaders } from "./js/api.js";
import { openModal, closeModal } from "./js/modals.js";
import { loadHeatmapLegendPrefs, scrapingAgeStyle, rmsToColor } from "./js/heatmap-legend.js";

function parseRgbOrHex(cssColor) {
  if (typeof cssColor !== "string" || !cssColor) return { r: 0, g: 0, b: 0 };
  const rgbMatch = cssColor.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgbMatch) {
    return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
  }

  const hexMatch = cssColor.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return { r, g, b };
  }

  return { r: 0, g: 0, b: 0 };
}

function loadScriptOnce(src) {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing?.dataset.loaded === "1") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Dynamically injects jsPDF and jspdf-autotable UMD scripts the first time they are needed.
 */
async function loadJspdf() {
  if (!window.jspdf) {
    await loadScriptOnce("libs/jspdf.umd.min.js");
  }
  const { jsPDF } = window.jspdf || {};
  const probe = new jsPDF();
  if (typeof probe.autoTable !== "function") {
    await loadScriptOnce("libs/jspdf-autotable.min.js");
  }
}

async function generatePDFReport({
  includeEventsLog = true,
  includeNoiseHeatmap = false,
  noiseUploadId = null,
} = {}) {
  const statusEl = safeGet('pdf-status');
  try {
    await loadJspdf();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', format: 'a3' });

    // Fetch stats from backend
    let statsUrl = 'api/stats';
    if (config.activeProjectNumber) {
      statsUrl += `?project=${encodeURIComponent(config.activeProjectNumber)}`;
    }
    const statsRes = await fetch(statsUrl, { headers: getAuthHeaders() });
    const stats = await statsRes.json();

    // Fetch last-cleaned data
    let lastCleanedUrl = "api/last-cleaned";
    if (config.activeProjectNumber) {
      lastCleanedUrl += `?project=${encodeURIComponent(config.activeProjectNumber)}`;
    }
    const lastCleanedRes = await fetch(lastCleanedUrl, { headers: getAuthHeaders() });
    const lastCleanedData = await lastCleanedRes.json();
    const lastCleaned = lastCleanedData.lastCleaned;

    // Get filter dates
    const startDate = safeGet('filter-start')?.value;
    const endDate = safeGet('filter-end')?.value;
    const hasDateFilter = Boolean(startDate || endDate);

    let filteredStats = null;
    let filteredLastCleaned = null;

    if (startDate || endDate) {
      const params = new URLSearchParams();
      if (startDate) params.append('start', startDate);
      if (endDate) params.append('end', endDate);
      if (config.activeProjectNumber) params.append('project', config.activeProjectNumber);

      const filterRes = await fetch(`api/stats/filter?${params}`, { headers: getAuthHeaders() });
      filteredStats = await filterRes.json();

      // Fetch filtered last-cleaned data for filtered heatmap
      const filteredCleanedRes = await fetch(`api/last-cleaned-filtered?${params}`, { headers: getAuthHeaders() });
      const filteredCleanedData = await filteredCleanedRes.json();
      filteredLastCleaned = filteredCleanedData.lastCleaned;
    }

    // Calculate totals using API data
    const totalSections = stats.totalAvailableSections + stats.totalAvailableTail;
    const overallCoverage = totalSections > 0 
      ? ((stats.uniqueCleanedSections / totalSections) * 100).toFixed(1) 
      : 0;
    const activeCoverage = stats.totalAvailableSections > 0 
      ? ((stats.activeCleanedSections / stats.totalAvailableSections) * 100).toFixed(1) 
      : 0;
    const tailCoverage = stats.totalAvailableTail > 0 
      ? ((stats.tailCleanedSections / stats.totalAvailableTail) * 100).toFixed(1) 
      : 0;

    // === PDF Header ===
    doc.setFontSize(20);
    doc.text('Streamer Maintenance Report', 148, 15, { align: 'center' });
    doc.setFontSize(10);
    const reportDate = new Date().toLocaleString();
    doc.text(`Generated: ${reportDate}`, 148, 22, { align: 'center' });

    if (config.activeProjectNumber) {
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(`Project: ${config.activeProjectNumber}`, 148, 28, { align: 'center' });
      doc.setTextColor(0, 0, 0); // Reset color
    }

    // === Configuration Section ===
    let yPos = 35;
    doc.setFontSize(14);
    doc.text('Configuration', 20, yPos);
    yPos += 8;
    doc.setFontSize(10);
    doc.text(`Number of Cables: ${config.numCables}`, 25, yPos);
    yPos += 6;
    doc.text(`Sections per Cable: ${config.sectionsPerCable}`, 25, yPos);
    yPos += 6;
    doc.text(`Tail Sections: ${config.useRopeForTail ? 'Using rope (no tails)' : '5 tail sections added'}`, 25, yPos);
    
    // Add deployment date and coating status if available
    // Global deployment/coating flags are no longer used here;
    // detailed per-streamer deployment/coating info is shown later.

    // === Overall Statistics ===
    yPos += 15;
    doc.setFontSize(14);
    doc.text('Overall Statistics', 20, yPos);
    yPos += 8;
    doc.setFontSize(10);
    doc.text(`Total Cleaning Events: ${stats.totalEvents}`, 25, yPos);
    yPos += 6;
    doc.text(`Total Distance Cleaned: ${fmtKm(stats.totalDistance)}`, 25, yPos);
    yPos += 6;
    doc.text(`Overall Coverage: ${overallCoverage}% (${stats.uniqueCleanedSections}/${totalSections} sections)`, 25, yPos);
    yPos += 6;
    doc.text(`Active Section Coverage: ${activeCoverage}% (${stats.activeCleanedSections}/${stats.totalAvailableSections} sections)`, 25, yPos);
    
    if (stats.totalAvailableTail > 0) {
      yPos += 6;
      doc.text(`Tail Section Coverage: ${tailCoverage}% (${stats.tailCleanedSections}/${stats.totalAvailableTail} sections)`, 25, yPos);
    }

    // === Streamer Deployment & Coating (per streamer, like header tooltip) ===
    // Omitted when a date filter is active — deployment/coating is project-level metadata, not period-specific.
    const activeProject = getActiveProject();
    if (activeProject && !hasDateFilter) {
      try {
        // Fetch per-streamer deployments for active project
        const deploymentsRes = await fetch(`/api/projects/${activeProject.id}/streamer-deployments`, {
          headers: getAuthHeaders()
        });
        const deployments = await deploymentsRes.json();

        // Fetch events for this project to calculate first-scraping days
        let eventsUrl = 'api/events';
        if (config.activeProjectNumber) {
          eventsUrl += `?project=${encodeURIComponent(config.activeProjectNumber)}`;
        }
        const eventsRes = await fetch(eventsUrl, { headers: getAuthHeaders() });
        const eventsForProject = await eventsRes.json();

        yPos += 15;
        doc.setFontSize(14);
        doc.text('Streamer Deployment & Coating', 20, yPos);
        yPos += 8;

        doc.setFontSize(9);
        doc.text('Streamer', 20, yPos);
        doc.text('Deployed', 45, yPos);
        doc.text('Coating', 85, yPos);
        doc.text('Days to First Cleaning', 115, yPos);
        doc.text('Total Cleanings', 165, yPos);
        yPos += 5;

        const pageHeight = doc.internal.pageSize.getHeight();

        for (let streamerNum = 1; streamerNum <= config.numCables; streamerNum++) {
          if (yPos > pageHeight - 20) {
            doc.addPage('a3', 'landscape');
            yPos = 20;
            doc.setFontSize(9);
            doc.text('Streamer', 20, yPos);
            doc.text('Deployed', 45, yPos);
            doc.text('Coating', 85, yPos);
            doc.text('Days to First Cleaning', 115, yPos);
            doc.text('Total Cleanings', 165, yPos);
            yPos += 5;
          }

          const deployment = deployments[streamerNum] || {};
          const deployDateStr = deployment.deploymentDate
            ? new Date(deployment.deploymentDate).toLocaleDateString()
            : '—';
          const coatingLabel =
            deployment.isCoated === true
              ? 'Coated'
              : deployment.isCoated === false
              ? 'Uncoated'
              : 'Unknown';

          const streamerEvents = eventsForProject.filter(
            (e) => e.streamerId === streamerNum
          );

          let daysToFirst = null;
          if (deployment.deploymentDate && streamerEvents.length > 0) {
            const firstCleaning = [...streamerEvents].sort(
              (a, b) => new Date(a.cleanedAt) - new Date(b.cleanedAt)
            )[0];
            const msPerDay = 1000 * 60 * 60 * 24;
            const diffDays = Math.floor(
              (new Date(firstCleaning.cleanedAt) - new Date(deployment.deploymentDate)) /
                msPerDay
            );
            if (diffDays >= 0) {
              daysToFirst = diffDays;
            }
          }

          const daysToFirstLabel =
            daysToFirst !== null ? `${daysToFirst} days` : '—';

          doc.text(`S${streamerNum}`, 20, yPos);
          doc.text(String(deployDateStr), 45, yPos);
          doc.text(coatingLabel, 85, yPos);
          doc.text(daysToFirstLabel, 115, yPos);
          doc.text(String(streamerEvents.length), 165, yPos);
          yPos += 5;
        }
      } catch (err) {
        console.error('Failed to render deployment/coating section in PDF:', err);
      }
    }

    // === Filtered Statistics (if applicable) ===
    if (filteredStats) {
      yPos += 15;
      doc.setFontSize(14);
      doc.text('Filtered Period Statistics', 20, yPos);
      yPos += 8;
      doc.setFontSize(10);
      
      if (startDate) {
        doc.text(`From: ${startDate}`, 25, yPos);
        yPos += 6;
      }
      if (endDate) {
        doc.text(`To: ${endDate}`, 25, yPos);
        yPos += 6;
      }
      
      doc.text(`Events: ${filteredStats.events}`, 25, yPos);
      yPos += 6;
      doc.text(`Distance: ${fmtKm(filteredStats.totalDistance)}`, 25, yPos);
      yPos += 6;

      const filteredTotal = filteredStats.uniqueCleanedSections;
      const filteredCoverage = totalSections > 0 
        ? ((filteredTotal / totalSections) * 100).toFixed(1) 
        : 0;
      doc.text(`Sections Cleaned: ${filteredTotal} (${filteredCoverage}%)`, 25, yPos);
      yPos += 6;

      const filteredActivePct = stats.totalAvailableSections > 0 
        ? ((filteredStats.activeCleanedSections / stats.totalAvailableSections) * 100).toFixed(1) 
        : 0;
      doc.text(`Active Coverage: ${filteredActivePct}% (${filteredStats.activeCleanedSections}/${stats.totalAvailableSections})`, 25, yPos);

      if (stats.totalAvailableTail > 0) {
        yPos += 6;
        const filteredTailPct = ((filteredStats.tailCleanedSections / stats.totalAvailableTail) * 100).toFixed(1);
        doc.text(`Tail Coverage: ${filteredTailPct}% (${filteredStats.tailCleanedSections}/${stats.totalAvailableTail})`, 25, yPos);
      }

      // Methods breakdown
      if (filteredStats.byMethod && Object.keys(filteredStats.byMethod).length > 0) {
        yPos += 8;
        doc.text('Cleaning Methods Used:', 25, yPos);
        yPos += 6;
        for (const [method, distance] of Object.entries(filteredStats.byMethod)) {
          if (yPos > 190) {
            doc.addPage('a3', 'landscape');
            yPos = 20;
          }
          doc.text(`  ${method}: ${fmtKm(distance)}`, 30, yPos);
          yPos += 6;
        }
      }
    }

    // === ALL HISTORY Heatmap (always included) ===
    doc.addPage('a3', 'landscape');
    await addHeatmapPage(doc, lastCleaned, 'All History');

    // === FILTERED Heatmap (only if filters are active) ===
    if (filteredLastCleaned && (startDate || endDate)) {
      doc.addPage('a3', 'landscape');
      const filterLabel = (startDate && endDate) 
        ? `${startDate} to ${endDate}` 
        : startDate 
          ? `From ${startDate}` 
          : `Until ${endDate}`;
      await addHeatmapPage(doc, filteredLastCleaned, `Filtered Period (${filterLabel})`);
    }

    // === Optional Noise Heatmap ===
    if (includeNoiseHeatmap) {
      const projectNumber = config.activeProjectNumber;
      if (projectNumber) {
        const params = new URLSearchParams();
        if (noiseUploadId) params.set("uploadId", String(noiseUploadId));
        params.set("project", String(projectNumber));
        const noiseUrl = `api/noise-data?${params.toString()}`;

        const noiseRes = await fetch(noiseUrl, { headers: getAuthHeaders() });
        const noisePayload = await noiseRes.json();
        const noiseData = noisePayload?.noiseData || null;

        const uploadedAt = noisePayload?.uploadedAt
          ? new Date(noisePayload.uploadedAt).toLocaleDateString()
          : null;
        const label = noisePayload?.label || (noiseUploadId ? `Upload ${noiseUploadId}` : "Latest");
        const titleSuffix = uploadedAt ? `${label} (${uploadedAt})` : label;

        doc.addPage('a3', 'landscape');
        await addNoiseHeatmapPage(doc, noiseData, `Noise Heatmap (${titleSuffix})`);
      } else {
        console.warn("Noise heatmap requested but no active project selected.");
      }
    }

    // === All Events (optional) ===
    if (includeEventsLog) {
      doc.addPage('a3', 'landscape');
      await addAllEventsSection(doc, startDate, endDate);
    }

    // Save
    const filename = `streamer-maintenance-report-${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);

    setStatus(statusEl, 'PDF report generated successfully!', false);
  } catch (err) {
    console.error('PDF generation error:', err);
    setStatus(statusEl, `Failed to generate PDF report: ${err.message}`, true);
  }
}

/**
 * Helper: Add heatmap page with HORIZONTAL orientation
 * Cables as columns (RIGHT TO LEFT: S12, S11... S2, S1)
 * Sections as rows (AS01-AS107 down left)
 */
async function addHeatmapPage(doc, lastCleaned, title) {
  // === Cleaning Status Heatmap ===
  let yPos = 15;
  doc.setFontSize(16);
  doc.text(title, 148, yPos, { align: 'center' });
  yPos += 8;

  const numCables = config.numCables;
  const sectionsPerCable = config.sectionsPerCable;
  const tailSections = config.useRopeForTail ? 0 : 5;
  const totalSections = sectionsPerCable + tailSections;

  // Calculate dimensions for horizontal layout (landscape)
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const leftMargin = 20; // Space for section labels (AS01, AS02, etc.)
  const rightMargin = 35; // Space for EB range labels
  const topMargin = yPos + 5;
  const bottomMargin = 25; // Space for legend

  const availableWidth = pageWidth - leftMargin - rightMargin;
  const availableHeight = pageHeight - topMargin - bottomMargin;

  // Calculate cell dimensions to fill all available space (fit to page)
  const cellWidth = availableWidth / numCables;
  const cellHeight = availableHeight / totalSections;

  const heatmapWidth = cellWidth * numCables;
  const heatmapHeight = cellHeight * totalSections;

  // Center the heatmap horizontally
  const startX = leftMargin + 15; // Space for section labels
  const startY = topMargin + 8; // Space for cable labels

  // Pre-compute EB module positions per section (active sections only)
  const moduleFreq = config.moduleFrequency || 4;
  const legendPrefs = loadHeatmapLegendPrefs();
  const modulesBySection = Array.from({ length: totalSections }, () => null);

  // Always have EB01 at section 0
  modulesBySection[0] = 1;

  for (let sectionIndex = moduleFreq; sectionIndex < sectionsPerCable; sectionIndex += moduleFreq) {
    const moduleNum = Math.floor(sectionIndex / moduleFreq) + 1;
    if (sectionIndex < totalSections) {
      modulesBySection[sectionIndex] = moduleNum;
    }
  }

  const lastModuleNum = Math.floor((sectionsPerCable - 1) / moduleFreq) + 1;
  const lastModuleSection = sectionsPerCable - 1;
  if (lastModuleSection < totalSections && !modulesBySection[lastModuleSection]) {
    modulesBySection[lastModuleSection] = lastModuleNum;
  }

  // Draw cable numbers at top (RIGHT TO LEFT: S12, S11, S10... S2, S1)
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  for (let c = 0; c < numCables; c++) {
    // Display cables in reverse order: rightmost column is S12, leftmost is S1
    const cableLabel = `S${numCables - c}`;
    const xPos = startX + c * cellWidth + cellWidth / 2;
    doc.text(cableLabel, xPos, startY - 3, { align: 'center' });
  }

  // Draw heatmap grid with section numbers on left and EB ranges on right
  doc.setFontSize(6);
  for (let s = 0; s < totalSections; s++) {
    const rowY = startY + s * cellHeight;

    // Section number on left (AS01..AS107 or Tail 1..Tail 5) - show every 5 sections
    if (s % 5 === 0 || s === 0 || s === totalSections - 1) {
      const sectionLabel = s < sectionsPerCable
        ? formatSectionLabel(s, 'active')
        : formatSectionLabel(s - sectionsPerCable, 'tail');
      doc.setTextColor(0, 0, 0);
      doc.text(sectionLabel, leftMargin + 12, rowY + cellHeight / 2 + 1, { align: 'right' });
    }

    // Draw cells for each cable - RIGHT TO LEFT ordering
    for (let c = 0; c < numCables; c++) {
      // Display cables in reverse: column 0 shows streamerId=numCables, column 11 shows streamerId=1
      const streamerId = numCables - c;
      const streamerData = lastCleaned[streamerId];
      const lastCleanedDate = streamerData?.[s];

      let days = null;
      if (lastCleanedDate) {
        days = Math.floor((Date.now() - new Date(lastCleanedDate)) / (1000 * 60 * 60 * 24));
      }

      const style = scrapingAgeStyle(days, legendPrefs);
      const fillRgb = parseRgbOrHex(style.backgroundColor);
      const borderRgb = parseRgbOrHex(style.borderColor);

      doc.setFillColor(fillRgb.r, fillRgb.g, fillRgb.b);
      doc.rect(startX + c * cellWidth, rowY, cellWidth, cellHeight, 'F');

      doc.setDrawColor(borderRgb.r, borderRgb.g, borderRgb.b);
      doc.setLineWidth(0.05);
      doc.rect(startX + c * cellWidth, rowY, cellWidth, cellHeight, 'S');
    }

    // EB module labels on right side:
    // show only even-numbered modules (EB02, EB04, ...) and no ranges
    const moduleNum = modulesBySection[s];
    if (moduleNum && moduleNum % 2 === 0) {
      const ebLabel = formatEB(moduleNum);
      doc.setFontSize(6);
      doc.setTextColor(0, 0, 0);
      doc.text(ebLabel, startX + heatmapWidth + 3, rowY + cellHeight / 2 + 1, { align: 'left' });
    }
  }

  // Bold horizontal lines below even EB starts only (EB02, EB04, …); odd EBs have no separator.
  const ebSepEndX = startX + heatmapWidth + 18;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.4);
  for (let boundaryS = moduleFreq; boundaryS < sectionsPerCable; boundaryS += moduleFreq) {
    const moduleNum = Math.floor(boundaryS / moduleFreq) + 1;
    if (moduleNum % 2 !== 0) continue;
    const lineY = startY + (boundaryS + 1) * cellHeight;
    doc.line(startX, lineY, ebSepEndX, lineY);
  }

  // Legend at bottom
  yPos = startY + heatmapHeight + 6;
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text('Legend:', leftMargin, yPos);
  const legendRowY = yPos + 1;
  doc.setFontSize(7);

  // "Never cleaned" swatch (separate from gradient bar, like the app).
  const [b1, b2, b3, b4] = legendPrefs.ageBreaks;
  const neverStyle = scrapingAgeStyle(null, legendPrefs);
  const neverRgb = parseRgbOrHex(neverStyle.backgroundColor);

  const neverX = leftMargin + 18;
  doc.setFillColor(neverRgb.r, neverRgb.g, neverRgb.b);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.1);
  doc.rect(neverX, legendRowY, 4, 3, "F");
  doc.rect(neverX, legendRowY, 4, 3, "S");
  doc.setTextColor(0, 0, 0);
  doc.text("Never cleaned", neverX + 6, legendRowY + 2.2);

  // Gradient bar for day thresholds (continuous sampling), matching app breakpoints.
  const barX = neverX + 55;
  const barY = legendRowY;
  const barW = 105;
  const barH = 4;
  const segCount = 60;
  const segW = barW / segCount;

  for (let i = 0; i < segCount; i++) {
    const tMid = (i + 0.5) / segCount; // 0..1
    const daysSample = tMid * b4;
    const style = scrapingAgeStyle(daysSample, legendPrefs);
    const rgb = parseRgbOrHex(style.backgroundColor);
    doc.setFillColor(rgb.r, rgb.g, rgb.b);
    doc.rect(barX + i * segW, barY, segW + 0.1, barH, "F");
  }
  doc.setDrawColor(107, 114, 128);
  doc.rect(barX, barY, barW, barH, "S");

  // Tick marks + labels under the gradient bar.
  doc.setTextColor(107, 114, 128);
  doc.setFontSize(6);
  const tickY = barY + barH + 1;
  const labelY = tickY + 1.3;
  const ticks = [
    { val: 0, label: "0d" },
    { val: b1, label: `${b1}d` },
    { val: b2, label: `${b2}d` },
    { val: b3, label: `${b3}d` },
    { val: b4, label: `${b4}d+` },
  ];

  for (const tick of ticks) {
    const pct = b4 > 0 ? tick.val / b4 : 0;
    const x = barX + pct * barW;
    doc.setDrawColor(107, 114, 128);
    doc.setLineWidth(0.1);
    doc.line(x, tickY, x, tickY + 1);
    doc.text(tick.label, x, labelY, { align: "center" });
  }
}

/**
 * Helper: Add noise RMS heatmap page (HORIZONTAL layout, same grid structure as age heatmap).
 * Uses the selected noise upload (or latest when uploadId is not provided) to color active sections.
 */
async function addNoiseHeatmapPage(doc, noiseData, title) {
  const prefs = loadHeatmapLegendPrefs();

  // === Noise Heatmap ===
  let yPos = 15;
  doc.setFontSize(16);
  doc.text(title, 148, yPos, { align: "center" });
  yPos += 8;

  const numCables = config.numCables;
  const sectionsPerCable = config.sectionsPerCable;
  const tailSections = config.useRopeForTail ? 0 : 5;
  const totalSections = sectionsPerCable + tailSections;

  // Calculate dimensions for horizontal layout (landscape)
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const leftMargin = 20; // Space for section labels (AS01, AS02, etc.)
  const rightMargin = 35; // Space for EB range labels
  const topMargin = yPos + 5;
  const bottomMargin = 25; // Space for legend

  const availableWidth = pageWidth - leftMargin - rightMargin;
  const availableHeight = pageHeight - topMargin - bottomMargin;

  // Calculate cell dimensions to fill all available space (fit to page)
  const cellWidth = availableWidth / numCables;
  const cellHeight = availableHeight / totalSections;

  const heatmapWidth = cellWidth * numCables;
  const heatmapHeight = cellHeight * totalSections;

  // Center the heatmap horizontally
  const startX = leftMargin + 15; // Space for section labels
  const startY = topMargin + 8; // Space for cable labels

  // Pre-compute EB module positions per section (active sections only)
  const moduleFreq = config.moduleFrequency || 4;
  const modulesBySection = Array.from({ length: totalSections }, () => null);
  modulesBySection[0] = 1; // EB01 at section 0

  for (let sectionIndex = moduleFreq; sectionIndex < sectionsPerCable; sectionIndex += moduleFreq) {
    const moduleNum = Math.floor(sectionIndex / moduleFreq) + 1;
    if (sectionIndex < totalSections) modulesBySection[sectionIndex] = moduleNum;
  }

  const lastModuleNum = Math.floor((sectionsPerCable - 1) / moduleFreq) + 1;
  const lastModuleSection = sectionsPerCable - 1;
  if (lastModuleSection < totalSections && !modulesBySection[lastModuleSection]) {
    modulesBySection[lastModuleSection] = lastModuleNum;
  }

  // Draw cable numbers at top (RIGHT TO LEFT: S12, S11, ... S2, S1)
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  for (let c = 0; c < numCables; c++) {
    const cableLabel = `S${numCables - c}`;
    const xPos = startX + c * cellWidth + cellWidth / 2;
    doc.text(cableLabel, xPos, startY - 3, { align: "center" });
  }

  // Draw heatmap grid
  doc.setFontSize(6);
  for (let s = 0; s < totalSections; s++) {
    const rowY = startY + s * cellHeight;

    // Section number on left (AS01..AS107 or Tail 1..Tail 5) - show every 5 sections
    if (s % 5 === 0 || s === 0 || s === totalSections - 1) {
      const sectionLabel = s < sectionsPerCable
        ? formatSectionLabel(s, "active")
        : formatSectionLabel(s - sectionsPerCable, "tail");
      doc.setTextColor(0, 0, 0);
      doc.text(sectionLabel, leftMargin + 12, rowY + cellHeight / 2 + 1, { align: "right" });
    }

    // Draw cells for each cable - RIGHT TO LEFT ordering
    for (let c = 0; c < numCables; c++) {
      const streamerId = numCables - c;
      const rms = noiseData?.[streamerId]?.[s] ?? 0;
      const bgCss = rmsToColor(rms, prefs);

      const fillRgb = bgCss
        ? parseRgbOrHex(bgCss)
        : parseRgbOrHex("#e5e7eb");
      doc.setFillColor(fillRgb.r, fillRgb.g, fillRgb.b);
      doc.rect(startX + c * cellWidth, rowY, cellWidth, cellHeight, "F");

      const borderRgb = {
        r: Math.max(0, Math.round(fillRgb.r * 0.78)),
        g: Math.max(0, Math.round(fillRgb.g * 0.78)),
        b: Math.max(0, Math.round(fillRgb.b * 0.78)),
      };
      doc.setDrawColor(borderRgb.r, borderRgb.g, borderRgb.b);
      doc.setLineWidth(0.05);
      doc.rect(startX + c * cellWidth, rowY, cellWidth, cellHeight, "S");
    }

    // EB module labels on right side:
    // show only even-numbered modules (EB02, EB04, ...) and no ranges
    const moduleNum = modulesBySection[s];
    if (moduleNum && moduleNum % 2 === 0) {
      const ebLabel = formatEB(moduleNum);
      doc.setFontSize(6);
      doc.setTextColor(0, 0, 0);
      doc.text(ebLabel, startX + heatmapWidth + 3, rowY + cellHeight / 2 + 1, { align: "left" });
    }
  }

  // Bold horizontal lines at even EB boundaries (match age heatmap separators).
  const ebSepEndX = startX + heatmapWidth + 18;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.4);
  for (let boundaryS = moduleFreq; boundaryS < sectionsPerCable; boundaryS += moduleFreq) {
    const moduleNum = Math.floor(boundaryS / moduleFreq) + 1;
    if (moduleNum % 2 !== 0) continue;
    const lineY = startY + (boundaryS + 1) * cellHeight;
    doc.line(startX, lineY, ebSepEndX, lineY);
  }

  // Legend at bottom
  yPos = startY + heatmapHeight + 6;
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text("Legend:", leftMargin, yPos);

  const legendRowY = yPos + 1;
  doc.setFontSize(7);

  // No data swatch
  const noDataRgb = parseRgbOrHex("#9ca3af");
  const noDataX = leftMargin + 18;
  doc.setFillColor(noDataRgb.r, noDataRgb.g, noDataRgb.b);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.1);
  doc.rect(noDataX, legendRowY, 4, 3, "F");
  doc.rect(noDataX, legendRowY, 4, 3, "S");
  doc.setTextColor(0, 0, 0);
  doc.text("No RMS data", noDataX + 6, legendRowY + 2.2);

  // Gradient bar (sampled)
  const barX = noDataX + 60;
  const barY = legendRowY;
  const barW = 120;
  const barH = 4;
  const segCount = 60;
  const segW = barW / segCount;

  const { noisyMax } = prefs;
  const minSample = 0.001;
  for (let i = 0; i < segCount; i++) {
    const tMid = (i + 0.5) / segCount; // 0..1
    const rmsSample = Math.max(minSample, tMid * noisyMax);
    const bgCss = rmsToColor(rmsSample, prefs);
    const rgb = parseRgbOrHex(bgCss);
    doc.setFillColor(rgb.r, rgb.g, rgb.b);
    doc.rect(barX + i * segW, barY, segW + 0.1, barH, "F");
  }

  doc.setDrawColor(107, 114, 128);
  doc.setLineWidth(0.1);
  doc.rect(barX, barY, barW, barH, "S");

  // Ticks + labels
  doc.setTextColor(107, 114, 128);
  doc.setFontSize(6);
  const tickY = barY + barH + 1;
  const labelY = tickY + 1.3;
  const tickTs = [0, 0.25, 0.5, 0.75, 1];
  for (let i = 0; i < tickTs.length; i++) {
    const t = tickTs[i];
    const pct = noisyMax > 0 ? t : 0;
    const x = barX + pct * barW;
    doc.setDrawColor(107, 114, 128);
    doc.setLineWidth(0.1);
    doc.line(x, tickY, x, tickY + 1);

    const label = i === 4 ? `${Math.round(noisyMax)}+` : String(+(noisyMax * t).toFixed(1));
    doc.text(label, x, labelY, { align: "center" });
  }
}

/**
 * Helper: Add all events section with EB range column.
 * If startDate/endDate are provided, only events within that range are included.
 */
async function addAllEventsSection(doc, startDate, endDate) {
  let eventsUrl = "api/events";
  if (config.activeProjectNumber) {
    eventsUrl += `?project=${encodeURIComponent(config.activeProjectNumber)}`;
  }
  const eventsRes = await fetch(eventsUrl, { headers: getAuthHeaders() });
  const allEvents = await eventsRes.json();

  const eventsToShow = (startDate || endDate)
    ? allEvents.filter((e) => {
        const eventDate = new Date(e.cleanedAt).toISOString().split("T")[0];
        if (startDate && endDate) return eventDate >= startDate && eventDate <= endDate;
        if (startDate) return eventDate >= startDate;
        if (endDate) return eventDate <= endDate;
        return true;
      })
    : allEvents;

  const hasFilter = Boolean(startDate || endDate);
  const sectionTitle = hasFilter
    ? `Cleaning Events (${eventsToShow.length} in selected period)`
    : `All Cleaning Events (${eventsToShow.length} total)`;

  if (eventsToShow.length === 0) {
    doc.setFontSize(14);
    doc.text(sectionTitle, 20, 20);
    doc.setFontSize(8);
    doc.text(
      hasFilter ? "No cleaning events recorded for the selected period." : "No cleaning events recorded.",
      25,
      30
    );
    return;
  }

  const ebRanges = eventsToShow.map((evt) =>
    evt.sectionType === "tail"
      ? "—"
      : getEBRangeForSectionRange(evt.sectionIndexStart, evt.sectionIndexEnd, config)
  );

  const tableBody = eventsToShow.map((evt, i) => {
    const sectionType = evt.sectionType || "active";
    const ebRangeRaw = ebRanges[i];
    const ebRange =
      typeof ebRangeRaw === "string" && ebRangeRaw.trim().length > 0 ? ebRangeRaw : "—";
    return [
      new Date(evt.cleanedAt).toLocaleDateString(),
      `S${evt.streamerId}`,
      `${formatSectionLabel(evt.sectionIndexStart, sectionType)} - ${formatSectionLabel(evt.sectionIndexEnd, sectionType)}`,
      ebRange,
      evt.cleaningMethod,
      evt.addedByUsertag || "—",
      `${eventDistance(evt)}m`,
      String(evt.cleaningCount || 1),
    ];
  });

  doc.setFontSize(14);
  doc.text(sectionTitle, 20, 16);

  doc.autoTable({
    head: [["Date", "Cable", "Sections", "EB Range", "Method", "Added by", "Length", "Count"]],
    body: tableBody,
    startY: 22,
    margin: { left: 15, right: 15 },
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 8 },
    theme: "grid",
    rowPageBreak: "auto",
  });
}

function getNoiseModalOptions() {
  const includeEl = document.getElementById("pdf-include-noise");
  const selectEl = document.getElementById("pdf-noise-upload-selector");

  const includeNoiseHeatmap = Boolean(includeEl?.checked);
  if (!includeNoiseHeatmap) return { includeNoiseHeatmap: false, noiseUploadId: null };

  const raw = selectEl?.value;
  const noiseUploadId = raw ? String(raw) : null;
  return { includeNoiseHeatmap: true, noiseUploadId };
}

async function populateNoiseUploadsModal(projectNumber) {
  const includeEl = document.getElementById("pdf-include-noise");
  const selectEl = document.getElementById("pdf-noise-upload-selector");
  const hintEl = document.getElementById("pdf-noise-upload-hint");
  if (!includeEl || !selectEl) return;

  // Reset to a safe default before fetching.
  includeEl.checked = false;
  includeEl.disabled = true;
  selectEl.disabled = true;
  selectEl.innerHTML = `<option value="">Latest noise upload</option>`;
  if (hintEl) {
    hintEl.textContent = "Optional: pick a previous noise CSV batch. If empty, the latest batch is used.";
  }

  if (!projectNumber) {
    if (hintEl) hintEl.textContent = "Select a project first to enable the noise heatmap.";
    return;
  }

  try {
    const url = `api/noise-data/uploads?project=${encodeURIComponent(projectNumber)}`;
    const uploadsRes = await fetch(url, { headers: getAuthHeaders() });
    const uploads = await uploadsRes.json();

    if (!Array.isArray(uploads) || uploads.length === 0) {
      if (hintEl) hintEl.textContent = "No noise uploads available for the selected project.";
      return;
    }

    includeEl.disabled = false;

    // If the user checks the box, the existing change listener will enable the dropdown.
    // We keep the dropdown disabled until then.
    selectEl.disabled = !includeEl.checked;

    for (const u of uploads) {
      const uploadedAt = u.uploadedAt ? new Date(u.uploadedAt).toLocaleDateString() : null;
      const label = u.label ? String(u.label) : `Upload ${u.id}`;
      const optionLabel = uploadedAt ? `${label} (${uploadedAt})` : label;
      const opt = document.createElement("option");
      opt.value = String(u.id);
      opt.textContent = optionLabel;
      selectEl.appendChild(opt);
    }
  } catch (err) {
    console.error("populateNoiseUploadsModal failed:", err);
    if (hintEl) hintEl.textContent = "Failed to load noise uploads. Try again.";
  }
}

/**
 * Initialize PDF button
 */
export function initPDFGeneration() {
  const pdfBtn = safeGet("generatePdfBtn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", () => {
      const modalEl = document.getElementById("pdf-events-modal");
      if (!modalEl) {
        // Fallback: if modal markup isn't present, keep existing behavior.
        generatePDFReport({ includeEventsLog: true });
        return;
      }
      openModal("pdf-events-modal");
      // Populate noise upload options (used only if the user checks "Include noise heatmap").
      void populateNoiseUploadsModal(config.activeProjectNumber);
    });
  }

  // Modal wiring (no-ops if elements don't exist on the page).
  const includeBtn = document.getElementById("btn-pdf-events-include");
  const skipBtn = document.getElementById("btn-pdf-events-skip");
  const closeBtn = document.getElementById("btn-pdf-events-close");
  const overlayEl = document.getElementById("pdf-events-modal-overlay");
  const includeNoiseCheckbox = document.getElementById("pdf-include-noise");
  const noiseUploadSelector = document.getElementById("pdf-noise-upload-selector");

  // Avoid double-binding if initPDFGeneration is called more than once.
  if (includeBtn && !includeBtn.dataset.pdfModalWired) {
    includeBtn.dataset.pdfModalWired = "1";
    includeBtn.addEventListener("click", async () => {
      closeModal("pdf-events-modal");
      const { includeNoiseHeatmap, noiseUploadId } = getNoiseModalOptions();
      await generatePDFReport({ includeEventsLog: true, includeNoiseHeatmap, noiseUploadId });
    });
  }

  if (skipBtn && !skipBtn.dataset.pdfModalWired) {
    skipBtn.dataset.pdfModalWired = "1";
    skipBtn.addEventListener("click", async () => {
      closeModal("pdf-events-modal");
      const { includeNoiseHeatmap, noiseUploadId } = getNoiseModalOptions();
      await generatePDFReport({ includeEventsLog: false, includeNoiseHeatmap, noiseUploadId });
    });
  }

  if (includeNoiseCheckbox && noiseUploadSelector && !includeNoiseCheckbox.dataset.pdfNoiseWired) {
    includeNoiseCheckbox.dataset.pdfNoiseWired = "1";
    includeNoiseCheckbox.addEventListener("change", () => {
      noiseUploadSelector.disabled = !includeNoiseCheckbox.checked;
    });
  }

  if (closeBtn && !closeBtn.dataset.pdfCloseWired) {
    closeBtn.dataset.pdfCloseWired = "1";
    closeBtn.addEventListener("click", () => closeModal("pdf-events-modal"));
  }

  if (overlayEl && !overlayEl.dataset.pdfOverlayWired) {
    overlayEl.dataset.pdfOverlayWired = "1";
    overlayEl.addEventListener("click", () => closeModal("pdf-events-modal"));
  }
}

export { generatePDFReport };

/**
 * PDF Report Generator
 * pdf-generator.js (ES module)
 */

import { safeGet } from "./js/ui.js";
import { config } from "./js/state.js";
import { formatAS, eventDistance } from "./js/streamer-utils.js";
import { getAuthHeaders } from "./js/api.js";

// Color map for heatmap
const AGE_COLOR_MAP = {
  never: [200, 200, 200],
  fresh: [34, 197, 94],
  '4plus': [250, 204, 21],
  '7plus': [251, 146, 60],
  '10plus': [239, 68, 68],
  '14plus': [153, 27, 27]
};

async function generatePDFReport() {
  const statusEl = safeGet('pdf-status');
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape');

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
    if (config.deploymentDate) {
      const deployDate = new Date(config.deploymentDate);
      if (!isNaN(deployDate.getTime())) {
        yPos += 6;
        doc.text(`Deployment Date: ${deployDate.toLocaleDateString()}`, 25, yPos);
      }
    }
    yPos += 6;
    doc.text(`Coating Status: ${(config.isCoated === true || config.isCoated === 1) ? 'Yes' : 'No'}`, 25, yPos);

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
            doc.addPage('landscape');
            yPos = 20;
          }
          doc.text(`  ${method}: ${fmtKm(distance)}`, 30, yPos);
          yPos += 6;
        }
      }
    }

    // === ALL HISTORY Heatmap (always included) ===
    doc.addPage('landscape');
    await addHeatmapPage(doc, lastCleaned, 'All History');

    // === FILTERED Heatmap (only if filters are active) ===
    if (filteredLastCleaned && (startDate || endDate)) {
      doc.addPage('landscape');
      const filterLabel = (startDate && endDate) 
        ? `${startDate} to ${endDate}` 
        : startDate 
          ? `From ${startDate}` 
          : `Until ${endDate}`;
      await addHeatmapPage(doc, filteredLastCleaned, `Filtered Period (${filterLabel})`);
    }

    // === All Events ===
    doc.addPage('landscape');
    await addAllEventsSection(doc);

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
  const pageWidth = 297; // Landscape A4
  const pageHeight = 210;
  const leftMargin = 20; // Space for section labels (AS01, AS02, etc.)
  const rightMargin = 35; // Space for EB range labels
  const topMargin = yPos + 5;
  const bottomMargin = 25; // Space for legend

  const availableWidth = pageWidth - leftMargin - rightMargin;
  const availableHeight = pageHeight - topMargin - bottomMargin;

  // Calculate cell dimensions
  // Cables as columns (12 cables), sections as rows (107+ sections)
  const cellWidth = Math.min(availableWidth / numCables, 18);
  const cellHeight = Math.min(availableHeight / totalSections, 1.2);

  const heatmapWidth = cellWidth * numCables;
  const heatmapHeight = cellHeight * totalSections;

  // Center the heatmap horizontally
  const startX = leftMargin + 15; // Space for section labels
  const startY = topMargin + 8; // Space for cable labels

  // Pre-fetch all EB ranges for the sections
  const ebRanges = await Promise.all(
    Array.from({ length: totalSections }, (_, s) => getEBRange(s, s))
  );

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

    // Section number on left (AS01, AS02, etc.) - show every 5 sections
    if (s % 5 === 0 || s === 0 || s === totalSections - 1) {
      const sectionLabel = formatAS(s);
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

      const bucket = ageBucket(days);
      const color = AGE_COLOR_MAP[bucket] || [200, 200, 200];

      doc.setFillColor(color[0], color[1], color[2]);
      doc.rect(startX + c * cellWidth, rowY, cellWidth, cellHeight, 'F');

      doc.setDrawColor(240, 240, 240);
      doc.setLineWidth(0.05);
      doc.rect(startX + c * cellWidth, rowY, cellWidth, cellHeight, 'S');
    }

    // EB label on right side - show every 10 sections
    if (s % 10 === 0 || s === 0 || s === totalSections - 1) {
      const ebLabel = ebRanges[s];
      doc.setFontSize(5);
      doc.setTextColor(80, 80, 80);
      doc.text(ebLabel, startX + heatmapWidth + 3, rowY + cellHeight / 2 + 0.8);
    }
  }

  // Legend at bottom
  yPos = startY + heatmapHeight + 6;
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text('Legend:', leftMargin, yPos);
  yPos += 1;

  const legendItems = [
    { label: 'Never', color: AGE_COLOR_MAP.never },
    { label: '0-3d', color: AGE_COLOR_MAP.fresh },
    { label: '4-6d', color: AGE_COLOR_MAP['4plus'] },
    { label: '7-9d', color: AGE_COLOR_MAP['7plus'] },
    { label: '10-13d', color: AGE_COLOR_MAP['10plus'] },
    { label: '14d+', color: AGE_COLOR_MAP['14plus'] }
  ];

  let xLegend = leftMargin + 18;
  doc.setFontSize(7);
  for (const item of legendItems) {
    doc.setFillColor(item.color[0], item.color[1], item.color[2]);
    doc.rect(xLegend, yPos, 4, 3, 'F');
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.1);
    doc.rect(xLegend, yPos, 4, 3, 'S');
    doc.setTextColor(0, 0, 0);
    doc.text(item.label, xLegend + 5, yPos + 2.5);
    xLegend += 24;
  }
}

/**
 * Helper: Add all events section with EB range column
 */
async function addAllEventsSection(doc) {
  let yPos = 20;

  // Fetch events from API with project filter
  let eventsUrl = 'api/events';
  if (config.activeProjectNumber) {
    eventsUrl += `?project=${encodeURIComponent(config.activeProjectNumber)}`;
  }
  const eventsRes = await fetch(eventsUrl, { headers: getAuthHeaders() });
  const eventsToShow = await eventsRes.json();

  doc.setFontSize(14);
  doc.text(`All Cleaning Events (${eventsToShow.length} total)`, 20, yPos);
  yPos += 8;
  doc.setFontSize(8);

  if (eventsToShow.length === 0) {
    doc.text('No cleaning events recorded.', 25, yPos);
    return;
  }

  // Table headers with EB Range column
  const drawHeaders = (y) => {
    doc.text('Date', 15, y);
    doc.text('Cable', 40, y);
    doc.text('Sections', 55, y);
    doc.text('EB Range', 85, y);
    doc.text('Method', 120, y);
    doc.text('Length', 145, y);
    doc.text('Count', 165, y);
  };

  drawHeaders(yPos);
  yPos += 5;
  doc.line(15, yPos, 175, yPos);
  yPos += 5;

  // Fetch all EB ranges in parallel for performance
  const ebRanges = await Promise.all(
    eventsToShow.map(evt => getEBRange(evt.sectionIndexStart, evt.sectionIndexEnd))
  );

  for (let i = 0; i < eventsToShow.length; i++) {
    const evt = eventsToShow[i];

    if (yPos > 195) {
      doc.addPage('landscape');
      yPos = 20;
      drawHeaders(yPos);
      yPos += 5;
      doc.line(15, yPos, 175, yPos);
      yPos += 5;
    }

    const date = new Date(evt.cleanedAt).toLocaleDateString();
    const streamer = `S${evt.streamerId}`;
    const sections = `${formatAS(evt.sectionIndexStart)} - ${formatAS(evt.sectionIndexEnd)}`;
    const ebRange = ebRanges[i];
    const distance = `${eventDistance(evt)}m`;
    const count = evt.cleaningCount || 1;

    doc.setFontSize(7);
    doc.text(date, 15, yPos);
    doc.text(streamer, 40, yPos);
    doc.text(sections, 55, yPos);
    doc.text(ebRange, 85, yPos);
    doc.text(evt.cleaningMethod, 120, yPos);
    doc.text(distance, 145, yPos);
    doc.text(String(count), 165, yPos);
    yPos += 5;
  }
}

/**
 * Initialize PDF button
 */
export function initPDFGeneration() {
  const pdfBtn = safeGet("generatePdfBtn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", generatePDFReport);
  }
}

export { generatePDFReport };

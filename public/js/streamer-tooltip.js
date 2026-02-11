/**
 * Pure computation for streamer header tooltip (days to first scraping, etc.).
 * Used by the heatmap and testable in isolation.
 *
 * @param {number} streamerId
 * @param {{ deployments: object, lastCleaned: object, streamerEvents: Array<{ cleanedAt: string, streamerId: number }> }} opts
 * @returns {{ daysToFirstScraping: number|null, streamerEvents: Array, lastCleanedDate: string|null, coatingLabel: string, hasDeploymentDate: boolean }}
 */
export function computeStreamerTooltipData(streamerId, { deployments, lastCleaned, streamerEvents }) {
  const deployment = deployments[streamerId] || {};
  const sectionDates = lastCleaned[streamerId] || [];
  const lastCleanedDate = sectionDates.length
    ? sectionDates.reduce((max, d) => (d && (!max || new Date(d) > new Date(max)) ? d : max), null)
    : null;

  let daysToFirstScraping = null;
  if (deployment.deploymentDate && streamerEvents.length > 0) {
    const firstCleaning = [...streamerEvents].sort((a, b) =>
      new Date(a.cleanedAt) - new Date(b.cleanedAt)
    )[0];
    const rawDays = Math.floor(
      (new Date(firstCleaning.cleanedAt) - new Date(deployment.deploymentDate)) / (1000 * 60 * 60 * 24)
    );
    if (rawDays >= 0) daysToFirstScraping = rawDays;
  }

  const coatingLabel = deployment.isCoated === true ? 'Coated' : deployment.isCoated === false ? 'Uncoated' : 'Unknown';

  return {
    daysToFirstScraping,
    streamerEvents,
    lastCleanedDate,
    coatingLabel,
    hasDeploymentDate: !!deployment.deploymentDate,
    deployment,
  };
}

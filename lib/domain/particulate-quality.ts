// Reference: https://www.gov.uk/government/publications/health-effects-of-air-pollution/pollutant-concentrations-for-the-daily-air-quality-index-daqi
// Instantaneous concentration comparison only; never a calculated DAQI or exposure assessment.
export function particulateRating(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0)
    return { label: 'No data', tone: 'neutral' };
  if (value < 36) return { label: 'Low reading', tone: 'green' };
  if (value < 54) return { label: 'Moderate reading', tone: 'amber' };
  if (value < 71) return { label: 'High reading', tone: 'red' };
  return { label: 'Very high reading', tone: 'purple' };
}

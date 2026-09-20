// Latest observations are not 24-hour exposure assessments. References live in the catalogue.
export function particulateRating(value: number | null | undefined) {
  return {
    label:
      value == null || !Number.isFinite(value) || value < 0 ? 'No data' : 'Recent concentration',
    tone: 'neutral',
  };
}

const compass = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];
function normalise(degrees: number) {
  if (!Number.isFinite(degrees)) throw new Error('Invalid bearing');
  return ((degrees % 360) + 360) % 360;
}
export function degreesToCompass(degrees: number): string {
  return compass[Math.round(normalise(degrees) / 22.5) % 16];
}
export function oppositeBearing(degrees: number): number {
  return normalise(degrees + 180);
}

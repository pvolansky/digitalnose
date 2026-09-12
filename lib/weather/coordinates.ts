export function validCoordinates(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}
export function parseCoordinates(latitude: string, longitude: string) {
  if (!latitude.trim() && !longitude.trim()) return { latitude: null, longitude: null };
  if (
    !latitude.trim() ||
    !longitude.trim() ||
    !validCoordinates(Number(latitude), Number(longitude))
  )
    throw new Error(
      'Enter both coordinates: latitude −90 to 90, longitude −180 to 180. Leave both blank to disable weather.',
    );
  return { latitude: Number(latitude), longitude: Number(longitude) };
}

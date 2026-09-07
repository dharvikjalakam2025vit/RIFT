import { buildFloodFeatures, summarizeElevationGrid, normalizeAssetType, riskToScenarioParameters, riskToClass as classFromRisk } from './featureBuilder.js';

export function buildFloodPayload(weather = {}, loc, terrain = null) {
  return buildFloodFeatures(weather, loc, terrain);
}

export function buildCyclonePayload(weather = {}, loc) {
  const kmh = Number(weather.wind_speed_10m_kmh ?? 40);
  return {
    current_wind_kts: Math.max(0, kmh / 1.852),
    pressure_hpa: Number(weather.surface_pressure_hpa ?? 990),
    latitude: loc.lat,
    longitude: loc.lng,
    storm_speed_kts: 10,
    storm_direction_deg: 285,
    rainfall_mm_h: Number(weather.rain_mm ?? weather.precipitation_mm ?? 20),
    distance_to_coast_km: loc.id === 'new-orleans' ? 10 : 65,
  };
}

export function buildEarthquakePayload(event, loc) {
  const [eqLng, eqLat, depth] = event?.geometry?.coordinates || [loc.lng, loc.lat, 15];
  return {
    magnitude: Number(event?.properties?.mag ?? event?.magnitude ?? 5.8),
    depth_km: Number(depth ?? 15),
    distance_to_target_km: haversineKm(loc.lat, loc.lng, Number(eqLat), Number(eqLng)),
    site_amplification: loc.id === 'tokyo' ? 0.72 : 0.52,
    population_density: loc.id === 'tokyo' ? 16000 : 9000,
    soil_factor: 0.62,
  };
}

export function buildInfrastructurePayload(placeType, exposureScore, accessScore = 0.7, place = {}, locationId = '') {
  const type = normalizeAssetType(placeType);
  return {
    hazard_exposure: clamp(exposureScore, 0, 1),
    elevation_m: Number(place?.elevation_m ?? 18),
    asset_age_years: Number(place?.assetAgeYears ?? 24),
    criticality: type === 'hospital' ? 0.95 : type === 'bridge' ? 0.88 : type === 'substation' ? 0.90 : type === 'drainage' ? 0.84 : 0.78,
    accessibility: clamp(accessScore, 0, 1),
    power_availability: type === 'drainage' ? 0.75 : 0.85,
    asset_type: type,
  };
}

export { summarizeElevationGrid, riskToScenarioParameters };
export { normalizeAssetType };

export function riskToClass(score) { return classFromRisk(Number(score) || 0); }
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const d1 = (lat2-lat1) * Math.PI / 180, d2 = (lon2-lon1) * Math.PI / 180;
  const a = Math.sin(d1/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(d2/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

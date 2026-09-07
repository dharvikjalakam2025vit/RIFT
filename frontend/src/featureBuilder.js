const CITY_CONTEXT = {
  mumbai: { drainageCapacity: 0.44, populationDensity: 18000, historicalFlood: 1, floodControl: 0, urban: 1, soilType: 'clay', riverDischarge: 180, waterLevel: 1.2 },
  delhi: { drainageCapacity: 0.52, populationDensity: 12000, historicalFlood: 1, floodControl: 0, urban: 1, soilType: 'clay', riverDischarge: 120, waterLevel: 0.9 },
  bengaluru: { drainageCapacity: 0.48, populationDensity: 9000, historicalFlood: 1, floodControl: 0, urban: 1, soilType: 'loam', riverDischarge: 90, waterLevel: 0.7 },
  'new-york': { drainageCapacity: 0.60, populationDensity: 11000, historicalFlood: 1, floodControl: 1, urban: 1, soilType: 'silt', riverDischarge: 160, waterLevel: 1.1 },
  'new-orleans': { drainageCapacity: 0.28, populationDensity: 7000, historicalFlood: 1, floodControl: 1, urban: 1, soilType: 'silt', riverDischarge: 260, waterLevel: 1.7 },
  tokyo: { drainageCapacity: 0.68, populationDensity: 16000, historicalFlood: 0, floodControl: 1, urban: 1, soilType: 'clay', riverDischarge: 140, waterLevel: 0.8 },
  guangzhou: { drainageCapacity: 0.42, populationDensity: 12000, historicalFlood: 1, floodControl: 1, urban: 1, soilType: 'silt', riverDischarge: 220, waterLevel: 1.3 },
  shenzhen: { drainageCapacity: 0.46, populationDensity: 10000, historicalFlood: 1, floodControl: 1, urban: 1, soilType: 'loam', riverDischarge: 190, waterLevel: 1.1 },
  nepal: { drainageCapacity: 0.32, populationDensity: 2800, historicalFlood: 1, floodControl: 0, urban: 0, soilType: 'loam', riverDischarge: 140, waterLevel: 0.8 },
};

export function summarizeElevationGrid(elevations = [], rows = 18, columns = 18) {
  const values = Array.from(elevations, Number).filter(Number.isFinite);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let maxGradient = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const i = r * columns + c;
      const right = c + 1 < columns ? elevations[i + 1] : elevations[i];
      const down = r + 1 < rows ? elevations[i + columns] : elevations[i];
      const gx = Math.abs(Number(right) - Number(elevations[i]));
      const gy = Math.abs(Number(down) - Number(elevations[i]));
      maxGradient = Math.max(maxGradient, Math.hypot(gx, gy));
    }
  }
  const slopeDeg = Math.min(45, Math.max(0, Math.atan(maxGradient / 100) * 180 / Math.PI));
  return { minElevationM: min, maxElevationM: max, meanElevationM: mean, slopeDeg };
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function buildFloodFeatures(weather = {}, location, terrain = null) {
  const ctx = CITY_CONTEXT[location?.id] || CITY_CONTEXT.mumbai;
  const rain = Math.max(0, safeNumber(weather.rain_mm ?? weather.precipitation_mm, 12));
  const precipitation = Math.max(0, safeNumber(weather.precipitation_mm, rain));
  const elevation = safeNumber(terrain?.meanElevationM ?? weather.elevation_m, 20);
  const slope = safeNumber(terrain?.slopeDeg, location?.id === 'nepal' ? 14 : 2);
  return {
    rainfall_mm: rain,
    cumulative_rainfall_mm: Math.max(rain, rain * 4 + precipitation),
    elevation_m: elevation,
    slope_deg: slope,
    drainage_capacity: ctx.drainageCapacity,
    river_discharge_m3s: ctx.riverDischarge,
    water_level_m: ctx.waterLevel,
    population_density: ctx.populationDensity,
    historical_flood: ctx.historicalFlood,
    flood_control_infrastructure: ctx.floodControl,
    urban: ctx.urban,
    soil_type: ctx.soilType,
  };
}

export function riskToScenarioParameters(score) {
  const risk = Math.min(1, Math.max(0, safeNumber(score, 0)));
  return {
    risk,
    scenarioIntensity: risk,
    runoffMultiplier: 1 + risk * 0.65,
  };
}

export function buildInfrastructureFeatures(place, waterDepth = 0, accessScore = 0.85, locationId = '') {
  const type = normalizeAssetType(place?.type);
  const criticality = type === 'hospital' ? 0.95 : type === 'bridge' ? 0.88 : type === 'substation' ? 0.90 : type === 'drainage' ? 0.84 : 0.78;
  const elevation = safeNumber(place?.elevation_m, 18);
  return {
    hazard_exposure: Math.min(1, Math.max(0, safeNumber(waterDepth) / 1.5)),
    elevation_m: elevation,
    asset_age_years: safeNumber(place?.assetAgeYears, 24),
    criticality,
    accessibility: Math.min(1, Math.max(0, safeNumber(accessScore, 0.85))),
    power_availability: type === 'drainage' ? 0.75 : 0.85,
    asset_type: type,
    location_id: locationId,
  };
}

export function normalizeAssetType(type = '') {
  const s = String(type).toLowerCase();
  if (s.includes('hospital')) return 'hospital';
  if (s.includes('fire')) return 'fire_station';
  if (s.includes('bridge')) return 'bridge';
  if (s.includes('substation')) return 'substation';
  if (s.includes('shelter')) return 'shelter';
  return 'drainage';
}

export function riskToClass(score) {
  if (score >= 0.85) return 'CRITICAL';
  if (score >= 0.70) return 'HIGH';
  if (score >= 0.50) return 'MODERATE';
  return 'LOW';
}

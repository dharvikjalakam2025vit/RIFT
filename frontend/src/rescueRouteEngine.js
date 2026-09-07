const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MIN_REQUEST_GAP_MS = 1200;
export const ROUTE_RISK_CONFIG = {
  flood: { moderate: 0.10, high: 0.25, blocked: 0.50 },
  rain: { moderate: 10, high: 25 },
  weights: { time: 0.45, risk: 0.30, flood: 0.25 },
  multipliers: { floodModerate: 1.25, floodHigh: 2, rainModerate: 1.10, rainHigh: 1.25, riskyRoad: 1.75, cautionRoad: 1.15, infraModerate: 1.10, infraHigh: 1.30 },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function haversineKm(a, b) {
  const R = 6371;
  const p1 = Number(a.lat ?? a[1]) * Math.PI / 180;
  const p2 = Number(b.lat ?? b[1]) * Math.PI / 180;
  const dLat = (Number(b.lat ?? b[1]) - Number(a.lat ?? a[1])) * Math.PI / 180;
  const dLng = (Number(b.lng ?? b[0]) - Number(a.lng ?? a[0])) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function toPoint(coord) {
  return { lng: Number(coord[0]), lat: Number(coord[1]) };
}

function routeKey(origin, destination) {
  return [
    Number(origin.lat).toFixed(5), Number(origin.lng).toFixed(5),
    Number(destination.lat).toFixed(5), Number(destination.lng).toFixed(5),
  ].join('|');
}

export class RescueRouteEngine {
  constructor({ routeProvider, cacheTtlMs = DEFAULT_CACHE_TTL_MS, minRequestGapMs = DEFAULT_MIN_REQUEST_GAP_MS } = {}) {
    this.routeProvider = routeProvider;
    this.cacheTtlMs = cacheTtlMs;
    this.minRequestGapMs = minRequestGapMs;
    this.cache = new Map();
    this.lastRequestAt = 0;
    this.inFlight = new Map();
    this.requestChain = Promise.resolve();
  }

  _cached(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() - item.createdAt > this.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  async _request(origin, destination) {
    const key = routeKey(origin, destination);
    const cached = this._cached(key);
    if (cached) return { ...cached, cached: true };

    if (this.inFlight.has(key)) return this.inFlight.get(key);

    const work = this.requestChain = this.requestChain.then(async () => {
      const wait = this.minRequestGapMs - (Date.now() - this.lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
      const result = await this.routeProvider({ origin, destination });
      const value = { ...result, cached: false };
      this.cache.set(key, { createdAt: Date.now(), value });
      return value;
    });

    this.inFlight.set(key, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(key);
    }
  }

  _measureRoute(geometry = [], impact = {}) {
    const depthAt = impact?.getWaterAt ? (lat, lng) => Number(impact.getWaterAt(lat, lng) || 0) : () => 0;
    const rainfall = Number(impact?.rainfallMm || 0);
    const roadConditionAt = impact?.getRoadCondition ? impact.getRoadCondition : () => 'OPEN';
    const infrastructureRiskAt = impact?.getInfrastructureRisk ? impact.getInfrastructureRisk : () => 0;
    const forcedBlockIndex = Number.isFinite(impact?.forcedBlockIndex) ? impact.forcedBlockIndex : -1;
    const blockedSegments = [];
    const riskySegments = [];
    let totalKm = 0;
    let weightedRisk = 0;
    let floodExposure = 0;
    let weightedCost = 0;
    let weightedKm = 0;

    for (let i = 0; i < geometry.length - 1; i += 1) {
      const a = toPoint(geometry[i]);
      const b = toPoint(geometry[i + 1]);
      const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
      const depth = Math.max(depthAt(a.lat, a.lng), depthAt(mid.lat, mid.lng), depthAt(b.lat, b.lng));
      const km = haversineKm(a, b);
      const roadCondition = String(roadConditionAt(mid.lat, mid.lng) || 'OPEN').toUpperCase();
      const infrastructureRisk = clamp(Number(infrastructureRiskAt(mid.lat, mid.lng) || 0), 0, 1);
      const floodMultiplier = depth >= ROUTE_RISK_CONFIG.flood.blocked ? Infinity : depth >= ROUTE_RISK_CONFIG.flood.high ? ROUTE_RISK_CONFIG.multipliers.floodHigh : depth >= ROUTE_RISK_CONFIG.flood.moderate ? ROUTE_RISK_CONFIG.multipliers.floodModerate : 1;
      const rainMultiplier = rainfall >= ROUTE_RISK_CONFIG.rain.high ? ROUTE_RISK_CONFIG.multipliers.rainHigh : rainfall >= ROUTE_RISK_CONFIG.rain.moderate ? ROUTE_RISK_CONFIG.multipliers.rainModerate : 1;
      const roadMultiplier = roadCondition === 'BLOCKED' ? Infinity : roadCondition === 'RISKY' ? ROUTE_RISK_CONFIG.multipliers.riskyRoad : roadCondition === 'CAUTION' ? ROUTE_RISK_CONFIG.multipliers.cautionRoad : 1;
      const infraMultiplier = infrastructureRisk >= 0.7 ? ROUTE_RISK_CONFIG.multipliers.infraHigh : infrastructureRisk >= 0.35 ? ROUTE_RISK_CONFIG.multipliers.infraModerate : 1;
      totalKm += km;
      weightedRisk += clamp(depth / 0.6, 0, 1) * km;
      floodExposure += clamp(depth / ROUTE_RISK_CONFIG.flood.blocked, 0, 1) * km;
      weightedCost += km * (floodMultiplier * rainMultiplier * roadMultiplier * infraMultiplier);
      weightedKm += km;
      const forcedBlocked = forcedBlockIndex === i;
      if (forcedBlocked || depth >= ROUTE_RISK_CONFIG.flood.blocked || roadCondition === 'BLOCKED') {
        blockedSegments.push({ index: i, depth: Number(depth.toFixed(3)), distanceKm: Number(km.toFixed(3)), reason: forcedBlocked ? 'DEMO SIMULATION BLOCK' : roadCondition === 'BLOCKED' ? 'SIMULATED ROAD IMPACT' : 'SIMULATED FLOOD RISK' });
      } else if (depth >= ROUTE_RISK_CONFIG.flood.moderate || roadCondition === 'RISKY' || infrastructureRisk >= 0.35) {
        riskySegments.push({ index: i, depth: Number(depth.toFixed(3)), distanceKm: Number(km.toFixed(3)), condition: roadCondition });
      }
    }

    return {
      blockedSegments,
      riskySegments,
      blocked: blockedSegments.length > 0,
      distanceKm: totalKm,
      risk: weightedKm ? clamp(weightedRisk / weightedKm, 0, 1) : 0,
      floodExposure: weightedKm ? clamp(floodExposure / weightedKm, 0, 1) : 0,
      optimizedCost: weightedCost,
    };
  }

  _candidateRoutes(providerResult) {
    const routes = [];
    if (providerResult?.geometry?.length >= 2) routes.push({ geometry: providerResult.geometry, distance_m: providerResult.distance_m, duration_s: providerResult.duration_s, source: providerResult.source || 'OSRM' });
    for (const alt of providerResult?.alternatives || []) {
      if (alt.geometry?.length >= 2) routes.push({ geometry: alt.geometry, distance_m: alt.distance_m, duration_s: alt.duration_s, source: 'OSRM alternative' });
    }
    return routes;
  }

  async _detourCandidates(origin, destination, blockedGeometry = []) {
    if (!blockedGeometry.length) return [];
    const pivot = toPoint(blockedGeometry[Math.floor(blockedGeometry.length / 2)]);
    const offsets = [
      { lat: 0.008, lng: 0.010 },
      { lat: -0.008, lng: 0.010 },
      { lat: 0.010, lng: -0.010 },
      { lat: -0.010, lng: -0.010 },
    ];
    const candidates = [];
    for (const offset of offsets.slice(0, 2)) {
      const waypoint = { lat: pivot.lat + offset.lat, lng: pivot.lng + offset.lng };
      try {
        const [first, second] = await Promise.all([
          this._request(origin, waypoint),
          this._request(waypoint, destination),
        ]);
        if (!first?.geometry?.length || !second?.geometry?.length) continue;
        const geometry = first.geometry.slice(0, -1).concat(second.geometry);
        candidates.push({
          geometry,
          distance_m: Number(first.distance_m || 0) + Number(second.distance_m || 0),
          duration_s: Number(first.duration_s || 0) + Number(second.duration_s || 0),
          source: 'OSRM waypoint detour',
        });
      } catch (_) {
        // Keep trying the other offset. Public routing can be intermittent.
      }
    }
    return candidates;
  }

  _simulatedFallback(origin, destination) {
    const points = [];
    const steps = 28;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      points.push([origin.lng + (destination.lng - origin.lng) * t, origin.lat + (destination.lat - origin.lat) * t]);
    }
    return {
      geometry: points,
      distance_m: haversineKm(origin, destination) * 1000,
      duration_s: Math.max(180, haversineKm(origin, destination) * 1000 / 10),
      source: 'RIFT simulated fallback route',
      warning: 'Routing unavailable. This route is a simulation fallback and does not represent the actual road network.',
    };
  }

  async calculate({ origin, destination, roadImpact = {}, mode = 'FASTEST SAFE' } = {}) {
    const impact = roadImpact || {};
    let providerResult = null;
    let providerUnavailable = false;
    try {
      providerResult = await this._request(origin, destination);
    } catch (_) {
      providerUnavailable = true;
    }

    let candidates = this._candidateRoutes(providerResult);
    let measured = candidates.map((route) => ({ route, assessment: this._measureRoute(route.geometry, impact) }));
    let selected = measured.find((item) => !item.assessment.blocked);

    if (!selected && measured[0]) {
      const blockedGeometry = measured[0].route.geometry;
      const detours = await this._detourCandidates(origin, destination, blockedGeometry);
      const detourMeasured = detours.map((route) => ({ route, assessment: this._measureRoute(route.geometry, impact) }));
      measured = measured.concat(detourMeasured);
      selected = detourMeasured.find((item) => !item.assessment.blocked) || null;
    }

    if (!selected) {
      const fallback = this._simulatedFallback(origin, destination);
      let fallbackAssessment = this._measureRoute(fallback.geometry, impact);
      if (fallbackAssessment.blocked) {
        const pivot = toPoint(fallback.geometry[Math.floor(fallback.geometry.length / 2)]);
        const alternatives = [
          { lat: pivot.lat + 0.012, lng: pivot.lng + 0.012 },
          { lat: pivot.lat - 0.012, lng: pivot.lng + 0.012 },
          { lat: pivot.lat + 0.012, lng: pivot.lng - 0.012 },
        ];
        for (const waypoint of alternatives) {
          const detourGeometry = [[origin.lng, origin.lat], [waypoint.lng, waypoint.lat], [destination.lng, destination.lat]];
          const assessment = this._measureRoute(detourGeometry, impact);
          if (!assessment.blocked) {
            fallback.geometry = detourGeometry;
            fallbackAssessment = assessment;
            break;
          }
        }
      }
      selected = { route: fallback, assessment: fallbackAssessment };
      providerUnavailable = true;
    }

    const durationBase = Number(selected.route.duration_s || 0);
    const riskWeight = mode === 'LOWEST RISK' ? 0.55 : mode === 'BALANCED' ? 0.30 : ROUTE_RISK_CONFIG.weights.risk;
    const timeWeight = mode === 'LOWEST RISK' ? 0.20 : mode === 'BALANCED' ? 0.45 : ROUTE_RISK_CONFIG.weights.time;
    const speedPenalty = 1 + selected.assessment.risk * (0.45 + riskWeight);
    const travelTime = Math.max(1, durationBase * speedPenalty || (selected.assessment.distanceKm * 1000 / 12) * speedPenalty);
    const safetyScore = Math.round(clamp(1 - selected.assessment.risk, 0, 1) * 100);
    return {
      route: selected.route.geometry,
      distance: selected.assessment.distanceKm * 1000,
      travelTime,
      risk: selected.assessment.risk,
      blockedSegments: selected.assessment.blockedSegments,
      riskySegments: selected.assessment.riskySegments,
      floodExposure: selected.assessment.floodExposure,
      safetyScore,
      baseTravelTime: durationBase,
      routeMode: providerUnavailable ? 'FALLBACK' : selected.assessment.risk > 0.35 ? 'LOW_RISK' : 'OPTIMAL',
      rerouted: measured.length > 1 && selected.route !== measured[0]?.route,
      baseRoute: measured[0]?.route?.geometry || null,
      baseDistance: measured[0]?.route?.distance_m || null,
      baseRisk: measured[0]?.assessment?.risk ?? null,
      source: selected.route.source,
      warning: providerUnavailable ? 'ROUTING UNAVAILABLE — SIMULATED FALLBACK ROUTE' : (selected.route.warning || null),
      cached: Boolean(providerResult?.cached),
      alternativesConsidered: measured.length,
    };
  }

  validate(routeResult, roadImpact = {}) {
    if (!routeResult?.route?.length) return { valid: false, blockedSegments: [] };
    const assessment = this._measureRoute(routeResult.route, roadImpact);
    return { valid: !assessment.blocked, blockedSegments: assessment.blockedSegments, riskySegments: assessment.riskySegments, risk: assessment.risk, floodExposure: assessment.floodExposure };
  }
}

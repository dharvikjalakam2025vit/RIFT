function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function km2PerGridCell(location) {
  const latKm = 0.00765 * 111.0;
  const lngKm = (0.13 / Math.max(Math.cos(location.lat * Math.PI / 180), 0.2)) * 111.0 / 18;
  return Math.max(0.15, Math.abs(latKm * lngKm));
}

export class EvacuationEngine {
  constructor() {
    this.zones = [];
    this.shelters = [];
    this.assignments = [];
  }

  buildZones({ simulation, location, populationDensity = 8000, rows = 18, columns = 18, zoneRows = 3, zoneCols = 3 } = {}) {
    if (!simulation?.grid?.length) {
      this.zones = [];
      return [];
    }
    const zones = [];
    const cellsPerZoneRow = Math.ceil(rows / zoneRows);
    const cellsPerZoneCol = Math.ceil(columns / zoneCols);
    const cellAreaKm2 = km2PerGridCell(location);
    const densities = Math.max(600, Number(populationDensity) || 600);

    for (let zr = 0; zr < zoneRows; zr += 1) {
      for (let zc = 0; zc < zoneCols; zc += 1) {
        const cells = [];
        for (let r = zr * cellsPerZoneRow; r < Math.min(rows, (zr + 1) * cellsPerZoneRow); r += 1) {
          for (let c = zc * cellsPerZoneCol; c < Math.min(columns, (zc + 1) * cellsPerZoneCol); c += 1) {
            const index = r * columns + c;
            if (simulation.grid[index]) cells.push(index);
          }
        }
        if (!cells.length) continue;
        let sumDepth = 0;
        let maxDepth = 0;
        let sumRisk = 0;
        let centerLat = 0;
        let centerLng = 0;
        for (const index of cells) {
          const cell = simulation.grid[index];
          const depth = Number(simulation.waterDepth[index] || 0);
          sumDepth += depth;
          maxDepth = Math.max(maxDepth, depth);
          sumRisk += Number(simulation.riskField[index] || 0);
          centerLat += cell.lat;
          centerLng += cell.lng;
        }
        const avgDepth = sumDepth / cells.length;
        const risk = clamp(sumRisk / cells.length, 0, 1);
        const population = Math.max(0, Math.round(densities * cellAreaKm2 * cells.length));
        const affected = maxDepth >= 0.05;
        const accessibility = clamp(1 - risk * 0.9, 0.12, 1);
        const priority = clamp(risk * 0.72 + (affected ? 0.16 : 0) + Math.min(0.12, population / 1200000), 0, 1);
        zones.push({
          id: `zone-${zr}-${zc}`,
          name: `DISTRICT ${zr * zoneCols + zc + 1}`,
          population,
          risk,
          priority,
          accessibility,
          affected,
          avgDepth,
          maxDepth,
          centroid: { lat: centerLat / cells.length, lng: centerLng / cells.length },
          cells,
          status: affected ? 'AT RISK' : 'MONITOR',
        });
      }
    }
    this.zones = zones.sort((a, b) => b.priority - a.priority);
    return this.zones;
  }

  buildShelters(places = []) {
    const shelterPlaces = places.filter((p) => p.type === 'shelter');
    this.shelters = shelterPlaces.map((place, index) => {
      const capacity = Math.round(1200 + ((index + 1) % 3) * 600);
      return {
        id: `shelter-${place.id}`,
        name: place.name || `Shelter ${index + 1}`,
        lat: place.lat,
        lng: place.lng,
        capacity,
        occupancy: 0,
        accessibility: 0.85,
        risk: 0.10 + (index % 3) * 0.05,
        status: 'OPEN',
        source: place.source,
      };
    });
    return this.shelters;
  }

  async assignBestShelters({ routeEngine, zones = this.zones, shelters = this.shelters, roadImpact = {} } = {}) {
    this.assignments = [];
    if (!routeEngine || !zones.length || !shelters.length) return this.assignments;
    const candidates = zones.filter((zone) => zone.affected).slice(0, 3);
    const shelterCandidates = shelters.slice(0, 2);

    for (const zone of candidates) {
      let best = null;
      for (const shelter of shelterCandidates) {
        const remaining = Math.max(0, shelter.capacity - shelter.occupancy);
        if (remaining <= 0) continue;
        try {
          const route = await routeEngine.calculate({
            origin: zone.centroid,
            destination: { lat: shelter.lat, lng: shelter.lng },
            roadImpact,
          });
          if (route.blockedSegments.length) continue;
          const safety = 1 - route.risk;
          const capacityFit = Math.min(1, remaining / Math.max(1, zone.population));
          const score = safety * 0.45 + clamp(zone.accessibility, 0, 1) * 0.15 + capacityFit * 0.20 + (1 - shelter.risk) * 0.20;
          const candidate = { zoneId: zone.id, shelterId: shelter.id, shelter, route, score, evacuated: 0 };
          if (!best || candidate.score > best.score) best = candidate;
        } catch (_) {
          // Try the next shelter.
        }
      }
      if (best) {
        const evacuated = Math.min(zone.population, Math.max(0, best.shelter.capacity - best.shelter.occupancy));
        best.evacuated = evacuated;
        best.shelter.occupancy += evacuated;
        zone.status = 'EVACUATING';
        this.assignments.push(best);
      } else {
        zone.status = 'UNREACHABLE';
      }
    }

    return this.assignments;
  }

  getMetrics() {
    const affected = this.zones.filter((z) => z.affected);
    const populationAtRisk = affected.reduce((sum, z) => sum + z.population, 0);
    const populationEvacuated = this.assignments.reduce((sum, a) => sum + a.evacuated, 0);
    const unreachableZones = this.zones.filter((z) => z.status === 'UNREACHABLE').length;
    const availableShelters = this.shelters.filter((s) => s.status === 'OPEN' && s.capacity > s.occupancy).length;
    return { populationAtRisk, populationEvacuated, availableShelters, unreachableZones };
  }
}

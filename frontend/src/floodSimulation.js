export const FLOOD_CONFIG = {
  columns: 18,
  rows: 18,
  halfSizeDegrees: 0.065,
  roadDegradedDepth: 0.15,
  roadBlockedDepth: 0.40,
  infraAtRiskDepth: 0.18,
  infraDegradedDepth: 0.35,
  infraFailedDepth: 0.60,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class FloodSimulation {
  constructor(config = {}) {
    this.config = { ...FLOOD_CONFIG, ...config };
    this.reset();
  }

  initialize({ location, elevations, rainfallMm = 10, risk = 0.6, drainageCapacity = 0.45, runoffMultiplier = 1 }) {
    const { columns, rows, halfSizeDegrees } = this.config;
    if (!Array.isArray(elevations) || elevations.length !== columns * rows) {
      throw new Error(`FloodSimulation expected ${columns * rows} elevation values.`);
    }

    this.location = location;
    this.rainfallMm = Math.max(0, Number(rainfallMm) || 0);
    this.risk = clamp(Number(risk) || 0, 0, 1);
    this.drainageCapacity = clamp(Number(drainageCapacity) || 0, 0, 1);
    this.runoffMultiplier = clamp(Number(runoffMultiplier) || 1, 0.5, 2.5);
    this.minElevation = Math.min(...elevations);
    this.maxElevation = Math.max(...elevations);
    this.elevations = Float32Array.from(elevations);
    this.waterDepth = new Float32Array(columns * rows);
    this.riskField = new Float32Array(columns * rows);
    this.flooded = new Uint8Array(columns * rows);
    this.time = -120;
    this.status = 'READY';
    this.grid = [];
    this.gridMeta = null;

    const latSpan = halfSizeDegrees * 2;
    const lngSpan = halfSizeDegrees * 2 / Math.max(Math.cos(location.lat * Math.PI / 180), 0.2);
    this.gridMeta = { latMin: location.lat - halfSizeDegrees, latMax: location.lat + halfSizeDegrees, lngMin: location.lng - lngSpan / 2, lngMax: location.lng + lngSpan / 2, latSpan, lngSpan };
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const i = row * columns + col;
        const lat = location.lat - halfSizeDegrees + (row / (rows - 1)) * latSpan;
        const lng = location.lng - lngSpan / 2 + (col / (columns - 1)) * lngSpan;
        this.grid.push({ lat, lng, row, col, index: i });
      }
    }
    this._recompute();
  }

  setTime(time) {
    this.time = clamp(Number(time), -120, 60);
    this._recompute();
  }

  update(deltaSeconds) {
    if (this.status !== 'RUNNING') return;
    this.time = clamp(this.time + Number(deltaSeconds) * 30, -120, 60);
    if (this.time >= 60) this.status = 'COMPLETE';
    this._recompute();
  }

  start() {
    if (this.status === 'COMPLETE') return;
    this.status = 'RUNNING';
  }

  pause() {
    if (this.status === 'RUNNING') this.status = 'PAUSED';
  }

  reset() {
    this.location = null;
    this.elevations = new Float32Array();
    this.waterDepth = new Float32Array();
    this.riskField = new Float32Array();
    this.flooded = new Uint8Array();
    this.grid = [];
    this.gridMeta = null;
    this.time = -120;
    this.status = 'IDLE';
    this.minElevation = 0;
    this.maxElevation = 0;
    this.rainfallMm = 0;
    this.risk = 0;
    this.drainageCapacity = 0.45;
    this.runoffMultiplier = 1;
  }

  getSnapshot() {
    return {
      time: this.time,
      status: this.status,
      cells: this.grid.map((cell, i) => ({
        ...cell,
        elevation: this.elevations[i],
        waterDepth: this.waterDepth[i],
        risk: this.riskField[i],
        flooded: Boolean(this.flooded[i]),
      })),
      metrics: this.getMetrics(),
    };
  }

  getMetrics() {
    let affected = 0;
    let totalDepth = 0;
    let maxWaterDepth = 0;
    let floodedCells = 0;
    for (let i = 0; i < this.waterDepth.length; i += 1) {
      const depth = this.waterDepth[i];
      if (depth >= 0.05) { affected += 1; totalDepth += depth; }
      if (depth > maxWaterDepth) maxWaterDepth = depth;
      floodedCells += this.flooded[i];
    }
    return {
      affectedCells: affected,
      affectedPercent: this.waterDepth.length ? (affected / this.waterDepth.length) * 100 : 0,
      averageWaterDepth: affected ? totalDepth / affected : 0,
      maxWaterDepth,
      floodedCells,
    };
  }

  getWaterAt(lat, lng) {
    if (!this.gridMeta || !this.grid.length) return 0;
    const { latMin, lngMin, latSpan, lngSpan } = this.gridMeta;
    const row = Math.round(((Number(lat) - latMin) / latSpan) * (this.config.rows - 1));
    const col = Math.round(((Number(lng) - lngMin) / lngSpan) * (this.config.columns - 1));
    const safeRow = Math.max(0, Math.min(this.config.rows - 1, row));
    const safeCol = Math.max(0, Math.min(this.config.columns - 1, col));
    return this.waterDepth[safeRow * this.config.columns + safeCol] || 0;
  }

  getGeoJSON() {
    const features = [];
    for (const cell of this.grid) {
      const depth = this.waterDepth[cell.index];
      if (depth < 0.03) continue;
      const halfLat = this.config.halfSizeDegrees / (this.config.rows - 1) / 2;
      const lngSpan = this.config.halfSizeDegrees * 2 / Math.max(Math.cos(this.location.lat * Math.PI / 180), 0.2);
      const halfLng = lngSpan / (this.config.columns - 1) / 2;
      features.push({
        type: 'Feature',
        properties: {
          depth,
          risk: this.riskField[cell.index],
          intensity: depth >= 1.0 ? 'critical' : depth >= 0.5 ? 'deep' : depth >= 0.2 ? 'moderate' : 'shallow',
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [cell.lng - halfLng, cell.lat - halfLat],
            [cell.lng + halfLng, cell.lat - halfLat],
            [cell.lng + halfLng, cell.lat + halfLat],
            [cell.lng - halfLng, cell.lat + halfLat],
            [cell.lng - halfLng, cell.lat - halfLat],
          ]],
        },
      });
    }
    return {
      type: 'FeatureCollection',
      features,
    };
  }

  _recompute() {
    if (!this.grid.length) return;
    const progress = clamp((this.time + 120) / 180, 0, 1);
    const rainNorm = clamp(this.rainfallMm / 40, 0, 1);
    const terrainRange = Math.max(0.5, this.maxElevation - this.minElevation);

    // Deterministic prototype waterline. It uses real DEM elevations and the ML risk
    // to modulate scenario severity, while remaining explicitly a simulation model.
    const drainageFactor = 0.35 + (1 - this.drainageCapacity) * 0.9;
    const riseMeters = (0.22 + this.risk * 0.9 + rainNorm * 0.8) * this.runoffMultiplier * progress * drainageFactor;
    const waterline = this.minElevation + Math.max(0.05, terrainRange * 0.18 * progress + riseMeters);

    for (let i = 0; i < this.elevations.length; i += 1) {
      const baseDepth = Math.max(0, waterline - this.elevations[i]);
      const lowlandBoost = clamp((this.maxElevation - this.elevations[i]) / terrainRange, 0, 1) ** 2;
      const depth = Math.max(0, baseDepth + lowlandBoost * 0.08 * progress);
      this.waterDepth[i] = depth;
      this.riskField[i] = clamp(depth / Math.max(0.9, riseMeters + 0.25) * 0.75 + this.risk * 0.25, 0, 1);
      this.flooded[i] = depth >= 0.05 ? 1 : 0;
    }

    // A deterministic 2-pass neighborhood smoothing gives a more continuous spread,
    // especially across a coarse grid, without simulating individual water particles.
    for (let pass = 0; pass < 2; pass += 1) {
      const next = new Float32Array(this.waterDepth);
      for (let row = 0; row < this.config.rows; row += 1) {
        for (let col = 0; col < this.config.columns; col += 1) {
          const i = row * this.config.columns + col;
          let sum = this.waterDepth[i];
          let count = 1;
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nr = row + dr;
            const nc = col + dc;
            if (nr < 0 || nr >= this.config.rows || nc < 0 || nc >= this.config.columns) continue;
            sum += this.waterDepth[nr * this.config.columns + nc];
            count += 1;
          }
          next[i] = this.waterDepth[i] * 0.65 + (sum / count) * 0.35;
        }
      }
      this.waterDepth = next;
      for (let i = 0; i < this.waterDepth.length; i += 1) {
        this.flooded[i] = this.waterDepth[i] >= 0.05 ? 1 : 0;
      }
    }
  }
}

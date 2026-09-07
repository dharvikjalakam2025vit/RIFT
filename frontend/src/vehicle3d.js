import { Marker } from '@maptiler/sdk';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const p1 = a[1] * Math.PI / 180;
  const p2 = b[1] * Math.PI / 180;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function headingDeg(a, b) {
  return Math.atan2((b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI;
}

export class EmergencyVehicle {
  constructor(map, { type = 'ambulance', id = 'AMBULANCE 01' } = {}) {
    this.map = map;
    this.type = type;
    this.id = id;
    this.marker = null;
    this.raf = null;
    this.route = [];
    this.segmentLengths = [];
    this.segmentProgress = [];
    this.active = false;
    this.speedScale = 1;
    this.startTime = 0;
    this.totalDurationMs = 18000;
    this.conditionAt = null;
    this.segmentTimeWeights = [];
    this.totalWeight = 0;
    this.onUpdate = null;
    this.onArrive = null;
  }

  _element() {
    const button = document.createElement('div');
    button.className = `rift-vehicle ${this.type}`;
    button.setAttribute('aria-label', `${this.type} ${this.id}`);
    const inner = document.createElement('div');
    inner.className = 'rift-vehicle-inner';
    inner.innerHTML = '<span class="vehicle-beacon"></span><span class="vehicle-cabin"></span><span class="vehicle-body"></span><span class="vehicle-wheel w1"></span><span class="vehicle-wheel w2"></span><span class="vehicle-wheel w3"></span><span class="vehicle-wheel w4"></span>';
    button.appendChild(inner);
    return button;
  }

  _ensureMarker(point) {
    if (this.marker || !this.map) return;
    this.marker = new Marker({ element: this._element(), anchor: 'center' })
      .setLngLat(point)
      .addTo(this.map);
  }

  setRoute(geometry = [], { speedScale = 1, durationMs = 18000, conditionAt = null } = {}) {
    this.stop();
    this.route = geometry.map((point) => [Number(point[0]), Number(point[1])]).filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
    this.segmentLengths = [];
    this.conditionAt = conditionAt;
    this.segmentTimeWeights = [];
    this.totalWeight = 0;
    for (let i = 0; i < this.route.length - 1; i += 1) {
      const a = this.route[i];
      const b = this.route[i + 1];
      const length = haversineMeters(a, b);
      this.segmentLengths.push(length);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const condition = this.conditionAt ? Math.max(0, Math.min(1, Number(this.conditionAt(mid[1], mid[0])) || 0)) : 0;
      const roadFactor = Math.max(0.35, 1 - condition * 0.60);
      const weight = length / roadFactor;
      this.segmentTimeWeights.push(weight);
      this.totalWeight += weight;
    }
    this.segmentProgress = [];
    const total = this.totalWeight || 1;
    let sum = 0;
    for (const weight of this.segmentTimeWeights) {
      sum += weight;
      this.segmentProgress.push(sum / total);
    }
    this.speedScale = Math.max(0.35, speedScale);
    this.totalDurationMs = Math.max(6000, durationMs / this.speedScale);
    if (this.route.length) this._ensureMarker(this.route[0]);
    if (this.marker) this.marker.setLngLat(this.route[0]);
    return this;
  }

  start() {
    if (this.route.length < 2 || !this.marker) return;
    this.active = true;
    this.startTime = performance.now();
    cancelAnimationFrame(this.raf);
    const tick = (now) => {
      if (!this.active) return;
      const t = Math.min(1, (now - this.startTime) / this.totalDurationMs);
      let index = this.segmentProgress.findIndex((p) => t <= p);
      if (index < 0) index = this.route.length - 2;
      const prevProgress = index === 0 ? 0 : this.segmentProgress[index - 1];
      const segT = (t - prevProgress) / Math.max(1e-6, this.segmentProgress[index] - prevProgress);
      const a = this.route[index];
      const b = this.route[index + 1];
      const point = [lerp(a[0], b[0], segT), lerp(a[1], b[1], segT)];
      this.marker.setLngLat(point);
      const heading = headingDeg(a, b);
      const el = this.marker.getElement();
      const inner = el?.querySelector('.rift-vehicle-inner');
      if (inner) inner.style.setProperty('--vehicle-heading', `${heading}deg`);
      this.onUpdate?.({ point, progress: t, segmentIndex: index, position: point });
      if (t >= 1) {
        this.active = false;
        this.onArrive?.();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  remove() {
    this.stop();
    this.marker?.remove?.();
    this.marker = null;
  }
}

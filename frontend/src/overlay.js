import { Marker } from '@maptiler/sdk';

const SOURCE_PREFIX = 'rift-';
const incidentMarkers = new Map();

export function addMarker(map, _lib, { id, lat, lng, label, color = '#38bdf8', onClick, title } = {}) {
  const markerEl = document.createElement('button');
  markerEl.type = 'button';
    markerEl.className = 'rift-map-marker';
  markerEl.style.setProperty('--rift-marker-color', color);
  markerEl.setAttribute('aria-label', title || label || id || 'RIFT marker');
  markerEl.innerHTML = `<span class="rift-map-marker-pulse"></span><span class="rift-map-marker-core"></span><span class="rift-map-marker-label">${escapeHtml(label || id || '')}</span>`;
  markerEl.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick?.(event);
  });

    const marker = new Marker({ element: markerEl, anchor: 'bottom' })
    .setLngLat([lng, lat])
    .addTo(map);

  marker.__riftId = id;
  if (id) incidentMarkers.set(id, marker);
  return marker;
}

export function removeMarker(id) {
  const marker = incidentMarkers.get(id);
  if (marker) marker.remove();
  incidentMarkers.delete(id);
}

export function clearMarkers() {
  for (const marker of incidentMarkers.values()) marker.remove();
  incidentMarkers.clear();
}

export function setCircleOverlay(map, id, center, radiusKm, style = {}) {
  const sourceId = `${SOURCE_PREFIX}${id}-source`;
  const fillId = `${SOURCE_PREFIX}${id}-fill`;
  const lineId = `${SOURCE_PREFIX}${id}-line`;
  removeLayerAndSource(map, fillId, sourceId);
  removeLayerAndSource(map, lineId, sourceId);

  const geojson = circleGeoJSON(center.lat, center.lng, radiusKm, 96);
  map.addSource(sourceId, { type: 'geojson', data: geojson });

  map.addLayer({
    id: fillId,
    type: 'fill',
    source: sourceId,
    paint: {
      'fill-color': style.fillColor || '#2563eb',
      'fill-opacity': style.fillOpacity ?? 0.20,
    },
  });

  map.addLayer({
    id: lineId,
    type: 'line',
    source: sourceId,
    paint: {
      'line-color': style.strokeColor || '#60a5fa',
      'line-width': style.strokeWidth || 2.5,
      'line-opacity': style.lineOpacity ?? 0.9,
      'line-dasharray': style.dasharray || [2, 1],
    },
  });

  return { sourceId, fillId, lineId };
}

export function addPolyline(map, _lib, path, { id = `route-${Date.now()}`, strokeColor = '#22c55e', strokeWidth = 5, dashed = false } = {}) {
  const sourceId = `${SOURCE_PREFIX}${id}-source`;
  const layerId = `${SOURCE_PREFIX}${id}-line`;
  removeLayerAndSource(map, layerId, sourceId);

  map.addSource(sourceId, {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: path.map((p) => [p.lng, p.lat]),
      },
      properties: {},
    },
  });

  map.addLayer({
    id: layerId,
    type: 'line',
    source: sourceId,
    paint: {
      'line-color': strokeColor,
      'line-width': strokeWidth,
      'line-opacity': 0.92,
      ...(dashed ? { 'line-dasharray': [2, 1] } : {}),
    },
  });

  return { sourceId, layerId };
}

export function addPolygon(map, _lib, path, { id = `polygon-${Date.now()}`, fillColor = '#2563eb', strokeColor = '#60a5fa', strokeWidth = 2 } = {}) {
  const sourceId = `${SOURCE_PREFIX}${id}-source`;
  const fillId = `${SOURCE_PREFIX}${id}-fill`;
  const lineId = `${SOURCE_PREFIX}${id}-line`;
  removeLayerAndSource(map, fillId, sourceId);
  removeLayerAndSource(map, lineId, sourceId);

  map.addSource(sourceId, {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [path.map((p) => [p.lng, p.lat])] },
      properties: {},
    },
  });

  map.addLayer({ id: fillId, type: 'fill', source: sourceId, paint: { 'fill-color': fillColor, 'fill-opacity': 0.22 } });
  map.addLayer({ id: lineId, type: 'line', source: sourceId, paint: { 'line-color': strokeColor, 'line-width': strokeWidth, 'line-opacity': 0.9 } });
  return { sourceId, fillId, lineId };
}

export function removeOverlay(map, overlay) {
  if (!map || !overlay) return;
  if (overlay.layerId) safeRemoveLayer(map, overlay.layerId);
  if (overlay.fillId) safeRemoveLayer(map, overlay.fillId);
  if (overlay.lineId) safeRemoveLayer(map, overlay.lineId);
  if (overlay.sourceId) safeRemoveSource(map, overlay.sourceId);
  if (overlay.destinationMarker?.remove) overlay.destinationMarker.remove();
}

export function clearOverlayCollection(map, overlays = []) {
  for (const overlay of overlays) removeOverlay(map, overlay);
}

export function circlePath(lat, lng, radiusKm, segments = 64, altitude = 0) {
  const points = [];
  const earthKm = 6371;
  const latR = lat * Math.PI / 180;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const dLat = (radiusKm / earthKm) * Math.sin(a);
    const dLng = (radiusKm / earthKm) * Math.cos(a) / Math.max(Math.cos(latR), 1e-6);
    points.push({ lat: lat + dLat * 180 / Math.PI, lng: lng + dLng * 180 / Math.PI, altitude });
  }
  return points;
}

export function addRasterishRiskHalo(map, id, center, radiusKm, color = '#38bdf8') {
  return setCircleOverlay(map, id, center, radiusKm, {
    fillColor: color,
    fillOpacity: 0.12,
    strokeColor: color,
    strokeWidth: 2,
  });
}

function circleGeoJSON(lat, lng, radiusKm, segments) {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [circlePath(lat, lng, radiusKm, segments).map((p) => [p.lng, p.lat])] },
    properties: {},
  };
}

function removeLayerAndSource(map, layerId, sourceId) {
  safeRemoveLayer(map, layerId);
  safeRemoveSource(map, sourceId);
}

function safeRemoveLayer(map, id) {
  try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {}
}

function safeRemoveSource(map, id) {
  try { if (map.getSource(id)) map.removeSource(id); } catch (_) {}
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

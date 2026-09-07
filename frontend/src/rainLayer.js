const RAIN_SOURCE = 'rift-rain-source';
const RAIN_LAYER = 'rift-rain-line';

const rainCache = new Map();

export function updateRainLayer(map, location, intensity = 0.5) {
  if (!map || !location) return;
  const cacheKey = `${location.id || 'site'}:${Math.round(intensity * 20)}`;
  const cached = rainCache.get(cacheKey);
  if (cached) {
    const source = map.getSource(RAIN_SOURCE);
    if (!source) {
      map.addSource(RAIN_SOURCE, { type: 'geojson', data: cached });
      map.addLayer({ id: RAIN_LAYER, type: 'line', source: RAIN_SOURCE, paint: { 'line-color': '#dbeafe', 'line-width': 1.5, 'line-opacity': 0.55, 'line-dasharray': [0.3, 1.8] } });
    } else if (source._data !== cached) source.setData(cached);
    source._data = cached;
    return;
  }
  const len = 0.012 + intensity * 0.025;
  const features = [];
  const base = [
    [-1.1, -0.8], [-0.8, -0.2], [-0.5, 0.4], [-0.2, 0.9], [0.1, -0.9], [0.4, -0.3],
    [0.7, 0.3], [1.0, 0.8], [1.3, -0.55], [1.5, 0.45], [-1.4, 0.25], [-1.0, 0.75],
    [0.2, 0.15], [0.9, -0.75], [-0.25, -0.45], [0.5, 0.75],
  ];
  for (const [dx, dy] of base) {
    const lat = location.lat + dy * len;
    const lng = location.lng + dx * len;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[lng, lat + len * 0.4], [lng - len * 0.10, lat - len * 0.4]],
      },
      properties: {},
    });
  }
  const data = { type: 'FeatureCollection', features };
  rainCache.set(cacheKey, data);
  const source = map.getSource(RAIN_SOURCE);
  if (!source) {
    map.addSource(RAIN_SOURCE, { type: 'geojson', data });
    map.addLayer({
      id: RAIN_LAYER,
      type: 'line',
      source: RAIN_SOURCE,
      paint: {
        'line-color': '#dbeafe',
        'line-width': 1.5,
        'line-opacity': 0.55,
        'line-dasharray': [0.3, 1.8],
      },
    });
  } else {
    source.setData(data);
  }
}

export function clearRainLayer(map) {
  if (!map) return;
  try { if (map.getLayer(RAIN_LAYER)) map.removeLayer(RAIN_LAYER); } catch (_) {}
  try { if (map.getSource(RAIN_SOURCE)) map.removeSource(RAIN_SOURCE); } catch (_) {}
}

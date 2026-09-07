const FLOOD_SOURCE = 'rift-flood-source';
const FLOOD_FILL = 'rift-flood-fill';
const FLOOD_OUTLINE = 'rift-flood-outline';
const ROAD_SOURCE = 'rift-affected-road-source';
const ROAD_LINE = 'rift-affected-road-line';

function safeRemove(map, layerId, sourceId) {
  try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch (_) {}
  try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch (_) {}
}

export function updateFloodLayer(map, geojson) {
  if (!map) return;
  const existing = map.getSource(FLOOD_SOURCE);
  if (!existing) {
    map.addSource(FLOOD_SOURCE, { type: 'geojson', data: geojson });
    map.addLayer({
      id: FLOOD_FILL,
      type: 'fill',
      source: FLOOD_SOURCE,
      paint: {
        'fill-color': [
          'step', ['get', 'depth'],
          '#60a5fa', 0.2, '#38bdf8', 0.5, '#2563eb', 1.0, '#1e3a8a',
        ],
        'fill-opacity': 0.54,
      },
    });
    map.addLayer({
      id: FLOOD_OUTLINE,
      type: 'line',
      source: FLOOD_SOURCE,
      paint: {
        'line-color': '#93c5fd',
        'line-width': 0.9,
        'line-opacity': 0.65,
      },
    });
  } else {
    existing.setData(geojson);
  }
}

export function clearFloodLayer(map) {
  if (!map) return;
  for (const layerId of [FLOOD_FILL, FLOOD_OUTLINE, ROAD_LINE]) {
    try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch (_) {}
  }
  for (const sourceId of [FLOOD_SOURCE, ROAD_SOURCE]) {
    try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch (_) {}
  }
}

export function getCandidateRoadFeatures(map) {
  if (!map) return [];
  const style = map.getStyle?.();
  if (!style?.layers) return [];
  const sourceLayers = [...new Set(style.layers
    .map((layer) => layer['source-layer'])
    .filter(Boolean)
    .filter((name) => /road|transport|street|highway/i.test(String(name))))];

  const seen = new Set();
  const features = [];
  for (const sourceLayer of sourceLayers) {
    let queried = [];
    try {
      queried = map.querySourceFeatures(
        style.layers.find((layer) => layer['source-layer'] === sourceLayer)?.source,
        { sourceLayer },
      ) || [];
    } catch (_) {
      continue;
    }
    for (const feature of queried) {
      const geometry = feature?.geometry;
      if (!geometry || (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString')) continue;
      const key = `${feature.id ?? ''}:${sourceLayer}:${JSON.stringify(geometry.coordinates).slice(0, 180)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      features.push(feature);
      if (features.length >= 180) return features;
    }
  }
  return features;
}

function flattenLines(feature) {
  if (feature.geometry.type === 'LineString') return [feature.geometry.coordinates];
  return feature.geometry.coordinates;
}

function sampleLine(coords, maxSamples = 9) {
  if (!coords || coords.length < 2) return [];
  const samples = [];
  const step = Math.max(1, Math.floor(coords.length / maxSamples));
  for (let i = 0; i < coords.length; i += step) {
    samples.push(coords[i]);
  }
  samples.push(coords[coords.length - 1]);
  return samples;
}

export function updateAffectedRoadLayer(map, roadFeatures, floodSimulation) {
  if (!map || !floodSimulation) return { affected: 0, blocked: 0 };
  const features = [];
  let affected = 0;
  let blocked = 0;

  for (const feature of roadFeatures || []) {
    for (const line of flattenLines(feature)) {
      const samples = sampleLine(line);
      let maxDepth = 0;
      for (const coordinate of samples) {
        maxDepth = Math.max(maxDepth, floodSimulation.getWaterAt(coordinate[1], coordinate[0]));
      }
      if (maxDepth < 0.12) continue;
      const status = maxDepth >= 0.40 ? 'BLOCKED' : 'DEGRADED';
      affected += 1;
      if (status === 'BLOCKED') blocked += 1;
      features.push({
        type: 'Feature',
        properties: { maxDepth, status },
        geometry: feature.geometry,
      });
    }
  }

  const geojson = { type: 'FeatureCollection', features };
  const source = map.getSource(ROAD_SOURCE);
  if (!source) {
    map.addSource(ROAD_SOURCE, { type: 'geojson', data: geojson });
    map.addLayer({
      id: ROAD_LINE,
      type: 'line',
      source: ROAD_SOURCE,
      paint: {
        'line-color': [
          'match', ['get', 'status'],
          'BLOCKED', '#ef4444',
          '#f59e0b',
        ],
        'line-width': [
          'match', ['get', 'status'],
          'BLOCKED', 5.5,
          3.5,
        ],
        'line-opacity': 0.92,
      },
    });
  } else {
    source.setData(geojson);
  }
  return { affected, blocked };
}

export function removeAffectedRoadLayer(map) {
  if (!map) return;
  safeRemove(map, ROAD_LINE, ROAD_SOURCE);
}

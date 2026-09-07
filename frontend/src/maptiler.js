import * as maptilersdk from '@maptiler/sdk';
import '@maptiler/sdk/dist/maptiler-sdk.css';

let mapInstance = null;
let buildingLayerId = 'rift-3d-buildings';

const DEFAULT_GLOBAL = { lng: 60, lat: 20 };
const GLOBAL_STYLE = 'hybrid';
const CITY_STYLE = 'streets-v4-dark';

function requireKey() {
  const key = import.meta.env.VITE_MAPTILER_API_KEY;
  if (!key || key === 'YOUR_MAPTILER_API_KEY') {
    throw new Error('MapTiler API key is not configured. Set VITE_MAPTILER_API_KEY in frontend/.env.');
  }
  return key;
}

export function getMap() {
  return mapInstance;
}

export async function searchCity(query) {
  const value = String(query || '').trim();
  if (!value) throw new Error('Enter a city name.');
  maptilersdk.config.apiKey = requireKey();
  const result = await maptilersdk.geocoding.forward(value, {
    limit: 1,
    types: ['municipality', 'locality', 'place', 'address'],
  });
  const feature = result.features?.[0];
  if (!feature?.center) throw new Error(`No city found for "${value}".`);
  const country = feature.context?.find((item) => item.id?.startsWith('country'))?.text || '';
  return {
    id: `search-${feature.id || value.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: feature.text || feature.place_name?.split(',')[0] || value,
    country,
    lat: feature.center[1],
    lng: feature.center[0],
    hazard: 'flood',
    hazardLabel: 'Custom City / Explore',
  };
}

export async function loadMap(container, {
  center = DEFAULT_GLOBAL,
  zoom = 2.25,
  pitch = 38,
  bearing = 18,
  style = 'streets',
  onLoad,
  onMapClick,
  onError,
} = {}) {
  if (mapInstance) return mapInstance;

  const apiKey = requireKey();
  maptilersdk.config.apiKey = apiKey;

  const mapStyle = style === 'satellite'
    ? 'hybrid'
    : style === 'global'
      ? GLOBAL_STYLE
      : CITY_STYLE;

  mapInstance = new maptilersdk.Map({
    container,
    style: mapStyle,
    center: [center.lng, center.lat],
    zoom,
    pitch,
    bearing,
    projection: 'globe',
    terrain: false,
    antialias: false,
    renderWorldCopies: false,
    fadeDuration: 0,
    attributionControl: true,
    navigationControl: false,
    geolocateControl: false,
  });

  mapInstance.on('load', () => {
    if (style !== 'global') ensure3DBuildings(mapInstance);
  });
  if (onMapClick) mapInstance.on('click', onMapClick);

  mapInstance.on('error', (event) => {
    const error = event?.error;
    if (error) onError?.(error);
  });

  return mapInstance;
}

function addSubtleSpaceBackdrop(map) {
  try {
    if (typeof map.setSpace === 'function') {
      map.setSpace({ preset: 'milkyway-bright' });
    }
  } catch (_) {
    // Decorative only.
  }
}

export function ensure3DBuildings(map = mapInstance) {
  if (!map || map.getLayer?.(buildingLayerId)) return;

  const style = map.getStyle?.();
  if (!style?.layers) return;

  const candidate = style.layers.find((layer) => {
    if (!layer['source-layer']) return false;
    const sourceLayer = String(layer['source-layer']).toLowerCase();
    return sourceLayer.includes('building') && layer.source;
  });

  if (!candidate) return;
  const source = candidate.source;
  const sourceLayer = candidate['source-layer'];

  const beforeId = style.layers.find((layer) => layer.type === 'symbol')?.id;

  try {
    map.addLayer({
      id: buildingLayerId,
      type: 'fill-extrusion',
      source,
      'source-layer': sourceLayer,
      minzoom: 12.5,
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
          0, '#263b50',
          12, '#345a73',
          30, '#4f7f96',
          80, '#79b5bd',
          160, '#b4e0dc',
        ],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 8],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.96,
        'fill-extrusion-vertical-gradient': true,
      },
    }, beforeId);

    map.addLayer({
      id: `${buildingLayerId}-edges`,
      type: 'line',
      source,
      'source-layer': sourceLayer,
      minzoom: 12.5,
      paint: {
        'line-color': '#c7f4f0',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12.5, 0.3, 16, 1.15],
        'line-opacity': 0.68,
      },
    });
  } catch (_) {
    // Some styles already include their own 3D buildings.
  }
}

export function flyToLocation(location, { global = false, duration = 2400 } = {}) {
  const map = mapInstance;
  if (!map) return;

  if (global) {
    map.flyTo({
      center: [DEFAULT_GLOBAL.lng, DEFAULT_GLOBAL.lat],
      zoom: 1.2,
      pitch: 0,
      bearing: 0,
      duration,
      essential: true,
    });
    try { map.setProjection({ type: 'globe' }); } catch (_) {}
    return;
  }

  try { map.setProjection({ type: 'mercator' }); } catch (_) {}
  map.flyTo({
    center: [location.lng, location.lat],
    zoom: 14.2,
    pitch: 48,
    bearing: 18,
    duration,
    essential: true,
  });
}

export function setView({ center = DEFAULT_GLOBAL, zoom = 1.2, pitch = 0, bearing = 0 } = {}) {
  mapInstance?.jumpTo({ center: [center.lng, center.lat], zoom, pitch, bearing });
}

export function setMapStyle(mode) {
  if (!mapInstance) return;
  const style = mode === 'satellite'
    ? 'hybrid'
    : mode === 'global'
      ? GLOBAL_STYLE
      : CITY_STYLE;
  mapInstance.setStyle(style);
  mapInstance.once('style.load', () => {
    if (mode !== 'global') ensure3DBuildings(mapInstance);
  });
}

export function setGlobeProjection(enabled) {
  if (!mapInstance) return;
  try {
    mapInstance.setProjection({ type: enabled ? 'globe' : 'mercator' }, { persist: true });
  } catch (_) {}
}

export function destroyMap() {
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
}

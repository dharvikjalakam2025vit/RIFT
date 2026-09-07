import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LOCATIONS } from './locations.js';
import { loadMap, flyToLocation, destroyMap, setMapStyle as applyMapStyle, searchCity } from './maptiler.js';
import { addMarker, addPolyline, clearMarkers, removeOverlay } from './overlay.js';
import { updateFloodLayer, clearFloodLayer, getCandidateRoadFeatures, updateAffectedRoadLayer } from './floodOverlay.js';
import { updateRainLayer, clearRainLayer } from './rainLayer.js';
import { FloodSimulation, FLOOD_CONFIG } from './floodSimulation.js';
import { ml } from './api.js';
import { buildFloodPayload, buildEarthquakePayload, buildCyclonePayload, buildInfrastructurePayload, summarizeElevationGrid, riskToScenarioParameters, riskToClass } from './scenario.js';
import { predictionClient } from './predictionClient.js';
import { RescueRouteEngine } from './rescueRouteEngine.js';
import { EvacuationEngine } from './evacuationEngine.js';
import { EmergencyVehicle } from './vehicle3d.js';

const STATUS = { IDLE: 'IDLE', READY: 'READY', RUNNING: 'RUNNING', PAUSED: 'PAUSED', COMPLETE: 'COMPLETE' };
const TIMELINE = [-120, -90, -60, -30, 0, 30, 60];
const CITY_DRAINAGE = {
  mumbai: 0.44, delhi: 0.52, bengaluru: 0.48, 'new-york': 0.60,
  'new-orleans': 0.28, tokyo: 0.68, guangzhou: 0.42, shenzhen: 0.46, nepal: 0.32,
};
const CITY_POPULATION_DENSITY = {
  mumbai: 18000, delhi: 12000, bengaluru: 9000, 'new-york': 11000,
  'new-orleans': 7000, tokyo: 16000, guangzhou: 12000, shenzhen: 10000, nepal: 2800,
};
const RESET_METRICS = { affectedCells: 0, affectedPercent: 0, averageWaterDepth: 0, maxWaterDepth: 0, floodedCells: 0 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function App() {
  // Refs hold map and simulation handles without forcing a render on every tick.
  const mapHost = useRef(null);
  const mapRef = useRef(null);
  const markerRefs = useRef([]);
  const infrastructureMarkerRefs = useRef(new Map());
  const simRef = useRef(new FloodSimulation());
  const simTimerRef = useRef(null);
  const roadFeaturesRef = useRef([]);
  const roadStatsRef = useRef({ affected: 0, blocked: 0 });
  const routeEngineRef = useRef(new RescueRouteEngine({ routeProvider: mlRouteProvider }));
  const evacuationRef = useRef(new EvacuationEngine());
  const vehicleRef = useRef(null);
  const routeOverlayRef = useRef(null);
  const pointRouteOverlayRefs = useRef([]);
  const routePointMarkerRefs = useRef([]);
  const evacuationOverlayRefs = useRef([]);
  const elevationCacheRef = useRef(new Map());
  const contextCacheRef = useRef(new Map());
  const lastVisualUpdateRef = useRef(0);
  const lastRoadAnalysisRef = useRef(0);
  const lastInfrastructureUpdateRef = useRef(0);
  const lastPointRouteAnalysisRef = useRef(0);
  const lastRouteValidationTimeRef = useRef(-Infinity);
  const activeRouteRef = useRef(null);
  const activeRouteTargetRef = useRef(null);
  const vehiclePositionRef = useRef(null);
  const forcedBlockRef = useRef(-1);
  const evacCalculatedRef = useRef(false);
  const demoRunningRef = useRef(false);
  const demoTokenRef = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const [mapStyleMode, setMapStyleMode] = useState('streets');
  const [selected, setSelected] = useState(LOCATIONS[0]);
  const [mode, setMode] = useState('GLOBAL');
  const [hazard, setHazard] = useState(LOCATIONS[0].hazard);
  const [sim, setSim] = useState({
    status: STATUS.IDLE, time: -120, speed: 1, risk: null, ml: null, weather: null, event: null,
    elevationReady: false, metrics: RESET_METRICS, roadsAffected: 0, roadsBlocked: 0, terrain: null,
    mlSource: 'STANDBY', featureImportance: [], scenarioIntensity: 0, infrastructureSource: 'LIVE / CACHE',
  });
  const [places, setPlaces] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [route, setRoute] = useState(null);
  const [routeStatus, setRouteStatus] = useState('READY');
  const [aiNote, setAiNote] = useState('Select a location. FLOOD SIMULATION is the Review 2 hero workflow.');
  const [evacuation, setEvacuation] = useState({ zones: [], shelters: [], assignments: [], metrics: { populationAtRisk: 0, populationEvacuated: 0, availableShelters: 0, unreachableZones: 0 } });
  const [response, setResponse] = useState({ activeVehicles: 0, activeRoutes: 0, reroutes: 0, evacuated: 0, emergencyAccess: 'STANDBY', rescueStatus: 'READY', vehicle: 'AMBULANCE 01' });
  const [demo, setDemo] = useState(false);
  const [demoStep, setDemoStep] = useState('READY');
  const [routePoints, setRoutePoints] = useState({ origin: null, destination: null });
  const [routeMode, setRouteMode] = useState('FASTEST SAFE');
  const [routeAnalysis, setRouteAnalysis] = useState(null);
  const [cityQuery, setCityQuery] = useState('');
  const [citySearchStatus, setCitySearchStatus] = useState('');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const routeAnalysisRef = useRef(routeAnalysis);
  routeAnalysisRef.current = routeAnalysis;

  const removeRouteOverlays = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (routeOverlayRef.current) removeOverlay(map, routeOverlayRef.current);
    routeOverlayRef.current = null;
  }, []);

  const clearPointRoute = useCallback(() => {
    const map = mapRef.current;
    if (map) pointRouteOverlayRefs.current.forEach((overlay) => removeOverlay(map, overlay));
    pointRouteOverlayRefs.current = [];
    routePointMarkerRefs.current.forEach((marker) => marker?.remove?.());
    routePointMarkerRefs.current = [];
    setRoutePoints({ origin: null, destination: null });
    setRouteAnalysis(null);
  }, []);

  const handleMapClick = useCallback((event) => {
    if (modeRef.current !== 'CITY' && modeRef.current !== 'SIMULATION') return;
    const point = { lat: event.lngLat.lat, lng: event.lngLat.lng };
    setRoutePoints((current) => {
      if (!current.origin || current.destination) {
        if (current.destination) return current;
        routePointMarkerRefs.current.forEach((marker) => marker?.remove?.());
        routePointMarkerRefs.current = [];
        const marker = addMarker(mapRef.current, null, { id: 'route-origin', ...point, label: 'A · ORIGIN', color: '#38bdf8' });
        routePointMarkerRefs.current.push(marker);
        return { origin: point, destination: null };
      }
      const marker = addMarker(mapRef.current, null, { id: 'route-destination', ...point, label: 'B · DESTINATION', color: '#f59e0b' });
      routePointMarkerRefs.current.push(marker);
      return { ...current, destination: point };
    });
  }, []);

  const calculatePointRoute = useCallback(async () => {
    if (!routePoints.origin || !routePoints.destination) return;
    setRouteStatus('CALCULATING');
    const impact = {
      getWaterAt: (lat, lng) => simRef.current.getWaterAt(lat, lng),
      rainfallMm: Number(sim.weather?.rain_mm || sim.weather?.precipitation_mm || 0),
      getRoadCondition: (lat, lng) => simRef.current.getWaterAt(lat, lng) >= FLOOD_CONFIG.roadBlockedDepth ? 'BLOCKED' : simRef.current.getWaterAt(lat, lng) >= FLOOD_CONFIG.roadDegradedDepth ? 'RISKY' : 'OPEN',
    };
    const result = await routeEngineRef.current.calculate({ origin: routePoints.origin, destination: routePoints.destination, roadImpact: impact, mode: routeMode });
    setRouteAnalysis(result);
    setRouteStatus(result.warning ? 'FALLBACK' : 'ACTIVE');
    const map = mapRef.current;
    if (map) {
      pointRouteOverlayRefs.current.forEach((overlay) => removeOverlay(map, overlay));
      pointRouteOverlayRefs.current = [];
      if (result.baseRoute?.length) pointRouteOverlayRefs.current.push(addPolyline(map, null, result.baseRoute.map(([lng, lat]) => ({ lng, lat })), { id: 'route-base', strokeColor: '#94a3b8', strokeWidth: 3, dashed: true }));
      if (result.route?.length) pointRouteOverlayRefs.current.push(addPolyline(map, null, result.route.map(([lng, lat]) => ({ lng, lat })), { id: 'route-optimal', strokeColor: '#22c55e', strokeWidth: 6 }));
    }
  }, [routeMode, routePoints, sim.weather]);

  const removeEvacuationOverlays = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    evacuationOverlayRefs.current.forEach((overlay) => removeOverlay(map, overlay));
    evacuationOverlayRefs.current = [];
  }, []);

  const stopVehicle = useCallback(() => {
    vehicleRef.current?.stop?.();
  }, []);

  const removeVehicle = useCallback(() => {
    vehicleRef.current?.remove?.();
    vehicleRef.current = null;
    vehiclePositionRef.current = null;
  }, []);

  const cleanupFlood = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    clearFloodLayer(map);
    clearRainLayer(map);
    roadFeaturesRef.current = [];
    roadStatsRef.current = { affected: 0, blocked: 0 };
  }, []);

  const resetInfrastructureMarkers = useCallback(() => {
    infrastructureMarkerRefs.current.forEach((marker) => marker?.remove?.());
    infrastructureMarkerRefs.current.clear();
  }, []);

  const resetResponseVisuals = useCallback(() => {
    stopVehicle();
    removeVehicle();
    removeRouteOverlays();
    removeEvacuationOverlays();
    activeRouteRef.current = null;
    activeRouteTargetRef.current = null;
    forcedBlockRef.current = -1;
    setRoute(null);
    setRouteStatus('READY');
    setEvacuation({ zones: [], shelters: [], assignments: [], metrics: { populationAtRisk: 0, populationEvacuated: 0, availableShelters: 0, unreachableZones: 0 } });
    setResponse({ activeVehicles: 0, activeRoutes: 0, reroutes: 0, evacuated: 0, emergencyAccess: 'STANDBY', rescueStatus: 'READY', vehicle: 'AMBULANCE 01' });
  }, [removeEvacuationOverlays, removeRouteOverlays, removeVehicle, stopVehicle]);

  const addWorldMarkers = useCallback((selectedId) => {
    const map = mapRef.current;
    if (!map) return;
    markerRefs.current.forEach((marker) => marker?.remove?.());
    markerRefs.current = [];
    for (const location of LOCATIONS) {
      const marker = addMarker(map, null, {
        id: `incident-${location.id}`,
        lat: location.lat,
        lng: location.lng,
        label: `${location.name} · ${location.hazardLabel}`,
        color: location.id === selectedId ? '#38bdf8' : '#64748b',
        onClick: () => selectLocation(location),
      });
      markerRefs.current.push(marker);
    }
  }, []);

  const statusForDepth = useCallback((depth) => {
    if (depth >= FLOOD_CONFIG.infraFailedDepth) return 'FAILED';
    if (depth >= FLOOD_CONFIG.infraDegradedDepth) return 'DEGRADED';
    if (depth >= FLOOD_CONFIG.infraAtRiskDepth) return 'AT RISK';
    return 'OPERATIONAL';
  }, []);

  const updateInfrastructureMarkers = useCallback((items, floodEngine = simRef.current) => {
    const map = mapRef.current;
    if (!map) return;
    const visibleItems = items.slice(0, 120);
    const activeIds = new Set();
    for (const place of visibleItems) {
      const waterDepth = Number(floodEngine?.getWaterAt?.(place.lat, place.lng) || 0);
      const status = statusForDepth(waterDepth);
      const id = `infra-${place.id}`;
      activeIds.add(id);
      const typeLabel = String(place.type || 'facility').replaceAll('_', ' ').toUpperCase();
      const color = status === 'FAILED' ? '#ef4444' : status === 'DEGRADED' ? '#f59e0b' : status === 'AT RISK' ? '#facc15' : '#22c55e';
      let marker = infrastructureMarkerRefs.current.get(id);
      if (!marker) {
        marker = addMarker(map, null, {
          id,
          lat: place.lat,
          lng: place.lng,
          label: `${typeLabel} · ${status}`,
          title: place.name,
          color,
          onClick: async () => {
            const liveDepth = Number(simRef.current.getWaterAt?.(place.lat, place.lng) || 0);
            const liveStatus = statusForDepth(liveDepth);
            const exposure = Math.min(1, Math.max(0, liveDepth / 1.5));
            const access = liveStatus === 'FAILED' ? 0.15 : liveStatus === 'DEGRADED' ? 0.45 : liveStatus === 'AT RISK' ? 0.68 : 0.90;
            let assetML = null;
            try { assetML = await predictionClient.infrastructure(buildInfrastructurePayload(place.type, exposure, access, place, selected.id)); } catch (_) {}
            setSelectedPlace({ ...place, waterDepth: liveDepth, status: liveStatus, ml: assetML });
          },
        });
        infrastructureMarkerRefs.current.set(id, marker);
      } else {
        const element = marker.getElement?.();
        const labelEl = element?.querySelector('.rift-map-marker-label');
        if (labelEl) labelEl.textContent = `${typeLabel} · ${status}`;
        element?.style?.setProperty('--rift-marker-color', color);
      }
    }
    for (const [id, marker] of infrastructureMarkerRefs.current.entries()) {
      if (!activeIds.has(id)) {
        marker?.remove?.();
        infrastructureMarkerRefs.current.delete(id);
      }
    }
  }, [selected.id, statusForDepth]);

  const fetchElevationGrid = useCallback(async (location) => {
    const cacheKey = location.id;
    const cached = elevationCacheRef.current.get(cacheKey);
    if (cached) return cached;
    const rows = FLOOD_CONFIG.rows;
    const cols = FLOOD_CONFIG.columns;
    const half = FLOOD_CONFIG.halfSizeDegrees;
    const latSpan = half * 2;
    const lngSpan = half * 2 / Math.max(Math.cos(location.lat * Math.PI / 180), 0.2);
    const points = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        points.push({
          latitude: location.lat - half + (row / (rows - 1)) * latSpan,
          longitude: location.lng - lngSpan / 2 + (col / (cols - 1)) * lngSpan,
        });
      }
    }
    const elevations = [];
    for (let i = 0; i < points.length; i += 100) {
      const batch = points.slice(i, i + 100);
      const result = await ml.elevation({ latitude: batch.map((p) => p.latitude), longitude: batch.map((p) => p.longitude) });
      elevations.push(...(result.elevation_m || []));
    }
    elevationCacheRef.current.set(cacheKey, elevations);
    return elevations;
  }, []);

  const loadContext = useCallback(async (location, hazardType = hazard) => {
    const key = `${location.id}:${hazardType}`;
    const cached = contextCacheRef.current.get(key);
    if (cached) {
      setPlaces(cached.places);
      setSim((s) => ({ ...s, weather: cached.weather, event: cached.event, terrain: cached.terrain, elevationReady: cached.elevations.length === FLOOD_CONFIG.rows * FLOOD_CONFIG.columns, infrastructureSource: cached.placesMeta?.fallback ? 'DEMO / CACHE' : 'LIVE / CACHE' }));
      if (hazardType === 'flood' && cached.elevations.length === FLOOD_CONFIG.rows * FLOOD_CONFIG.columns) initializeSimulationEngine(location, cached, Number(simRef.current.risk || 0.55));
      return cached;
    }

    const results = await Promise.allSettled([
      ml.weather({ latitude: location.lat, longitude: location.lng }),
      ml.places({ latitude: location.lat, longitude: location.lng }),
      hazardType === 'earthquake' ? ml.earthquakes({ latitude: location.lat, longitude: location.lng }) : Promise.resolve({ events: [] }),
      hazardType === 'flood' ? fetchElevationGrid(location) : Promise.resolve([]),
    ]);
    const weather = results[0].status === 'fulfilled' ? results[0].value : null;
    const placesRaw = results[1].status === 'fulfilled' ? results[1].value : { places: [], fallback: true };
    const earthquakeRaw = results[2].status === 'fulfilled' ? results[2].value : { events: [] };
    const elevations = results[3].status === 'fulfilled' ? results[3].value : [];
    const event = earthquakeRaw.events?.[earthquakeRaw.events.length - 1] || null;
    const normalizedPlaces = (placesRaw.places || []).map((p, i) => normalizePlace(p, i, location));
    const terrain = elevations.length === FLOOD_CONFIG.rows * FLOOD_CONFIG.columns ? summarizeElevationGrid(elevations, FLOOD_CONFIG.rows, FLOOD_CONFIG.columns) : null;
    const context = { weather, event, places: normalizedPlaces, placesMeta: placesRaw, elevations, terrain };
    contextCacheRef.current.set(key, context);

    setPlaces(normalizedPlaces);
    setSim((s) => ({ ...s, weather, event, terrain, elevationReady: elevations.length === FLOOD_CONFIG.rows * FLOOD_CONFIG.columns, infrastructureSource: placesRaw.fallback ? 'DEMO / CACHE' : 'LIVE / CACHE' }));
    if (hazardType === 'flood' && elevations.length === FLOOD_CONFIG.rows * FLOOD_CONFIG.columns) initializeSimulationEngine(location, context, Number(simRef.current.risk || 0.55));

    if (results.some((r) => r.status === 'rejected')) setAiNote('Some external inputs were unavailable. RIFT is using available context with deterministic simulation fallback.');
    if (placesRaw.fallback) setAiNote('LIVE INFRASTRUCTURE UNAVAILABLE — using cached/demo infrastructure.');
    return context;
  }, [fetchElevationGrid, hazard]);

  function initializeSimulationEngine(location, context, risk) {
    if (!context?.elevations?.length) return;
    simRef.current.initialize({
      location,
      elevations: context.elevations,
      rainfallMm: Number(context.weather?.rain_mm ?? context.weather?.precipitation_mm ?? 12),
      risk,
      runoffMultiplier: riskToScenarioParameters(risk).runoffMultiplier,
      drainageCapacity: CITY_DRAINAGE[location.id] ?? 0.45,
    });
  }

  const runMLPrediction = useCallback(async (contextOverride = null) => {
    const contextWeather = contextOverride?.weather ?? sim.weather ?? {};
    const contextEvent = contextOverride?.event ?? sim.event ?? null;
    let result;
    if (hazard === 'flood') result = await predictionClient.flood(buildFloodPayload(contextWeather, selected, contextOverride?.terrain ?? sim.terrain));
    else if (hazard === 'cyclone') result = await ml.cyclone(buildCyclonePayload(contextWeather, selected));
    else result = await ml.earthquake(buildEarthquakePayload(contextEvent, selected));
    const risk = Number(result.score ?? result.prediction ?? 0);
    setSim((s) => ({ ...s, ml: result, risk, mlSource: 'MODEL' }));
    simRef.current.risk = risk;
    simRef.current.runoffMultiplier = riskToScenarioParameters(risk).runoffMultiplier;
    setAiNote(`${hazard.toUpperCase()} ML model: ${riskToClass(risk)} risk (${Math.round(risk * 100)}%).`);
    if (hazard === 'flood') {
      try {
        const explanation = await ml.explain('flood_risk_v1');
        setSim((s) => ({ ...s, featureImportance: explanation.featureImportance || [] }));
      } catch (_) {}
    }
    return result;
  }, [hazard, selected, sim.event, sim.weather, sim.terrain]);

  const prepareCityRoads = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.once('idle', () => {
      roadFeaturesRef.current = getCandidateRoadFeatures(map);
      lastRoadAnalysisRef.current = 0;
    });
  }, []);

  const refreshFloodVisuals = useCallback((engine = simRef.current, force = false) => {
    const map = mapRef.current;
    if (!map || hazard !== 'flood' || !engine.grid?.length) return;
    const now = performance.now();
    if (!force && now - lastVisualUpdateRef.current < 240) return;
    lastVisualUpdateRef.current = now;
    updateFloodLayer(map, engine.getGeoJSON());
    const rainIntensity = Math.min(1, (Number(engine.rainfallMm) || 0) / 30 + (engine.risk || 0) * 0.35);
    updateRainLayer(map, selected, rainIntensity);
    let roadStats = roadStatsRef.current;
    if (now - lastRoadAnalysisRef.current >= 1500 || force) {
      roadStats = updateAffectedRoadLayer(map, roadFeaturesRef.current, engine);
      roadStatsRef.current = roadStats;
      lastRoadAnalysisRef.current = now;
    }
    if (now - lastInfrastructureUpdateRef.current >= 600 || force) {
      updateInfrastructureMarkers(places, engine);
      lastInfrastructureUpdateRef.current = now;
    }
    if (routePoints.origin && routePoints.destination && routeAnalysisRef.current && now - lastPointRouteAnalysisRef.current >= 2000) {
      lastPointRouteAnalysisRef.current = now;
      void calculatePointRoute();
    }
    const metrics = engine.getMetrics();
    setSim((s) => ({ ...s, metrics, roadsAffected: roadStats.affected, roadsBlocked: roadStats.blocked, time: engine.time, status: engine.status === 'COMPLETE' ? STATUS.COMPLETE : s.status }));
    if (engine.time >= 10 && !evacCalculatedRef.current && places.length) void calculateEvacuation(false, engine);
  }, [calculatePointRoute, hazard, places, routePoints.destination, routePoints.origin, selected, updateInfrastructureMarkers]);

  const selectLocation = useCallback((location, { fromDemo = false } = {}) => {
    if (!fromDemo && demoRunningRef.current) stopDemo();
    lastRouteValidationTimeRef.current = -Infinity;
    clearInterval(simTimerRef.current);
    simRef.current.reset();
    cleanupFlood();
    resetInfrastructureMarkers();
    resetResponseVisuals();
    clearPointRoute();
    setSelected(location);
    // Review 2 hero mode uses the flood engine for every hotspot; the list still shows each location's primary hazard.
    setHazard('flood');
    setMode('CITY');
    applyMapStyle('streets');
    setSelectedPlace(null);
    setSim({ status: STATUS.IDLE, time: -120, speed: 1, risk: null, ml: null, weather: null, event: null, elevationReady: false, metrics: RESET_METRICS, roadsAffected: 0, roadsBlocked: 0, terrain: null, mlSource: 'STANDBY', featureImportance: [], scenarioIntensity: 0, infrastructureSource: 'LIVE / CACHE' });
    setAiNote('Loading real-world environment context…');
    evacCalculatedRef.current = false;
  }, [cleanupFlood, resetInfrastructureMarkers, resetResponseVisuals, clearPointRoute]);

  const findCity = useCallback(async (event) => {
    event.preventDefault();
    setCitySearchStatus('SEARCHING');
    try {
      const location = await searchCity(cityQuery);
      selectLocation(location);
      setCityQuery('');
      setCitySearchStatus('READY');
    } catch (error) {
      setCitySearchStatus(error.message);
    }
  }, [cityQuery, selectLocation]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const map = await loadMap(mapHost.current, {
          center: { lng: 60, lat: 20 }, zoom: 1.2, pitch: 0, bearing: 0, style: 'global',
          onLoad: () => { if (alive) { setMapReady(true); addWorldMarkers(selected.id); } },
          onMapClick: handleMapClick,
          onError: (error) => alive && setMapError(error?.message || 'MapTiler resource unavailable.'),
        });
        if (!alive) return;
        mapRef.current = map;
        setMapReady(true);
        addWorldMarkers(selected.id);
      } catch (error) {
        if (alive) setMapError(error.message || 'Unable to initialize MapTiler.');
      }
    })();
    return () => {
      alive = false;
      demoTokenRef.current += 1;
      demoRunningRef.current = false;
      clearInterval(simTimerRef.current);
      cleanupFlood();
      clearMarkers();
      resetInfrastructureMarkers();
      removeVehicle();
      removeRouteOverlays();
      removeEvacuationOverlays();
      clearPointRoute();
      destroyMap();
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !selected) return;
    flyToLocation(selected, { global: mode === 'GLOBAL', duration: mode === 'GLOBAL' ? 1400 : 1900 });
    addWorldMarkers(selected.id);
    if (mode === 'CITY') {
      prepareCityRoads();
      loadContext(selected, hazard).catch((error) => setAiNote(`Context load failed: ${error.message}`));
    }
  }, [mapReady, mode, selected, hazard, addWorldMarkers, prepareCityRoads, loadContext]);

  useEffect(() => {
    if (sim.status !== STATUS.RUNNING) {
      clearInterval(simTimerRef.current);
      return undefined;
    }
    clearInterval(simTimerRef.current);
    simTimerRef.current = setInterval(() => {
      simRef.current.update(0.8 * sim.speed);
      refreshFloodVisuals(simRef.current);
      if (activeRouteRef.current && simRef.current.time - lastRouteValidationTimeRef.current >= 10) { lastRouteValidationTimeRef.current = simRef.current.time; void validateActiveRoute(); }
    }, 800);
    return () => clearInterval(simTimerRef.current);
  }, [sim.status, sim.speed, refreshFloodVisuals]);

  const startSimulation = useCallback(async ({ fromDemo = false } = {}) => {
    setMode('SIMULATION');
    setAiNote('Fetching environment context and evaluating flood risk…');
    try {
      let context = { weather: sim.weather, event: sim.event, places, terrain: sim.terrain, elevations: simRef.current.elevations };
      if (!context.weather || !sim.elevationReady) context = await loadContext(selected, 'flood');
      let result;
      let mlUnavailable = false;
      try {
        result = await runMLPrediction(context);
      } catch (mlError) {
        mlUnavailable = true;
        result = { model: 'flood_risk_v1', prediction: null, score: 0.55, riskClass: 'MODERATE', modelStatus: 'unavailable', simulationUse: true };
        setAiNote(`ML OFFLINE — ${mlError.message}. DEMO SIMULATION fallback remains available.`);
      }
      const risk = Number(result.score ?? result.prediction ?? 0.55);
      if (!context.elevations?.length) throw new Error('Real-world elevation grid is unavailable for the flood scenario.');
      initializeSimulationEngine(selected, context, risk);
      prepareCityRoads();
      simRef.current.start();
      evacCalculatedRef.current = false;
      forcedBlockRef.current = -1;
      refreshFloodVisuals(simRef.current, true);
      setSim((s) => ({ ...s, status: STATUS.RUNNING, time: -120, risk, ml: result, weather: context.weather, event: context.event, terrain: context.terrain, elevationReady: true, scenarioIntensity: riskToScenarioParameters(risk).scenarioIntensity, mlSource: mlUnavailable ? 'OFFLINE' : 'MODEL' }));
      if (!mlUnavailable) setAiNote('Flood simulation active: real-world weather + elevation + trained ML risk drive the deterministic RIFT scenario.');
      setResponse((r) => ({ ...r, emergencyAccess: 'READY', rescueStatus: 'READY' }));
      if (fromDemo) setDemoStep('WATER RISE');
    } catch (error) {
      setAiNote(`Simulation could not start: ${error.message}`);
      setSim((s) => ({ ...s, status: STATUS.IDLE, mlSource: s.ml ? s.mlSource : 'OFFLINE' }));
    }
  }, [loadContext, places, prepareCityRoads, refreshFloodVisuals, runMLPrediction, selected, sim.elevationReady, sim.event, sim.terrain, sim.weather]);

  const resetSimulation = useCallback(() => {
    clearInterval(simTimerRef.current);
    simRef.current.reset();
    cleanupFlood();
    resetInfrastructureMarkers();
    resetResponseVisuals();
    evacCalculatedRef.current = false;
    setSim((s) => ({ ...s, status: STATUS.IDLE, time: -120, risk: null, ml: null, metrics: RESET_METRICS, roadsAffected: 0, roadsBlocked: 0, terrain: null, mlSource: 'STANDBY', featureImportance: [], scenarioIntensity: 0 }));
    setMode('CITY');
    flyToLocation(selected, { global: false, duration: 1000 });
    clearPointRoute();
    setAiNote('Simulation reset. City returned to baseline.');
  }, [cleanupFlood, resetInfrastructureMarkers, resetResponseVisuals, selected, clearPointRoute]);

  const stepBy = useCallback((delta) => {
    if (!simRef.current.grid?.length) return;
    if (simRef.current.status === 'IDLE') simRef.current.status = 'READY';
    simRef.current.setTime(simRef.current.time + delta);
    refreshFloodVisuals(simRef.current, true);
    setSim((s) => ({ ...s, status: simRef.current.time >= 60 ? STATUS.COMPLETE : STATUS.PAUSED, time: simRef.current.time }));
  }, [refreshFloodVisuals]);

  const jumpToTime = useCallback((time) => {
    if (!simRef.current.grid?.length) return;
    simRef.current.setTime(time);
    refreshFloodVisuals(simRef.current, true);
    setSim((s) => ({ ...s, status: time >= 60 ? STATUS.COMPLETE : STATUS.PAUSED, time }));
  }, [refreshFloodVisuals]);

  const calculateRescueRoute = useCallback(async ({ fromDemo = false, forcedBlock = forcedBlockRef.current } = {}) => {
    const hospital = places.find((p) => p.type === 'hospital');
    const fireStation = places.find((p) => p.type === 'fire_station');
    const originPlace = selectedPlace?.type === 'fire_station' ? selectedPlace : fireStation || places.find((p) => p.type === 'police') || places[0];
    const destinationPlace = hospital || places.find((p) => p.type === 'shelter') || places.find((p) => p.type === 'police');
    if (!originPlace || !destinationPlace) {
      setRouteStatus('UNAVAILABLE');
      setAiNote('No rescue origin/destination facilities are available.');
      return null;
    }
    setRouteStatus('CALCULATING');
    setResponse((r) => ({ ...r, rescueStatus: 'CALCULATING', vehicle: 'AMBULANCE 01' }));
    const roadImpact = {
      getWaterAt: (lat, lng) => simRef.current.getWaterAt(lat, lng),
      rainfallMm: Number(sim.weather?.rain_mm || sim.weather?.precipitation_mm || 0),
      getRoadCondition: (lat, lng) => simRef.current.getWaterAt(lat, lng) >= FLOOD_CONFIG.roadBlockedDepth ? 'BLOCKED' : simRef.current.getWaterAt(lat, lng) >= FLOOD_CONFIG.roadDegradedDepth ? 'RISKY' : 'OPEN',
      forcedBlockIndex: forcedBlock,
    };
    const result = await routeEngineRef.current.calculate({
      origin: { lat: originPlace.lat, lng: originPlace.lng },
      destination: { lat: destinationPlace.lat, lng: destinationPlace.lng },
      roadImpact,
    });
    activeRouteRef.current = result;
    activeRouteTargetRef.current = { destination: destinationPlace, origin: originPlace };
    forcedBlockRef.current = forcedBlock;
    result.origin = { ...originPlace, lat: originPlace.lat, lng: originPlace.lng };
    result.destination = { ...destinationPlace, lat: destinationPlace.lat, lng: destinationPlace.lng };
    setRoute(result);
    setRouteStatus(result.warning ? 'FALLBACK' : 'ACTIVE');
    setResponse((r) => ({ ...r, activeVehicles: 1, activeRoutes: result.route?.length ? 1 : 0, rescueStatus: result.warning ? 'SIMULATED ROUTE' : 'EN ROUTE', emergencyAccess: result.blockedSegments.length ? 'LIMITED' : `${Math.round((1 - result.risk) * 100)}%` }));
    const map = mapRef.current;
    if (map && result.route?.length) {
      removeRouteOverlays();
      routeOverlayRef.current = addPolyline(map, null, result.route.map(([lng, lat]) => ({ lng, lat })), { id: 'rescue-route', strokeColor: result.blockedSegments.length ? '#ef4444' : '#22c55e', strokeWidth: 6 });
      const endMarker = addMarker(map, null, { id: 'rescue-destination', lat: destinationPlace.lat, lng: destinationPlace.lng, label: 'HOSPITAL', color: '#f59e0b' });
      routeOverlayRef.current.destinationMarker = endMarker;
    }
    if (fromDemo) setDemoStep('AMBULANCE');
    return result;
  }, [places, removeRouteOverlays, selectedPlace, sim.weather]);

  const validateActiveRoute = useCallback(async () => {
    const active = activeRouteRef.current;
    if (!active || !active.route?.length) return;
    const check = routeEngineRef.current.validate(active, {
      getWaterAt: (lat, lng) => simRef.current.getWaterAt(lat, lng),
      rainfallMm: Number(sim.weather?.rain_mm || sim.weather?.precipitation_mm || 0),
      getRoadCondition: (lat, lng) => simRef.current.getWaterAt(lat, lng) >= FLOOD_CONFIG.roadBlockedDepth ? 'BLOCKED' : simRef.current.getWaterAt(lat, lng) >= FLOOD_CONFIG.roadDegradedDepth ? 'RISKY' : 'OPEN',
      forcedBlockIndex: forcedBlockRef.current,
    });
    if (check.valid) return;
    setRouteStatus('REROUTING');
    setResponse((r) => ({ ...r, rescueStatus: 'REROUTING', activeRoutes: 0 }));
    const target = activeRouteTargetRef.current;
    if (!target) return;
    const currentPoint = vehiclePositionRef.current || { lng: target.origin.lng, lat: target.origin.lat };
    const rerouted = await routeEngineRef.current.calculate({
      origin: { lat: currentPoint.lat, lng: currentPoint.lng },
      destination: { lat: target.destination.lat, lng: target.destination.lng },
      roadImpact: {
        getWaterAt: (lat, lng) => simRef.current.getWaterAt(lat, lng),
        rainfallMm: Number(sim.weather?.rain_mm || sim.weather?.precipitation_mm || 0),
        getRoadCondition: (lat, lng) => simRef.current.getWaterAt(lat, lng) >= FLOOD_CONFIG.roadBlockedDepth ? 'BLOCKED' : simRef.current.getWaterAt(lat, lng) >= FLOOD_CONFIG.roadDegradedDepth ? 'RISKY' : 'OPEN',
      },
    });
    activeRouteRef.current = rerouted;
    forcedBlockRef.current = -1;
    rerouted.origin = { ...currentPoint };
    rerouted.destination = { ...target.destination };
    setRoute(rerouted);
    setRouteStatus(rerouted.warning ? 'FALLBACK' : 'ACTIVE');
    setResponse((r) => ({ ...r, reroutes: r.reroutes + 1, activeRoutes: rerouted.route?.length ? 1 : 0, rescueStatus: 'EN ROUTE', emergencyAccess: `${Math.round((1 - rerouted.risk) * 100)}%` }));
    const map = mapRef.current;
    if (map && rerouted.route?.length) {
      removeRouteOverlays();
      routeOverlayRef.current = addPolyline(map, null, rerouted.route.map(([lng, lat]) => ({ lng, lat })), { id: 'rescue-route', strokeColor: '#22c55e', strokeWidth: 6 });
    }
    if (vehicleRef.current && rerouted.route?.length) {
      vehicleRef.current.setRoute(rerouted.route, { speedScale: Math.max(0.55, 1 - rerouted.risk * 0.5), durationMs: 12000, conditionAt: (lat, lng) => simRef.current.getWaterAt(lat, lng) / Math.max(0.6, FLOOD_CONFIG.roadBlockedDepth) });
      vehicleRef.current.start();
    }
    setAiNote('Active rescue route entered a BLOCKED segment. RIFT invalidated it, searched alternatives, and continued on a new route.');
  }, [removeRouteOverlays, sim.weather]);

  const launchAmbulance = useCallback(({ fromDemo = false } = {}) => {
    const active = activeRouteRef.current;
    if (!active?.route?.length || !mapRef.current) return;
    if (!vehicleRef.current) vehicleRef.current = new EmergencyVehicle(mapRef.current, { type: 'ambulance', id: 'AMBULANCE 01' });
    vehicleRef.current.setRoute(active.route, { speedScale: Math.max(0.55, 1 - active.risk * 0.5), durationMs: fromDemo ? 11500 : 16000, conditionAt: (lat, lng) => simRef.current.getWaterAt(lat, lng) / Math.max(0.6, FLOOD_CONFIG.roadBlockedDepth) });
    vehiclePositionRef.current = active.route[0] ? { lng: active.route[0][0], lat: active.route[0][1] } : null;
    vehicleRef.current.onUpdate = ({ point }) => { vehiclePositionRef.current = { lng: point[0], lat: point[1] }; };
    vehicleRef.current.onArrive = () => {
      setResponse((r) => ({ ...r, activeRoutes: 0, activeVehicles: 0, rescueStatus: 'ARRIVED', emergencyAccess: 'ARRIVED' }));
      setRouteStatus('ARRIVED');
      setAiNote('AMBULANCE 01 arrived at the hospital.');
      if (fromDemo) setDemoStep('ARRIVED');
    };
    setResponse((r) => ({ ...r, activeVehicles: 1, activeRoutes: 1, rescueStatus: 'EN ROUTE', vehicle: 'AMBULANCE 01' }));
    vehicleRef.current.start();
    if (fromDemo) setDemoStep('EN ROUTE');
  }, []);

  async function calculateEvacuation(auto = true, engine = simRef.current) {
    if (!places.length || !engine?.grid?.length) return;
    const evacuationEngine = evacuationRef.current;
    const zones = evacuationEngine.buildZones({ simulation: engine, location: selected, populationDensity: CITY_POPULATION_DENSITY[selected.id] || 8000 });
    const shelters = evacuationEngine.buildShelters(places);
    if (!shelters.length) {
      setAiNote('No mapped shelters available. Evacuation remains ready but no shelter assignment can be made.');
      setEvacuation({ zones, shelters: [], assignments: [], metrics: { populationAtRisk: zones.filter((z) => z.affected).reduce((s, z) => s + z.population, 0), populationEvacuated: 0, availableShelters: 0, unreachableZones: zones.filter((z) => z.affected).length } });
      evacCalculatedRef.current = true;
      return;
    }
    const assignments = await evacuationEngine.assignBestShelters({
      routeEngine: routeEngineRef.current,
      zones,
      shelters,
      roadImpact: { getWaterAt: (lat, lng) => engine.getWaterAt(lat, lng) },
    });
    const metrics = evacuationEngine.getMetrics();
    setEvacuation({ zones, shelters, assignments, metrics });
    setResponse((r) => ({ ...r, evacuated: metrics.populationEvacuated }));
    removeEvacuationOverlays();
    const map = mapRef.current;
    if (map) {
      for (const assignment of assignments) {
        const zone = zones.find((z) => z.id === assignment.zoneId);
        if (!zone || !assignment.route?.route?.length) continue;
        const overlay = addPolyline(map, null, assignment.route.route.map(([lng, lat]) => ({ lng, lat })), { id: `evac-${assignment.zoneId}`, strokeColor: '#60a5fa', strokeWidth: 4, dashed: true });
        evacuationOverlayRefs.current.push(overlay);
      }
    }
    evacCalculatedRef.current = true;
    setAiNote(auto ? 'Evacuation routes calculated from affected zones to reachable shelters. Metrics are simulation aggregates.' : 'NEPAL evacuation scenario calculated from affected zones and mapped shelters.');
  }

  const goGlobal = useCallback(() => {
    if (demoRunningRef.current) stopDemo();
    clearInterval(simTimerRef.current);
    simRef.current.reset();
    cleanupFlood();
    resetInfrastructureMarkers();
    resetResponseVisuals();
    setMode('GLOBAL');
    applyMapStyle('global');
    clearPointRoute();
    setSim((s) => ({ ...s, status: STATUS.IDLE, time: -120, risk: null, ml: null, elevationReady: false, metrics: RESET_METRICS, roadsAffected: 0, roadsBlocked: 0, terrain: null, mlSource: 'STANDBY', featureImportance: [], scenarioIntensity: 0 }));
    flyToLocation(null, { global: true, duration: 1400 });
    setAiNote('Global command center. Select a hotspot to enter the real 3D city.');
  }, [cleanupFlood, resetInfrastructureMarkers, resetResponseVisuals, clearPointRoute]);

  const runReviewDemo = useCallback(async () => {
    if (demoRunningRef.current) { stopDemo(); return; }
    demoRunningRef.current = true;
    setDemo(true);
    const token = ++demoTokenRef.current;
    const alive = () => demoRunningRef.current && demoTokenRef.current === token;
    try {
      const mumbai = LOCATIONS.find((location) => location.id === 'mumbai');
      setDemoStep('MUMBAI');
      selectLocation(mumbai, { fromDemo: true });
      await sleep(1300);
      if (!alive()) return;
      await loadContext(mumbai, 'flood');
      if (!alive()) return;
      demoRunningRef.current = false;
      setDemoStep('MUMBAI · CITY VIEW');
      setAiNote('REVIEW 2 DEMO READY — Mumbai city view loaded. Start FLOOD SIMULATION when ready.');
    } catch (error) {
      setAiNote(`Demo stopped: ${error.message}`);
    } finally {
      if (demoRunningRef.current && demoTokenRef.current === token) {
        demoRunningRef.current = false;
        setDemo(false);
        setDemoStep('READY');
      }
    }
  }, [calculateEvacuation, calculateRescueRoute, goGlobal, launchAmbulance, loadContext, prepareCityRoads, refreshFloodVisuals, removeVehicle, resetSimulation, runMLPrediction, selectLocation, startSimulation, validateActiveRoute]);

  const stopDemo = useCallback(() => {
    demoRunningRef.current = false;
    demoTokenRef.current += 1;
    setDemo(false);
    setDemoStep('READY');
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key.toLowerCase() !== 'd') return;
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      event.preventDefault();
      void runReviewDemo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runReviewDemo]);

  const toggleStyle = useCallback(() => {
    const next = mapStyleMode === 'streets' ? 'satellite' : 'streets';
    setMapStyleMode(next);
    applyMapStyle(next);
  }, [mapStyleMode]);

  const currentTime = sim.time >= 0 ? `T+${sim.time}` : `T${sim.time}`;
  const currentRiskClass = sim.risk == null ? 'STANDBY' : riskToClass(sim.risk);
  const mapOnline = mapReady && !mapError;
  const mlStatus = sim.mlSource === 'OFFLINE' ? 'OFFLINE' : sim.ml ? 'READY' : 'STANDBY';
  const metrics = sim.metrics || RESET_METRICS;
  const weatherText = sim.weather?.rain_mm != null ? `${Number(sim.weather.rain_mm).toFixed(1)} mm` : '—';
  const responseEvacuated = Math.max(response.evacuated, evacuation.metrics.populationEvacuated || 0);

  return (
    <div className="app-shell">
      <div ref={mapHost} className="world" />
      <div className="world-vignette" />

      <header className="topbar glass">
        <div>
          <div className="brand">RIFT</div>
          <div className="subtitle">REVIEW 2 COMMAND CENTER</div>
        </div>
        <div className="top-status">
          <form className="city-search" onSubmit={findCity}>
            <input value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} placeholder="SEARCH ANY CITY" aria-label="Search any city" />
            <button type="submit">GO</button>
          </form>
          <span>WORLD <b className={mapOnline ? 'ok' : 'warn'}>{mapError ? 'UNAVAILABLE' : mapReady ? 'ONLINE' : 'LOADING'}</b></span>
          <span>ML <b className={mlStatus === 'READY' ? 'ok' : 'warn'}>{mlStatus}</b></span>
          <span>MODE <b>{mode}</b></span>
          <button onClick={toggleStyle}>{mapStyleMode === 'streets' ? 'STREETS' : 'SATELLITE'}</button>
          <button onClick={goGlobal}>GLOBAL</button>
          <button className={demo ? 'demo-active' : ''} onClick={() => void runReviewDemo()}>{demo ? `DEMO · ${demoStep}` : 'RUN REVIEW DEMO'}</button>
        </div>
      </header>
      {citySearchStatus && citySearchStatus !== 'READY' && citySearchStatus !== 'SEARCHING' && <div className="city-search-status glass">{citySearchStatus}</div>}

      <aside className="left-panel glass">
        <div className="panel-title">LOCATIONS</div>
        <div className="locations">
          {LOCATIONS.map((location) => (
            <button key={location.id} className={`location-row ${selected.id === location.id ? 'active' : ''}`} onClick={() => selectLocation(location)}>
              <span><b>{location.name}</b><small>{location.hazardLabel}</small></span>
              <em>{location.hazard.toUpperCase()}</em>
            </button>
          ))}
        </div>
        <div className="panel-note">REAL CITY · REAL ROADS · REAL TERRAIN<br />RIFT SIMULATION OVERLAY</div>
      </aside>

      <aside className="right-panel glass">
        <div className="panel-title">INCIDENT / SIMULATION / RESPONSE</div>
        <div className="incident-name">{selected.name}</div>
        <div className="muted">{selected.country} · {hazard.toUpperCase()}</div>

        <section className="command-section">
          <div className="section-label">INCIDENT</div>
          <div className="kv"><span>STATUS</span><b>{sim.status}</b></div>
          <div className="kv"><span>ML RISK</span><b>{sim.risk == null ? '—' : `${Math.round(sim.risk * 100)}% · ${currentRiskClass}`}</b></div>
          <div className="kv"><span>RAINFALL</span><b>{weatherText}</b></div>
          <div className="kv"><span>INFRA DATA</span><b>{sim.infrastructureSource}</b></div>
          <div className="kv"><span>ML SOURCE</span><b>{sim.mlSource}</b></div>
          <button className="primary" onClick={() => void startSimulation()}>FLOOD SIMULATION</button>
          <button className="secondary" onClick={resetSimulation}>RESET</button>
        </section>

        <section className="command-section route-optimization">
          <div className="section-label">ROUTE OPTIMIZATION · SIMULATION</div>
          <div className="route-points"><span>ORIGIN <b>{routePoints.origin ? 'A SET' : 'CLICK MAP'}</b></span><span>DESTINATION <b>{routePoints.destination ? 'B SET' : 'CLICK MAP'}</b></span></div>
          <div className="route-controls">
            <select value={routeMode} onChange={(event) => setRouteMode(event.target.value)}>
              <option>FASTEST SAFE</option><option>LOWEST RISK</option><option>BALANCED</option>
            </select>
            <button className="secondary" disabled={!routePoints.origin || !routePoints.destination} onClick={() => void calculatePointRoute()}>CALCULATE OPTIMAL ROUTE</button>
            <button className="secondary" onClick={clearPointRoute}>CLEAR</button>
          </div>
          {routeAnalysis && <>
            <div className="metrics-grid compact">
              <Metric label="DISTANCE" value={`${(routeAnalysis.distance / 1000).toFixed(1)} km`} />
              <Metric label="BASE ETA" value={`${Math.round(routeAnalysis.baseTravelTime / 60)} min`} />
              <Metric label="OPTIMIZED ETA" value={`${Math.round(routeAnalysis.travelTime / 60)} min`} />
              <Metric label="SAFETY SCORE" value={`${routeAnalysis.safetyScore}/100`} />
              <Metric label="FLOOD EXPOSURE" value={`${Math.round(routeAnalysis.floodExposure * 100)}%`} />
              <Metric label="BLOCKED / RISKY" value={`${routeAnalysis.blockedSegments.length} / ${routeAnalysis.riskySegments.length}`} />
            </div>
            <div className="route-meta">RIFT OPTIMIZED ROUTE · {routeAnalysis.routeMode} · {routeStatus}</div>
            <details className="route-explanation"><summary>WHY THIS ROUTE?</summary><span>BASE ROUTE {routeAnalysis.baseRoute?.length ? 'ANALYZED' : 'UNAVAILABLE'} · SIMULATED FLOOD RISK {routeAnalysis.risk >= 0.5 ? 'HIGH' : routeAnalysis.risk >= 0.25 ? 'MODERATE' : 'LOW'} · {routeAnalysis.rerouted ? 'ALTERNATIVE SELECTED' : 'BASE ROUTE RETAINED'}</span></details>
          </>}
        </section>

        <section className="command-section">
          <div className="section-label">FLOOD IMPACT</div>
          <div className="metrics-grid">
            <Metric label="AREA AFFECTED" value={`${Number(metrics.affectedPercent || 0).toFixed(1)}%`} />
            <Metric label="AVG DEPTH" value={`${Number(metrics.averageWaterDepth || 0).toFixed(2)}m`} />
            <Metric label="MAX DEPTH" value={`${Number(metrics.maxWaterDepth || 0).toFixed(2)}m`} />
            <Metric label="ROADS AFFECTED" value={sim.roadsAffected} />
            <Metric label="ROADS BLOCKED" value={sim.roadsBlocked} />
            <Metric label="INFRASTRUCTURE" value={places.length} />
          </div>
        </section>

        <section className="command-section">
          <div className="section-label">RESCUE OPERATIONS</div>
          <div className="kv"><span>VEHICLE</span><b>{response.vehicle}</b></div>
          <div className="kv"><span>ORIGIN</span><b>{route?.origin?.name || places.find((p) => p.type === 'fire_station')?.name || 'FIRE STATION'}</b></div>
          <div className="kv"><span>DESTINATION</span><b>{route?.destination?.name || places.find((p) => p.type === 'hospital')?.name || 'HOSPITAL'}</b></div>
          <div className="kv"><span>ETA</span><b>{route?.travelTime ? `${Math.round(route.travelTime / 60)} min` : '—'}</b></div>
          <div className="kv"><span>ROUTE SAFETY</span><b>{route ? `${Math.max(0, Math.round((1 - route.risk) * 100))}%` : '—'}</b></div>
          <div className="kv"><span>STATUS</span><b>{response.rescueStatus}</b></div>
          <button className="secondary" onClick={() => void calculateRescueRoute()}>CALCULATE RESCUE ROUTE</button>
          {route?.route?.length > 1 && response.rescueStatus !== 'ARRIVED' && <button className="secondary" onClick={() => launchAmbulance()}>LAUNCH AMBULANCE 01</button>}
          <div className="route-meta">{routeStatus}{route?.warning ? ` · ${route.warning}` : ''}</div>
        </section>

        <section className="command-section">
          <div className="section-label">EVACUATION · SIMULATION</div>
          <div className="metrics-grid compact">
            <Metric label="POPULATION AT RISK" value={formatCount(evacuation.metrics.populationAtRisk)} />
            <Metric label="POPULATION EVACUATED" value={formatCount(responseEvacuated)} />
            <Metric label="AVAILABLE SHELTERS" value={evacuation.metrics.availableShelters} />
            <Metric label="UNREACHABLE ZONES" value={evacuation.metrics.unreachableZones} />
          </div>
          {evacuation.assignments.slice(0, 2).map((assignment) => {
            const zone = evacuation.zones.find((z) => z.id === assignment.zoneId);
            return <div className="evac-row" key={assignment.zoneId}><span>{zone?.name || assignment.zoneId}</span><b>→ {assignment.shelter.name}</b></div>;
          })}
          <div className="evac-hint">AFFECTED ZONE ↓ SAFE ROUTE ↓ SHELTER</div>
        </section>

        <section className="command-section">
          <div className="section-label">RESPONSE</div>
          <div className="response-grid">
            <Metric label="ACTIVE VEHICLES" value={response.activeVehicles} />
            <Metric label="ACTIVE ROUTES" value={response.activeRoutes} />
            <Metric label="REROUTES" value={response.reroutes} />
            <Metric label="EVACUATED" value={formatCount(responseEvacuated)} />
          </div>
          <div className="kv"><span>EMERGENCY ACCESS</span><b>{response.emergencyAccess}</b></div>
        </section>

        <section className="command-section ml-summary">
          <div className="section-label">ML INTELLIGENCE</div>
          <div className="kv"><span>MODEL</span><b>{sim.ml?.model || '—'}</b></div>
          <div className="kv"><span>RISK CLASS</span><b>{currentRiskClass}</b></div>
          {sim.featureImportance?.length > 0 && <div className="feature-list">{sim.featureImportance.slice(0, 3).map((item) => <div key={item.feature} className="feature-row"><span>{item.feature}</span><b>{(item.importance * 100).toFixed(1)}%</b></div>)}</div>}
          <p className="disclaimer">SIMULATION. ML outputs are model outputs; RIFT impact and evacuation values are prototype decision-support visuals, not public-safety forecasts.</p>
        </section>

        <div className="system-note">{aiNote}</div>
      </aside>

      <section className="bottom-center glass">
        <div className="timeline-head"><span>SIMULATION TIMELINE · {hazard.toUpperCase()}</span><b>{currentTime}</b></div>
        <div className="timeline">
          {TIMELINE.map((time) => <button key={time} className={sim.time === time ? 'active' : ''} onClick={() => jumpToTime(time)}>{time >= 0 ? `T+${time}` : `T${time}`}</button>)}
        </div>
        <div className="controls">
          <button onClick={() => stepBy(-10)}>STEP −</button>
          <button onClick={() => {
            if (!simRef.current.grid?.length) return;
            setSim((s) => ({ ...s, status: s.status === STATUS.RUNNING ? STATUS.PAUSED : STATUS.RUNNING }));
            if (simRef.current.status === 'READY' || simRef.current.status === 'PAUSED') simRef.current.start();
          }}>{sim.status === STATUS.RUNNING ? 'PAUSE' : 'PLAY'}</button>
          <button onClick={() => stepBy(10)}>STEP +</button>
          <select value={sim.speed} onChange={(event) => setSim((s) => ({ ...s, speed: Number(event.target.value) }))}>
            <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
          </select>
        </div>
      </section>

      {mapError && (
        <div className="map-error glass">
          <b>WORLD DATA UNAVAILABLE</b>
          <span>{mapError}</span>
          <small>RIFT controls remain available. Set VITE_MAPTILER_API_KEY in frontend/.env and restart Vite.</small>
        </div>
      )}

      <div className="hud-badge glass">SIMULATION · {selected.name.toUpperCase()} · {demo ? `DEMO ${demoStep}` : 'READY'}</div>
      <div className="attribution">© MapTiler · © OpenStreetMap contributors · Routing: OSRM / OpenStreetMap · external data: USGS / Open-Meteo</div>
    </div>
  );
}

async function mlRouteProvider({ origin, destination }) {
  return ml.route({ latitude: origin.lat, longitude: origin.lng, end_latitude: destination.lat, end_longitude: destination.lng, profile: 'driving' });
}

function Metric({ label, value }) {
  return <div className="metric"><span>{label}</span><b>{value}</b></div>;
}

function normalizePlace(p, index, location) {
  const lat = Number(p.lat ?? p.location?.latitude ?? p.center?.lat ?? location.lat + (index + 1) * 0.003);
  const lng = Number(p.lng ?? p.location?.longitude ?? p.center?.lon ?? location.lng + (index + 1) * 0.003);
  const type = p.type || p.primaryType || p.tags?.amenity || 'critical_facility';
  const name = p.name || p.displayName?.text || p.tags?.name || `${String(type).replaceAll('_', ' ')} ${index + 1}`;
  return { id: p.id || `${type}-${index}`, name, type, lat, lng, source: p.source, simulationOnly: Boolean(p.simulationOnly) };
}

function formatCount(value) {
  const n = Math.round(Number(value) || 0);
  return n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

export default App;

# RIFT Review 2 — Phase 2 implemented

This build preserves the MapTiler real-world map from Phase 1 and adds a deterministic flood simulation over the imported city/terrain.

## Core flow

MapTiler 3D world → Open-Meteo weather → Open-Meteo elevation grid → existing `flood_risk_v1` model → flood water-depth grid → MapLibre/GeoJSON flood overlay → affected-road overlay → infrastructure exposure markers.

## Key implementation files

- `frontend/src/floodSimulation.js`
- `frontend/src/floodOverlay.js`
- `frontend/src/rainLayer.js`
- `frontend/src/App.jsx`
- `frontend/src/api.js`
- `backend/external_services.py`
- `backend/app.py`

## Flood model behavior

- 18 × 18 simulation grid (324 cells)
- elevation requested in batches of 100 coordinates
- deterministic waterline based on rainfall, ML risk and drainage capacity
- two-pass neighborhood smoothing for continuous spread
- water-depth thresholds for road state and infrastructure exposure
- MapLibre/MapTiler GeoJSON overlays for water and affected roads
- rain visualization without per-drop React components

## External input sources

Open-Meteo Elevation API is used for the grid. Open-Meteo documents 90 m resolution Copernicus DEM GLO-90 data and up to 100 coordinates per request.

OpenStreetMap/Overpass critical-place requests are cached server-side and fall back to deterministic simulation facilities after provider failure/rate limiting.

## Run

Backend:

```powershell
cd C:\Users\krish\Desktop\RIFT_REVIEW2
.venv\Scripts\Activate.ps1
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
cd C:\Users\krish\Desktop\RIFT_REVIEW2\frontend
npm install
npm run dev
```

Create `frontend/.env` from `frontend/.env.example` and set your MapTiler key.

## Review 2 demo

1. Select Mumbai.
2. Wait for ELEVATION = READY.
3. Click START FLOOD SIMULATION.
4. Click PLAY.
5. Move the timeline to T-60, T0 and T+60.
6. Observe the flood mask expand over the real city.
7. Observe affected roads change to amber/red when sampled flood depth crosses the configured thresholds.
8. Click an infrastructure marker to inspect exposure.
9. RESET.
10. Repeat with Nepal to show terrain-driven differences.

## Important limitation

The flood engine is a hackathon simulation, not a hydrodynamic or public-safety forecasting model. It uses real terrain/weather inputs where available, but the propagation formula is intentionally simplified.

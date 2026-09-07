# RIFT — Free / No-Billing API Setup

RIFT uses a deliberately low-cost hackathon stack.

## 1. Google Maps Demo Key — 3D world

Use Google's **Maps Demo Key** for supported Maps JavaScript API prototyping. Google documents the Demo Key as a no-cost option that does not require entering billing information; its supported features include 2D/3D map rendering with satellite/terrain views. It is quota-limited and intended for testing/prototyping, not production.

Create `frontend/.env` from `frontend/.env.example` and set:

```env
VITE_GOOGLE_MAPS_DEMO_KEY=YOUR_DEMO_KEY
```

The RIFT frontend uses the real 3D map service at runtime. It does not download or redistribute the underlying Google city meshes.

## 2. Open-Meteo — weather inputs

No API key is required for the non-commercial free API. RIFT uses it for rainfall, precipitation, wind speed, pressure, and elevation inputs.

No configuration is needed.

## 3. USGS Earthquake API

No API key is required for the earthquake event catalog. RIFT uses observed earthquake events around the selected region.

No configuration is needed.

Important: USGS is an event catalog, not an earthquake prediction API.

## 4. OpenStreetMap / Overpass

RIFT queries public OpenStreetMap data through Overpass for critical facilities such as hospitals, fire stations, police, shelters, substations, pumping stations, and water facilities.

No API key is required. Public Overpass instances are shared infrastructure, so RIFT keeps queries small.

## 5. OSRM routing

RIFT uses the public OSRM demo server for hackathon routing. No API key is required.

The OSRM demo server is shared and asks clients to keep usage reasonable; RIFT caches routes and throttles requests to approximately one request per second.

For production, self-host OSRM or use a paid/managed routing provider.

## Environment files

Project root `.env`:

```env
RIFT_USER_AGENT=RIFT-Hackathon-Disaster-Simulator/1.0
OVERPASS_URL=https://overpass-api.de/api/interpreter
OSRM_URL=https://router.project-osrm.org/route/v1
```

Frontend `frontend/.env`:

```env
VITE_GOOGLE_MAPS_DEMO_KEY=YOUR_GOOGLE_MAPS_DEMO_KEY
VITE_ML_API_URL=http://127.0.0.1:8000
```

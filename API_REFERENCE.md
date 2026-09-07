# RIFT API Reference — No-Billing Hackathon Stack

## Frontend world

`VITE_GOOGLE_MAPS_DEMO_KEY`

Google Maps JavaScript API Maps Demo Key. Google currently documents this as a no-cost, quota-limited prototype key that supports selected Maps JavaScript features, including 2D/3D map rendering with satellite/terrain views.

## Backend external services

### Weather

`POST /external/weather`

Provider: Open-Meteo

No API key.

### Earthquakes

`POST /external/earthquakes`

Provider: USGS Earthquake Catalog

No API key.

### Critical facilities

`POST /external/critical-places`

Provider: OpenStreetMap / Overpass

No API key.

### Routing

`POST /external/route`

Provider: OSRM public demo server backed by OpenStreetMap.

No API key for the public demo endpoint. Requests are cached and throttled in RIFT because the public demo service is shared infrastructure.

### ML

`POST /predict/flood`
`POST /predict/cyclone`
`POST /predict/earthquake`
`POST /predict/infrastructure`

Provider: local RIFT FastAPI service with the included `.joblib` models.

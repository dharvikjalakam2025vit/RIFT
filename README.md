# RIFT — Real 3D World + ML Disaster Simulation

RIFT is a hackathon prototype that combines a real-world 3D map with a locally served ML stack for disaster-risk and infrastructure-impact simulations.

<!-- The repository layout below mirrors the deployable project shape. -->

## What is in this repository

```text
RIFT_ML_Deployable/
├── backend/
│   ├── app.py
│   ├── external_services.py
│   ├── model_loader.py
│   └── schemas*.py
├── frontend/
│   ├── index.html
│   ├── package.json
│   └── src/
├── ml/
│   ├── data/
│   ├── metrics/
│   ├── models/
│   └── training/
├── tests/
├── FREE_APIS_SETUP.md
├── INTEGRATION.md
├── DEPLOYMENT.md
└── requirements.txt
```

## API stack

### World / 3D

Google Maps JavaScript API 3D with a **Maps Demo Key** for no-cost prototyping of supported Maps JavaScript features.

### Weather

Open-Meteo. No API key is required for the non-commercial free API used by this prototype.

### Earthquakes

USGS earthquake event service. No API key is required.

### Critical facilities

OpenStreetMap via Overpass. No API key is required for the public endpoint; keep requests small.

### Routing

OSRM public demo server. No API key is required. RIFT caches and throttles requests for the shared service.

## Backend setup

```powershell
python -m venv .venv
.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Open:

```text
http://127.0.0.1:8000/docs
```

## Frontend setup

Create:

```text
frontend/.env
```

from:

```text
frontend/.env.example
```

Set:

```env
VITE_GOOGLE_MAPS_DEMO_KEY=YOUR_GOOGLE_MAPS_DEMO_KEY
VITE_ML_API_URL=http://127.0.0.1:8000
```

Then:

```powershell
cd frontend
npm install
npm run dev
```

## Existing ML artifacts

The package includes the existing prototype-trained artifacts:

- `ml/models/flood_risk_v1.joblib`
- `ml/models/cyclone_impact_v1.joblib`
- `ml/models/earthquake_impact_v1.joblib`
- `ml/models/infrastructure_vulnerability_v1.joblib`

Their original demo training data is not a scientifically validated operational disaster dataset.

## Runtime flow

```text
REAL 3D WORLD
    ↓
LOCATION
    ↓
WEATHER / EARTHQUAKE / FACILITY DATA
    ↓
RIFT ML MODEL
    ↓
RISK / IMPACT SCORE
    ↓
DISASTER SIMULATION
    ↓
INFRASTRUCTURE IMPACT
    ↓
OSRM ROUTING
    ↓
RESCUE / EVACUATION
```

## Scientific scope

This is a simulation / decision-support prototype. ML scores, simulated flood/cyclone/earthquake impacts, infrastructure status, evacuation values, and response times must not be presented as certified public-safety forecasts.


## Phase 3 — ML integration

The Review 2 Phase 3 build uses the existing trained `flood_risk_v1` artifact with real Open-Meteo inputs and a real elevation grid. The frontend builds the exact model feature schema, calls FastAPI, maps the returned score into a documented flood scenario intensity, and then runs the spatial flood simulation. Critical-place inspection can additionally call `infrastructure_vulnerability_v1`.

Model explanation: `GET /models/flood_risk_v1/explain`.

## Review 2 Phase 4

Phase 4 adds rescue routing, dynamic rerouting, a lightweight procedural emergency vehicle, aggregate evacuation/shelter analysis, response dashboard, and the one-click Review 2 demo. See `PHASE4_COMPLETE.md`.

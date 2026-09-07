# RIFT — Free API + Real 3D World + Existing ML Integration

The project deliberately avoids rebuilding the Earth and cities procedurally.

The browser loads Google's 3D Maps service at runtime and RIFT draws simulation/response overlays and command-center UI around the real-world view.

## Runtime stack

- Google Maps JavaScript 3D Map — real-world 3D map rendering
- Open-Meteo — weather/environment inputs; no API key for non-commercial use
- USGS — observed earthquake event catalog; no API key
- OpenStreetMap / Overpass — critical infrastructure discovery; no API key
- OSRM demo server — routing using OpenStreetMap data; no API key for the public demo service
- Existing RIFT FastAPI + trained ML artifacts — local model inference

## Data flow

```text
Google 3D world
      ↓
selected RIFT location
      ↓
Open-Meteo / USGS / OSM
      ↓
existing ML model
      ↓
risk / impact estimate
      ↓
RIFT disaster simulation overlay
      ↓
infrastructure impact
      ↓
OSRM response route
      ↓
evacuation / rescue visualization
```

## API credentials

Only the browser-facing Google Maps Demo Key needs to be supplied for the no-billing demo stack.

Frontend:

```env
VITE_GOOGLE_MAPS_DEMO_KEY=YOUR_GOOGLE_MAPS_DEMO_KEY
VITE_ML_API_URL=http://127.0.0.1:8000
```

No weather, earthquake, Overpass, or OSRM key is required by the current adapters.

## Run

### Backend

```powershell
python -m venv .venv
.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

### Frontend

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`.

## Important behavior

- If Google 3D cannot load, RIFT keeps its UI alive and shows an error instead of generating a replacement city.
- If an external weather/earthquake/facility provider fails, the local ML/simulation layer can still be used with fallback values where implemented.
- The OSRM public demo server is not a production SLA; it is only intended for reasonable hackathon use.
- Google 3D data is rendered from Google's service and is not scraped into the repository.

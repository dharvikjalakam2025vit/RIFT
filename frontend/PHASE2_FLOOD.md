# RIFT Review 2 — Phase 2 Flood Simulation

This phase keeps MapTiler as the real-world map/terrain/building base and adds a RIFT flood simulation overlay.

## Data flow

Open-Meteo weather → RIFT flood-risk model → deterministic flood simulation using an elevation grid → flood mask → affected-road overlay → critical infrastructure exposure.

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

Create `frontend/.env` from `.env.example` and add your MapTiler API key.

## Flood behavior

The flood grid uses real-world elevation values returned by the Open-Meteo Elevation API. The API documents the elevation source as Copernicus DEM GLO-90 at 90 m resolution and supports up to 100 coordinates per request, so the frontend batches the grid requests.

The flood propagation is intentionally a hackathon prototype: the ML score controls scenario severity while the simulator computes water depth from the elevation field, rainfall input, drainage capacity, and deterministic neighborhood smoothing.

## Review 2 test

1. Open Mumbai.
2. Wait for elevation/context to show READY.
3. Press START FLOOD SIMULATION.
4. Press PLAY.
5. Watch the flood mask expand.
6. Watch affected roads turn amber/red.
7. Click a critical-facility marker to inspect exposure.
8. Use timeline controls to jump between T-120 and T+60.
9. RESET.

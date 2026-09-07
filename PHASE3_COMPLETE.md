# RIFT Review 2 — Phase 3 Complete

## What changed

Phase 3 integrates the existing trained RIFT ML models into the real-world MapTiler flood simulation without replacing the real-world map.

### ML flow

Open-Meteo weather + real elevation grid + deterministic city context
→ `flood_risk_v1.joblib`
→ model risk score
→ documented `scenarioIntensity`
→ `runoffMultiplier`
→ existing `FloodSimulation`
→ flood GeoJSON
→ affected roads
→ infrastructure exposure.

### Exact flood feature contract

The frontend now builds the feature payload from `frontend/src/featureBuilder.js` using the exact feature names expected by the trained artifact:

- `rainfall_mm`
- `cumulative_rainfall_mm`
- `elevation_m`
- `slope_deg`
- `drainage_capacity`
- `river_discharge_m3s`
- `water_level_m`
- `population_density`
- `historical_flood`
- `flood_control_infrastructure`
- `urban`
- `soil_type`

The backend expands categorical soil values into the one-hot feature columns stored with the artifact.

### ML → simulation mapping

`scenarioIntensity = clamp(model score, 0, 1)`

`runoffMultiplier = 1 + 0.65 * scenarioIntensity`

The multiplier affects the existing deterministic flood engine. The ML model never draws the water layer itself.

### Infrastructure ML

Selecting a critical place can call the existing `infrastructure_vulnerability_v1` endpoint. The selected facility can display the returned vulnerability score/class alongside the directly simulated water-depth status.

### Explainability

`GET /models/{model_name}/explain` returns tree-model feature importances from the trained artifact. The UI displays the top flood features after a successful flood prediction.

### Honest fallback

If the ML API is unreachable, the UI labels the state `DEMO FALLBACK` and runs the deterministic simulation using fallback scenario severity. It does not claim a trained-model prediction in that mode.

## Validation

Backend tests: **7 passed**.

JavaScript syntax checks passed for the modified non-JSX modules.

The browser-side Vite build was not run in this environment, so local `npm install` / `npm run dev` remains the final runtime check.

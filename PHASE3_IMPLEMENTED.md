# RIFT Review 2 — Phase 3 ML Integration

Phase 3 integrates the existing trained models into the real-world MapTiler flood scenario.

## Flow

Observed Open-Meteo weather + real elevation grid + deterministic city context -> `flood_risk_v1` -> risk score -> documented scenario-intensity mapping -> `FloodSimulation` -> flood GeoJSON/road impact -> optional `infrastructure_vulnerability_v1` inspection.

## Frontend additions

- `frontend/src/featureBuilder.js`: builds the exact flood feature contract expected by the trained artifact and computes terrain summary.
- `frontend/src/predictionClient.js`: small dedicated ML client.
- `App.jsx`: wires terrain-aware features, ML risk, scenario intensity, model explainability and infrastructure vulnerability on facility inspection.

## Backend additions

- `GET /models/{model_name}/explain`: returns tree-model feature importances from the trained artifact.
- Existing `/predict/flood`, `/predict/infrastructure`, and `/scenario/analyze` remain the inference contracts.

## ML -> simulation mapping

`scenarioIntensity = clamp(ML score, 0, 1)` and `runoffMultiplier = 1 + 0.65 * scenarioIntensity`. The multiplier changes the deterministic flood engine input; the ML model never directly draws the water layer.

## Fallback

If the ML API is unavailable, the UI explicitly switches to `DEMO FALLBACK` and runs the deterministic flood simulation. It does not claim a model prediction in that state.

## Model explainability

For the Random Forest flood model, the backend exposes top feature importances and the frontend shows the top three after a successful prediction.

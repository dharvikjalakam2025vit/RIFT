# RIFT ML-only six phases

## Phase 1 — Data acquisition & provenance
Define schemas and sources. Keep observed data separate from simulated/demo fixtures. Record source, license, and target definition.

## Phase 2 — Data validation & preprocessing
Validate columns, handle missing values, encode categorical fields, and fit preprocessing only on the training split.

## Phase 3 — Feature engineering
Create hazard-specific features for flood, cyclone, earthquake-impact, and infrastructure-vulnerability models.

## Phase 4 — Training
Train deterministic baseline/final tree models. Save the preprocessing + estimator together in each artifact and version models.

## Phase 5 — Evaluation
Evaluate only on held-out data. Store metrics and model cards. Never claim accuracy that was not measured.

## Phase 6 — Deployment & integration
Expose models through FastAPI, validate input with Pydantic, add health/model endpoints, and connect the React simulation with HTTP.

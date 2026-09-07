# RIFT Review 2 — Phase 1: MapTiler Real-World 3D World

Phase 1 replaces the old Google 3D Maps integration with MapTiler SDK JS. The world is rendered by the map provider; RIFT only adds its own incident markers and future disaster overlays.

## Setup

1. Copy `frontend/.env.example` to `frontend/.env`.
2. Set `VITE_MAPTILER_API_KEY` to your own MapTiler Cloud key.
3. Keep `VITE_ML_API_URL=http://127.0.0.1:8000` for the local ML backend.
4. From `frontend/`, run `npm install` and then `npm run dev`.

## Phase 1 checks

- 3D globe loads at a global view.
- Globe can be rotated, zoomed, and pitched.
- 3D terrain is enabled when supported by the style.
- City-level views expose real mapped roads and 3D building extrusions.
- STREETS / SATELLITE toggle works.
- GLOBE / CITY 3D projection toggle works.
- Mumbai, Delhi, Bengaluru, New York, New Orleans, Tokyo, Guangzhou, Shenzhen, and Nepal can be selected.
- Location selection flies the camera to the chosen place.
- The existing ML backend remains separate and available.

## API key note

Do not commit `frontend/.env`. The example file contains only a placeholder.

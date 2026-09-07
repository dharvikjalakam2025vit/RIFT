from __future__ import annotations

import math
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"
USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
OVERPASS_URLS = [
    os.getenv("OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
    os.getenv("OVERPASS_FALLBACK_URL", "https://overpass.kumi.systems/api/interpreter"),
]
OSRM_URL = os.getenv("OSRM_URL", "https://router.project-osrm.org/route/v1")
APP_USER_AGENT = os.getenv(
    "RIFT_USER_AGENT",
    "RIFT-Hackathon-Disaster-Simulator/1.1 (local prototype; contact project owner)",
)

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": APP_USER_AGENT})

_last_osrm_request = 0.0
_route_cache: dict[tuple[Any, ...], dict[str, Any]] = {}
_weather_cache: dict[tuple[Any, ...], tuple[float, dict[str, Any]]] = {}
_elevation_cache: dict[tuple[Any, ...], tuple[float, dict[str, Any]]] = {}
_places_cache: dict[tuple[Any, ...], tuple[float, dict[str, Any]]] = {}

CACHE_TTL_WEATHER = 120
CACHE_TTL_ELEVATION = 3600
CACHE_TTL_PLACES = 900


def _cached(cache: dict, key: tuple[Any, ...], ttl: float):
    item = cache.get(key)
    if not item:
        return None
    created, value = item
    if time.monotonic() - created > ttl:
        cache.pop(key, None)
        return None
    return value


def _put(cache: dict, key: tuple[Any, ...], value: dict[str, Any]):
    cache[key] = (time.monotonic(), value)
    return value


def get_weather(latitude: float, longitude: float) -> dict[str, Any]:
    key = (round(latitude, 3), round(longitude, 3))
    cached = _cached(_weather_cache, key, CACHE_TTL_WEATHER)
    if cached is not None:
        result = dict(cached)
        result["cached"] = True
        return result

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "temperature_2m,precipitation,rain,wind_speed_10m,surface_pressure",
        "hourly": "precipitation,rain,wind_speed_10m,surface_pressure",
        "forecast_days": 1,
        "timezone": "UTC",
    }
    r = SESSION.get(OPEN_METEO_URL, params=params, timeout=20)
    r.raise_for_status()
    data = r.json()

    current = data.get("current", {}) or {}
    hourly = data.get("hourly", {}) or {}

    def current_or_first(current_key: str, hourly_key: str, default: float = 0.0) -> float:
        value = current.get(current_key)
        if value is not None:
            return float(value)
        arr = hourly.get(hourly_key) or []
        return float(arr[0]) if arr else default

    result = {
        "source": "Open-Meteo",
        "latitude": latitude,
        "longitude": longitude,
        "elevation_m": float(data.get("elevation") or 0.0),
        "temperature_c": current_or_first("temperature_2m", "temperature_2m", 0.0),
        "precipitation_mm": current_or_first("precipitation", "precipitation", 0.0),
        "rain_mm": current_or_first("rain", "rain", 0.0),
        "wind_speed_10m_kmh": current_or_first("wind_speed_10m", "wind_speed_10m", 0.0),
        "surface_pressure_hpa": current_or_first("surface_pressure", "surface_pressure", 1013.25),
        "raw": data,
        "cached": False,
    }
    return _put(_weather_cache, key, result)


def get_elevation(latitude: list[float], longitude: list[float]) -> dict[str, Any]:
    if len(latitude) != len(longitude) or not latitude:
        raise ValueError("latitude and longitude arrays must be non-empty and equal length")
    if len(latitude) > 100:
        raise ValueError("Open-Meteo elevation requests are limited to 100 coordinates per request")

    rounded_lat = tuple(round(float(v), 6) for v in latitude)
    rounded_lng = tuple(round(float(v), 6) for v in longitude)
    key = (rounded_lat, rounded_lng)
    cached = _cached(_elevation_cache, key, CACHE_TTL_ELEVATION)
    if cached is not None:
        result = dict(cached)
        result["cached"] = True
        return result

    r = SESSION.get(
        OPEN_METEO_ELEVATION_URL,
        params={"latitude": ",".join(map(str, rounded_lat)), "longitude": ",".join(map(str, rounded_lng))},
        timeout=25,
    )
    r.raise_for_status()
    data = r.json()
    elevations = [float(v) for v in (data.get("elevation") or [])]
    if len(elevations) != len(latitude):
        raise RuntimeError("Elevation response length does not match request")
    return _put(
        _elevation_cache,
        key,
        {
            "source": "Open-Meteo Elevation API / Copernicus DEM GLO-90",
            "elevation_m": elevations,
            "count": len(elevations),
            "cached": False,
        },
    )


def get_earthquakes(
    latitude: float,
    longitude: float,
    radius_km: float = 500.0,
    days: int = 30,
    min_magnitude: float = 3.5,
) -> dict[str, Any]:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=max(1, min(days, 365)))
    params = {
        "format": "geojson",
        "starttime": start.strftime("%Y-%m-%dT%H:%M:%S"),
        "endtime": end.strftime("%Y-%m-%dT%H:%M:%S"),
        "latitude": latitude,
        "longitude": longitude,
        "maxradiuskm": radius_km,
        "minmagnitude": min_magnitude,
        "orderby": "time",
        "limit": 50,
    }
    r = SESSION.get(USGS_URL, params=params, timeout=20)
    r.raise_for_status()
    data = r.json()

    events = []
    for feature in data.get("features", []):
        coords = feature.get("geometry", {}).get("coordinates", [])
        props = feature.get("properties", {})
        if len(coords) >= 3:
            events.append(
                {
                    "id": feature.get("id"),
                    "longitude": coords[0],
                    "latitude": coords[1],
                    "depth_km": coords[2],
                    "magnitude": props.get("mag"),
                    "place": props.get("place"),
                    "time": props.get("time"),
                    "url": props.get("url"),
                }
            )
    return {"source": "USGS", "events": events}


def _respect_osrm_rate_limit() -> None:
    global _last_osrm_request
    now = time.monotonic()
    wait = 1.0 - (now - _last_osrm_request)
    if wait > 0:
        time.sleep(wait)
    _last_osrm_request = time.monotonic()


def get_route(
    start_lon: float,
    start_lat: float,
    end_lon: float,
    end_lat: float,
    profile: str = "driving",
) -> dict[str, Any]:
    cache_key = (
        round(start_lon, 6), round(start_lat, 6),
        round(end_lon, 6), round(end_lat, 6), profile,
    )
    if cache_key in _route_cache:
        cached = dict(_route_cache[cache_key])
        cached["cached"] = True
        return cached

    safe_profile = "driving" if profile not in {"driving", "foot", "bike"} else profile
    _respect_osrm_rate_limit()

    url = f"{OSRM_URL}/{safe_profile}/{start_lon},{start_lat};{end_lon},{end_lat}"
    params = {
        "overview": "full",
        "geometries": "geojson",
        "alternatives": "true",
        "steps": "true",
    }
    r = SESSION.get(url, params=params, timeout=25, headers={"Referer": "http://localhost:5173/"})
    r.raise_for_status()
    data = r.json()

    if data.get("code") != "Ok" or not data.get("routes"):
        raise RuntimeError(f"OSRM returned {data.get('code', 'unknown error')}")

    primary = data["routes"][0]
    result = {
        "source": "OSRM / OpenStreetMap",
        "geometry": primary.get("geometry", {}).get("coordinates", []),
        "distance_m": primary.get("distance"),
        "duration_s": primary.get("duration"),
        "alternatives": [
            {
                "geometry": route.get("geometry", {}).get("coordinates", []),
                "distance_m": route.get("distance"),
                "duration_s": route.get("duration"),
            }
            for route in data.get("routes", [])[1:3]
        ],
        "warning": None,
        "cached": False,
        "attribution": "Routing: OSRM / OpenStreetMap",
    }
    _route_cache[cache_key] = result
    return result


def _normalize_osm_element(element: dict[str, Any], fallback_index: int) -> dict[str, Any] | None:
    tags = element.get("tags", {}) or {}
    center = element.get("center", {}) or {}
    lat = element.get("lat", center.get("lat"))
    lon = element.get("lon", center.get("lon"))
    if lat is None or lon is None:
        return None

    amenity = tags.get("amenity")
    emergency = tags.get("emergency")
    power = tags.get("power")
    man_made = tags.get("man_made")
    waterway = tags.get("waterway")

    if amenity == "hospital":
        kind = "hospital"
    elif amenity == "fire_station":
        kind = "fire_station"
    elif amenity == "police":
        kind = "police"
    elif emergency == "shelter" or amenity in {"shelter", "community_centre"} or tags.get("social_facility") == "shelter":
        kind = "shelter"
    elif power == "substation":
        kind = "substation"
    elif man_made == "pumping_station" or waterway == "drain":
        kind = "drainage"
    elif man_made in {"water_tower", "water_works"} or tags.get("water"):
        kind = "water_facility"
    else:
        return None

    name = tags.get("name") or f"{kind.replace('_', ' ').title()} {fallback_index}"
    return {
        "id": str(element.get("id", f"osm-{fallback_index}")),
        "name": name,
        "type": kind,
        "lat": float(lat),
        "lng": float(lon),
        "source": "OpenStreetMap / Overpass",
    }


def _fallback_places(latitude: float, longitude: float) -> dict[str, Any]:
    offsets = [
        (0.010, 0.012, "hospital", "Simulation Hospital"),
        (-0.009, 0.010, "fire_station", "Simulation Fire Station"),
        (0.006, -0.013, "police", "Simulation Police Station"),
        (-0.013, -0.008, "shelter", "Simulation Shelter"),
        (0.014, -0.006, "substation", "Simulation Substation"),
        (-0.004, 0.015, "drainage", "Simulation Drainage Node"),
        (0.003, -0.004, "drainage", "Simulation Pump Node"),
    ]
    places = [
        {
            "id": f"demo-{i+1}",
            "name": name,
            "type": kind,
            "lat": latitude + dlat,
            "lng": longitude + dlng,
            "source": "RIFT deterministic simulation fallback",
            "simulationOnly": True,
        }
        for i, (dlat, dlng, kind, name) in enumerate(offsets)
    ]
    return {
        "source": "RIFT deterministic simulation fallback",
        "places": places,
        "fallback": True,
        "attribution": "Simulation facilities; not live infrastructure data",
    }


def get_critical_places(latitude: float, longitude: float, radius_m: float = 5000.0) -> dict[str, Any]:
    around = int(min(max(radius_m, 500), 8000))
    key = (round(latitude, 3), round(longitude, 3), around)
    cached = _cached(_places_cache, key, CACHE_TTL_PLACES)
    if cached is not None:
        result = dict(cached)
        result["cached"] = True
        return result

    query = f"""
    [out:json][timeout:18];
    (
      nwr(around:{around},{latitude},{longitude})[amenity=hospital];
      nwr(around:{around},{latitude},{longitude})[amenity=fire_station];
      nwr(around:{around},{latitude},{longitude})[amenity=police];
      nwr(around:{around},{latitude},{longitude})[amenity=shelter];
      nwr(around:{around},{latitude},{longitude})[emergency=shelter];
      nwr(around:{around},{latitude},{longitude})[power=substation];
      nwr(around:{around},{latitude},{longitude})[man_made=pumping_station];
      nwr(around:{around},{latitude},{longitude})[man_made=water_works];
    );
    out center tags;
    """

    last_error = None
    for url in OVERPASS_URLS:
        try:
            r = SESSION.post(url, data=query, timeout=25)
            if r.status_code == 429:
                last_error = RuntimeError(f"Overpass rate limited at {url}")
                continue
            r.raise_for_status()
            elements = r.json().get("elements", [])
            places = []
            for idx, element in enumerate(elements, start=1):
                normalized = _normalize_osm_element(element, idx)
                if normalized:
                    places.append(normalized)
            if places:
                return _put(
                    _places_cache,
                    key,
                    {
                        "source": "OpenStreetMap / Overpass",
                        "places": places,
                        "fallback": False,
                        "cached": False,
                        "attribution": "Critical facilities: OpenStreetMap contributors",
                    },
                )
            last_error = RuntimeError("No matching critical facilities returned")
        except Exception as exc:
            last_error = exc

    fallback = _fallback_places(latitude, longitude)
    fallback["providerError"] = str(last_error) if last_error else "Unknown provider error"
    return _put(_places_cache, key, fallback)

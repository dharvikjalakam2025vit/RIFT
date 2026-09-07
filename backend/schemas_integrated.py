from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field

class LocationRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)

class RouteRequest(LocationRequest):
    end_latitude: float = Field(..., ge=-90, le=90)
    end_longitude: float = Field(..., ge=-180, le=180)
    profile: str = "driving-car"

class ScenarioRequest(BaseModel):
    hazard_type: Literal["flood", "cyclone", "earthquake", "infrastructure"]
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    flood: Optional[dict] = None
    cyclone: Optional[dict] = None
    earthquake: Optional[dict] = None
    infrastructure: Optional[dict] = None

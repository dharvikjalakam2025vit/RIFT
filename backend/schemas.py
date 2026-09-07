from pydantic import BaseModel, Field
from typing import Literal

class FloodInput(BaseModel):
    rainfall_mm: float = Field(..., ge=0)
    cumulative_rainfall_mm: float = Field(..., ge=0)
    elevation_m: float
    slope_deg: float = Field(..., ge=0)
    drainage_capacity: float = Field(..., ge=0, le=1)
    river_discharge_m3s: float = Field(..., ge=0)
    water_level_m: float = Field(..., ge=0)
    population_density: float = Field(..., ge=0)
    historical_flood: int = Field(..., ge=0, le=1)
    flood_control_infrastructure: int = Field(..., ge=0, le=1)
    urban: int = Field(..., ge=0, le=1)
    soil_type: Literal['sandy','clay','loam','silt','peat']

class CycloneInput(BaseModel):
    current_wind_kts: float = Field(..., ge=0)
    pressure_hpa: float = Field(..., ge=850, le=1100)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    storm_speed_kts: float = Field(..., ge=0)
    storm_direction_deg: float = Field(..., ge=0, le=360)
    rainfall_mm_h: float = Field(..., ge=0)
    distance_to_coast_km: float = Field(..., ge=0)

class EarthquakeInput(BaseModel):
    magnitude: float = Field(..., ge=0)
    depth_km: float = Field(..., ge=0)
    distance_to_target_km: float = Field(..., ge=0)
    site_amplification: float = Field(..., ge=0, le=1)
    population_density: float = Field(..., ge=0)
    soil_factor: float = Field(..., ge=0, le=1)

class InfrastructureInput(BaseModel):
    hazard_exposure: float = Field(..., ge=0, le=1)
    elevation_m: float
    asset_age_years: float = Field(..., ge=0)
    criticality: float = Field(..., ge=0, le=1)
    accessibility: float = Field(..., ge=0, le=1)
    power_availability: float = Field(..., ge=0, le=1)
    asset_type: Literal['hospital','bridge','substation','drainage','shelter','fire_station']

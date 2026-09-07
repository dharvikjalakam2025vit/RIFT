"""Phase 3: feature-contract check."""
from pathlib import Path
import pandas as pd
ROOT=Path(__file__).resolve().parents[2]
contracts={
'flood_demo.csv':['rainfall_mm','cumulative_rainfall_mm','elevation_m','slope_deg','drainage_capacity','river_discharge_m3s','water_level_m','population_density','historical_flood','flood_control_infrastructure','urban','soil_type','flood_occurred'],
'cyclone_demo.csv':['current_wind_kts','pressure_hpa','latitude','longitude','storm_speed_kts','storm_direction_deg','rainfall_mm_h','distance_to_coast_km','next_wind_kts'],
'earthquake_demo.csv':['magnitude','depth_km','distance_to_target_km','site_amplification','population_density','soil_factor','impact_score'],
'infrastructure_demo.csv':['hazard_exposure','elevation_m','asset_age_years','criticality','accessibility','power_availability','asset_type','vulnerability_class']}
for f,cols in contracts.items():
    df=pd.read_csv(ROOT/'ml/data'/f,nrows=2); missing=[c for c in cols if c not in df.columns]
    if missing: raise ValueError(f'{f}: missing {missing}')
    print(f, 'feature contract OK')

from datetime import datetime, timezone
import json
from pathlib import Path
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from backend.model_loader import load
from backend.schemas import FloodInput, CycloneInput, EarthquakeInput, InfrastructureInput

ROOT = Path(__file__).resolve().parents[1]
app = FastAPI(title='RIFT ML Inference API', version='1.0.0')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_credentials=True, allow_methods=['*'], allow_headers=['*'])

# Keep the root endpoint lightweight so it doubles as a quick smoke check.
@app.get('/')
def root():
    return {'service': 'RIFT ML Inference API', 'status': 'ok', 'docs': '/docs'}

def _risk_class(score: float) -> str:
    if score >= 0.85: return 'CRITICAL'
    if score >= 0.70: return 'HIGH'
    if score >= 0.50: return 'MODERATE'
    return 'LOW'

def predict(model_name: str, features: dict):
    try:
        bundle = load(model_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    X = pd.DataFrame([features])
    if model_name == 'flood_risk_v1':
        X = pd.get_dummies(X, columns=['soil_type'], dtype=float)
    X = X.reindex(columns=bundle['features'], fill_value=0)
    model = bundle['model']
    raw = model.predict(X)[0]
    if bundle['task'] == 'classification':
        probabilities = model.predict_proba(X)[0]
        score = float(max(probabilities))
        prediction = int(raw)
        return {
            'model': model_name, 'prediction': prediction, 'score': round(score, 4),
            'riskClass': _risk_class(score), 'modelStatus': 'trained', 'simulationUse': True,
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
    score = float(raw)
    normalized = score / 90.0 if model_name == 'cyclone_impact_v1' else score
    return {
        'model': model_name, 'prediction': round(score, 4), 'score': round(max(0.0, min(normalized, 1.0)), 4),
        'riskClass': _risk_class(max(0.0, min(normalized, 1.0))), 'modelStatus': 'trained', 'simulationUse': True,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }

@app.get('/health')
def health():
    model_dir = ROOT / 'ml' / 'models'
    required = ['flood_risk_v1','cyclone_impact_v1','earthquake_impact_v1','infrastructure_vulnerability_v1']
    return {'status': 'ok', 'service': 'rift-ml-api', 'modelsReady': {n:(model_dir/f'{n}.joblib').exists() for n in required}, 'externalProviders': {'weather':'Open-Meteo', 'earthquakes':'USGS', 'criticalPlaces':'OpenStreetMap/Overpass', 'routing':'OSRM'}}

@app.get('/models')
def models():
    metrics_path = ROOT / 'ml' / 'metrics' / 'all_models.json'
    data = json.loads(metrics_path.read_text()) if metrics_path.exists() else {}
    return {'models': [{'name':n, 'trained':(ROOT/'ml/models'/f'{n}.joblib').exists(), 'metrics':m} for n,m in data.items()]}

@app.get('/models/{model_name}/explain')
def model_explain(model_name: str):
    try:
        bundle = load(model_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    model = bundle['model']
    estimator = getattr(model, 'named_steps', {}).get('model')
    importances = getattr(estimator, 'feature_importances_', None)
    if importances is None:
        return {'model': model_name, 'featureImportance': [], 'available': False}
    rows = sorted(
        [{'feature': feature, 'importance': float(value)} for feature, value in zip(bundle['features'], importances)],
        key=lambda item: item['importance'], reverse=True,
    )
    return {'model': model_name, 'featureImportance': rows[:10], 'available': True}

@app.post('/predict/flood')
def predict_flood(inp: FloodInput): return predict('flood_risk_v1', inp.model_dump())
@app.post('/predict/cyclone')
def predict_cyclone(inp: CycloneInput): return predict('cyclone_impact_v1', inp.model_dump())
@app.post('/predict/earthquake')
def predict_earthquake(inp: EarthquakeInput): return predict('earthquake_impact_v1', inp.model_dump())
@app.post('/predict/infrastructure')
def predict_infrastructure(inp: InfrastructureInput): return predict('infrastructure_vulnerability_v1', inp.model_dump())

# ---- Integrated real-world API adapters ----
from backend.external_services import get_weather, get_elevation, get_earthquakes, get_route, get_critical_places
from backend.schemas_integrated import LocationRequest, RouteRequest, ScenarioRequest

@app.post('/external/weather')
def external_weather(req: LocationRequest):
    try:
        return get_weather(req.latitude, req.longitude)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Weather provider unavailable: {exc}')

@app.post('/external/elevation')
def external_elevation(req: dict):
    try:
        latitude = req.get('latitude', [])
        longitude = req.get('longitude', [])
        return get_elevation(latitude, longitude)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Elevation provider unavailable: {exc}')

@app.post('/external/earthquakes')
def external_earthquakes(req: LocationRequest):
    try:
        return get_earthquakes(req.latitude, req.longitude)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'USGS provider unavailable: {exc}')

@app.post('/external/route')
def external_route(req: RouteRequest):
    try:
        return get_route(req.longitude, req.latitude, req.end_longitude, req.end_latitude, req.profile)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Routing provider unavailable: {exc}')

@app.post('/external/critical-places')
def external_critical_places(req: LocationRequest):
    try:
        return get_critical_places(req.latitude, req.longitude)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Places provider unavailable: {exc}')

@app.post('/scenario/analyze')
def scenario_analyze(req: ScenarioRequest):
    try:
        if req.hazard_type == 'flood':
            if req.flood is None:
                raise HTTPException(status_code=422, detail='flood payload is required')
            result = predict('flood_risk_v1', req.flood)
        elif req.hazard_type == 'cyclone':
            if req.cyclone is None:
                raise HTTPException(status_code=422, detail='cyclone payload is required')
            result = predict('cyclone_impact_v1', req.cyclone)
        elif req.hazard_type == 'earthquake':
            if req.earthquake is None:
                raise HTTPException(status_code=422, detail='earthquake payload is required')
            result = predict('earthquake_impact_v1', req.earthquake)
        else:
            if req.infrastructure is None:
                raise HTTPException(status_code=422, detail='infrastructure payload is required')
            result = predict('infrastructure_vulnerability_v1', req.infrastructure)
        return {
            'location': {'latitude': req.latitude, 'longitude': req.longitude},
            'hazardType': req.hazard_type,
            'modelResult': result,
            'simulationContract': {
                'source': 'ML prediction -> simulation overlay',
                'isOperationalForecast': False,
                'disclaimer': 'Prototype decision-support output; not a public-safety forecast.'
            }
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Scenario analysis failed: {exc}')

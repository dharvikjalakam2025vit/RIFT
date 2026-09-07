from pathlib import Path
import json
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)
sample = json.loads(Path('ml/data/sample_inputs.json').read_text(encoding='utf-8'))

def test_health():
    r=client.get('/health'); assert r.status_code==200; assert r.json()['status']=='ok'

def test_flood():
    r=client.post('/predict/flood',json=sample['flood']); assert r.status_code==200; assert 'riskClass' in r.json()

def test_cyclone():
    r=client.post('/predict/cyclone',json=sample['cyclone']); assert r.status_code==200

def test_earthquake():
    r=client.post('/predict/earthquake',json=sample['earthquake']); assert r.status_code==200

def test_infrastructure():
    r=client.post('/predict/infrastructure',json=sample['infrastructure']); assert r.status_code==200


def test_model_explain():
    r=client.get('/models/flood_risk_v1/explain')
    assert r.status_code==200
    body=r.json()
    assert body['available'] is True
    assert len(body['featureImportance']) >= 1


def test_scenario_analyze_flood():
    r=client.post('/scenario/analyze', json={
        'hazard_type':'flood',
        'latitude':19.076,
        'longitude':72.8777,
        'flood': sample['flood']
    })
    assert r.status_code==200
    assert r.json()['modelResult']['model']=='flood_risk_v1'

from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[2]
data=json.loads((ROOT/'ml/metrics/all_models.json').read_text())
for name,m in data.items():
    primary = m.get('f1_weighted', m.get('r2'))
    print(f'{name}: primary_metric={primary}')
print('Metrics are held-out evaluation metrics for the included deterministic demo datasets.')

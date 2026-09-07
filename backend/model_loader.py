from pathlib import Path
import joblib

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / 'ml' / 'models'
CACHE = {}


def load(name: str):
    if name in CACHE:
        return CACHE[name]
    path = MODEL_DIR / f'{name}.joblib'
    if not path.exists():
        raise FileNotFoundError(f'Model artifact missing: {path}')
    CACHE[name] = joblib.load(path)
    return CACHE[name]

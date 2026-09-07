# Deployment checklist

## Local

```bash
python -m venv .venv
# Windows PowerShell
.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
python ml/training/train_all.py
uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

## Docker

```bash
docker build -t rift-ml .
docker run --rm -p 8000:8000 rift-ml
```

## Production notes

Set a restricted CORS allowlist, terminate TLS at the reverse proxy, add authentication if the API is not private, pin exact dependency versions, and replace the prototype training datasets with documented real labelled datasets before making operational claims.

The `.joblib` artifacts contain serialized scikit-learn pipelines. Only load artifacts you trust.

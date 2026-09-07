const API_BASE = import.meta.env.VITE_ML_API_URL || 'http://127.0.0.1:8000';

async function post(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} ${response.status}: ${text}`);
  }
  return response.json();
}

export const predictionClient = {
  flood: (features) => post('/predict/flood', features),
  infrastructure: (features) => post('/predict/infrastructure', features),
  scenario: (payload) => post('/scenario/analyze', payload),
};

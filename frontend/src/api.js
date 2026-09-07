const ML_API = import.meta.env.VITE_ML_API_URL || 'http://localhost:8000';

async function get(path) {
  const response = await fetch(`${ML_API}${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path}: ${response.status} ${text}`);
  }
  return response.json();
}

async function post(path, body) {
  const response = await fetch(`${ML_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path}: ${response.status} ${text}`);
  }
  return response.json();
}

export const ml = {
  flood: (payload) => post('/predict/flood', payload),
  cyclone: (payload) => post('/predict/cyclone', payload),
  earthquake: (payload) => post('/predict/earthquake', payload),
  infrastructure: (payload) => post('/predict/infrastructure', payload),
  explain: (modelName) => get(`/models/${modelName}/explain`),
  scenario: (payload) => post('/scenario/analyze', payload),
  weather: (payload) => post('/external/weather', payload),
  elevation: (payload) => post('/external/elevation', payload),
  earthquakes: (payload) => post('/external/earthquakes', payload),
  places: (payload) => post('/external/critical-places', payload),
  route: (payload) => post('/external/route', payload),
};

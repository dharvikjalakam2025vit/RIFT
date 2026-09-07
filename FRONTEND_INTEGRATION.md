# RIFT frontend integration

The React/R3F app should treat this service as a prediction backend. The 3D renderer remains separate.

Set in the frontend environment:

```env
VITE_ML_API_URL=http://localhost:8000
```

Example client:

```js
const API = import.meta.env.VITE_ML_API_URL;

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const predictFlood = (x) => post('/predict/flood', x);
export const predictCyclone = (x) => post('/predict/cyclone', x);
export const predictEarthquake = (x) => post('/predict/earthquake', x);
export const predictInfrastructure = (x) => post('/predict/infrastructure', x);
```

Use returned scores to parameterize your existing disaster simulation layer. The backend is intentionally independent from 3D rendering.

const API = import.meta.env.VITE_API_URL || '';

async function request(path, options) {
  const res = await fetch(API + path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  listDocs: () => request('/api/docs/'),
  createDoc: (title) =>
    request('/api/docs/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }),
  getDoc: (id) => request(`/api/docs/${id}/`),
};

export function wsUrl(docId) {
  const base = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  return `${base}/ws/docs/${docId}/`;
}

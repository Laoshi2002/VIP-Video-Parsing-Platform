import { loadSources } from '../lib/sources.js';
import { json } from '../lib/http.js';

export async function onRequestGet() {
  const data = await loadSources();
  return json({ code: 1, parseApis: data.parseApis || [] });
}

import builtinSources from '../../public/sources.json' with { type: 'json' };
import { fetchWithTimeout } from './aggregate.js';

const CACHE_MS = 5 * 60 * 1000;
let cache = { data: null, at: 0 };

export async function loadSources() {
  const remoteUrl = builtinSources.remoteSourceUrl;
  if (remoteUrl) {
    if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
    try {
      const res = await fetchWithTimeout(remoteUrl, 5000);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.cmsSources) && data.cmsSources.length) {
          cache = { data, at: Date.now() };
          return data;
        }
      }
    } catch { /* 回退内置 */ }
  }
  return builtinSources;
}

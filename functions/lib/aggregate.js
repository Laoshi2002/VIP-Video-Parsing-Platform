export async function fetchWithTimeout(url, ms = 5000, fetchImpl = fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function searchSource(source, wd, fetchImpl = fetch, timeoutMs = 5000) {
  try {
    const sep = source.api.includes('?') ? '&' : '?';
    const res = await fetchWithTimeout(
      `${source.api}${sep}ac=videolist&wd=${encodeURIComponent(wd)}`, timeoutMs, fetchImpl);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.code !== 1 || !Array.isArray(data.list)) return [];
    return data.list.map(v => ({
      source_id: source.id,
      source_name: source.name,
      vod_id: String(v.vod_id),
      name: v.vod_name,
      pic: v.vod_pic || '',
      remark: v.vod_remarks || '',
      year: String(v.vod_year || '')
    }));
  } catch {
    return [];
  }
}

export async function aggregateSearch(sources, wd, fetchImpl = fetch, timeoutMs = 5000) {
  const lists = await Promise.all(sources.map(s => searchSource(s, wd, fetchImpl, timeoutMs)));
  return lists.flat();
}

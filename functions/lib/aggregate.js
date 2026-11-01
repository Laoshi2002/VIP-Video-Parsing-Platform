export async function fetchWithTimeout(url, ms = 5000, fetchImpl = fetch, extraHeaders = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    // 部分采集站拦截非浏览器 UA（默认为 Cloudflare-Workers），伪装成浏览器请求
    return await fetchImpl(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        ...extraHeaders,
      },
    });
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

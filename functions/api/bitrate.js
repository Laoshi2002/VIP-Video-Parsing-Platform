import { loadSources } from '../lib/sources.js';
import { fetchWithTimeout } from '../lib/aggregate.js';
import { extractM3u8Episodes } from '../lib/cms.js';
import { json } from '../lib/http.js';

// 相对地址解析：兼容相对路径（xx.m3u8）、绝对路径（/a/b.m3u8）与完整 URL
const absUrl = (u, base) => /^https?:\/\//i.test(u) ? u : new URL(u, base).href;

// 测量某片源某集的码率：主清单选最高档实测分片码率（声明 BANDWIDTH 虚标严重，仅作回退）；单码率清单用首个分片 Range 请求估算
export async function onRequestGet({ request }) {
  const p = new URL(request.url).searchParams;
  const sourceId = p.get('source');
  const vodId = p.get('id');
  const ep = Math.max(0, parseInt(p.get('ep') || '0', 10) || 0);
  if (!sourceId || !vodId) return json({ code: 0, msg: '缺少参数' });
  const { cmsSources } = await loadSources();
  const src = cmsSources.find(s => s.id === sourceId);
  if (!src) return json({ code: 0, msg: '未知片源' });
  try {
    const u = new URL(src.api);
    u.searchParams.set('ac', 'videolist');
    u.searchParams.set('ids', vodId);
    const res = await fetchWithTimeout(u.toString(), 5000);
    if (!res.ok) return json({ code: 0, msg: '片源请求失败' });
    const data = await res.json();
    const vod = data.list && data.list[0];
    if (!vod) return json({ code: 0, msg: '影片不存在' });
    // 与 detail 接口同一套分集解析，保证 ep 索引一致
    const episodes = extractM3u8Episodes(vod.vod_play_url || '');
    const epUrl = episodes[ep] && episodes[ep].url;
    if (!epUrl) return json({ code: 0, msg: '无播放地址' });
    const m3u8Res = await fetchWithTimeout(epUrl, 5000);
    const text = await m3u8Res.text();
    if (text.includes('EXT-X-STREAM-INF')) {
      const lines = text.split('\n').map(s => s.trim());
      let best = { bw: 0, res: '', uri: '' };
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
        const bw = +(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] || 0);
        const res = (lines[i].match(/RESOLUTION=(\d+x\d+)/) || [])[1] || '';
        const uri = lines[i + 1] && !lines[i + 1].startsWith('#') ? lines[i + 1] : '';
        if (bw > best.bw) best = { bw, res, uri };
      }
      let kbps = Math.round(best.bw / 1000);
      let type = 'declared';
      try {
        const varUrl = absUrl(best.uri, epUrl);
        const vText = await (await fetchWithTimeout(varUrl, 5000)).text();
        const vLines = vText.split('\n').map(s => s.trim());
        const vi = vLines.findIndex(s => s && !s.startsWith('#'));
        const dur = (vText.match(/EXTINF:([\d.]+)/) || [])[1];
        if (vi >= 0 && dur) {
          const seg = vLines[vi];
          const segUrl = absUrl(seg, varUrl);
          const segRes = await fetchWithTimeout(segUrl, 5000, fetch, { Range: 'bytes=0-0' });
          const cr = segRes.headers.get('content-range') || '';
          const total = parseInt((cr.match(/\/(\d+)$/) || [])[1] || segRes.headers.get('content-length') || '0', 10);
          if (total > 0) { kbps = Math.round(total * 8 / parseFloat(dur) / 1000); type = 'measured'; }
        }
      } catch { /* 实测失败回退声明值 */ }
      return json({ code: 1, kbps, resolution: best.res, type }, 120);
    }
    const dur = (text.match(/EXTINF:([\d.]+)/) || [])[1];
    const seg = text.split('\n').map(s => s.trim()).find(s => s && !s.startsWith('#'));
    if (!dur || !seg) return json({ code: 0, msg: '清单格式异常' });
    const segUrl = absUrl(seg, epUrl);
    const segRes = await fetchWithTimeout(segUrl, 5000, fetch, { Range: 'bytes=0-0' });
    const cr = segRes.headers.get('content-range') || '';
    const total = parseInt((cr.match(/\/(\d+)$/) || [])[1] || segRes.headers.get('content-length') || '0', 10);
    const kbps = total > 0 ? Math.round(total * 8 / parseFloat(dur) / 1000) : 0;
    return json({ code: 1, kbps, resolution: '', type: 'media' }, 120);
  } catch {
    return json({ code: 0, msg: '测速失败' });
  }
}

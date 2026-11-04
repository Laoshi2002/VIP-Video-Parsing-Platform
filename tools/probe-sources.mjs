// 片源池巡检：逐源测搜索可用性、详情集数、实测码率（分片体积/时长）与 CORS，
// --write 时将前 6 名写入 public/sources.json（供 GitHub Actions 每日自动维护）
// 用法：node tools/probe-sources.mjs [--write]
import { readFile, writeFile } from 'node:fs/promises';
import { extractM3u8Episodes } from '../functions/lib/cms.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ORIGIN = 'https://vvp-probe.example';
const KWS = ['庆余年第二季', '流浪地球2']; // 电影+剧集双关键词，命中任一即视为存活
const TOP_N = 6;
const WRITE = process.argv.includes('--write');
const SRC_PATH = new URL('../public/sources.json', import.meta.url);

// 候选源池（含历史淘汰源，便于自动发现复活源）
const POOL = [
  { id: 'dytt', name: '电影天堂', api: 'https://caiji.dyttzyapi.com/api.php/provide/vod' },
  { id: 'ffzy', name: '非凡资源', api: 'https://api.ffzyapi.com/api.php/provide/vod' },
  { id: 'bfzy', name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod' },
  { id: 'bdzy', name: '百度云资源', api: 'https://api.apibdzy.com/api.php/provide/vod' },
  { id: '360zy', name: '360资源', api: 'https://360zy.com/api.php/provide/vod' },
  { id: 'lzi', name: '量子资源', api: 'https://cj.lziapi.com/api.php/provide/vod' },
  { id: 'jisu', name: '极速资源', api: 'https://jszyapi.com/api.php/provide/vod' },
  { id: 'zuida', name: '最大资源', api: 'https://api.zuidapi.com/api.php/provide/vod' },
  { id: 'tyyszy', name: '天涯资源', api: 'https://tyyszy.com/api.php/provide/vod' },
  { id: 'tyyszyapi', name: '天涯海角', api: 'https://tyyszyapi.com/api.php/provide/vod' },
  { id: 'dbzy', name: '豆瓣资源', api: 'https://dbzy.tv/api.php/provide/vod' },
  { id: 'ruyi', name: '如意资源', api: 'https://cj.rycjapi.com/api.php/provide/vod' },
  { id: 'wwzy', name: '旺旺资源', api: 'https://wwzy.tv/api.php/provide/vod' },
  { id: 'hongniu', name: '红牛资源', api: 'https://www.hongniuzy2.com/api.php/provide/vod' },
  { id: 'hongniu3', name: '红牛资源3', api: 'https://www.hongniuzy3.com/api.php/provide/vod' },
  { id: 'guangsu', name: '光速资源', api: 'https://api.guangsuapi.com/api.php/provide/vod' },
  { id: 'ikun', name: 'iKun资源', api: 'https://ikunzyapi.com/api.php/provide/vod' },
  { id: 'uku88', name: 'U酷资源', api: 'https://api.ukuapi88.com/api.php/provide/vod' },
  { id: 'xinlang', name: '新浪资源', api: 'https://api.xinlangapi.com/xinlangapi.php/provide/vod' },
  { id: 'haitun', name: '海豚资源', api: 'https://hhzyapi.com/api.php/provide/vod' },
  { id: 'jingyu', name: '鲸鱼资源', api: 'https://jyzyapi.com/provide/vod' },
  { id: 'yaya', name: '丫丫资源', api: 'https://cj.yayazy.net/api.php/provide/vod' },
  { id: 'yinghua', name: '樱花资源', api: 'https://m3u8.apiyhzy.com/api.php/provide/vod' },
  { id: 'suoni', name: '索尼资源', api: 'https://suoniapi.com/api.php/provide/vod' },
  { id: 'subo', name: '速博资源', api: 'https://subocaiji.com/api.php/provide/vod' },
  { id: 'jinying', name: '金鹰资源', api: 'https://jinyingzy.com/api.php/provide/vod' },
  { id: 'shandian', name: '闪电资源', api: 'https://sdzyapi.com/api.php/provide/vod' },
  { id: 'wujin', name: '无尽资源', api: 'https://api.wujinapi.cc/api.php/provide/vod' },
  { id: 'niuniu', name: '牛牛资源', api: 'https://api.niuniuzy.me/api.php/provide/vod' },
  { id: 'maotai', name: '茅台资源', api: 'https://caiji.maotaizy.cc/api.php/provide/vod' },
  { id: '1080', name: '1080资源', api: 'https://api.1080zyku.com/inc/apijson.php' },
  { id: 'modu', name: '魔都资源', api: 'https://www.mdzyapi.com/api.php/provide/vod' },
];

async function get(url, ms = 8000, extra = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: c.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', Origin: ORIGIN, ...extra },
      redirect: 'follow',
    });
    return {
      ok: r.ok,
      text: r.ok ? await r.text() : '',
      acao: r.headers.get('access-control-allow-origin') || '',
      cr: r.headers.get('content-range') || '',
      cl: r.headers.get('content-length') || '',
    };
  } catch (e) {
    return { ok: false, err: e.name === 'AbortError' ? 'timeout' : String(e.cause?.code || e.message).slice(0, 40) };
  } finally {
    clearTimeout(t);
  }
}

async function segSize(url) {
  const r = await get(url, 8000, { Range: 'bytes=0-0' });
  if (!r.ok) return 0;
  return r.cr ? parseInt(r.cr.split('/')[1]) || 0 : parseInt(r.cl) || 0;
}

// 收集 (时长, 分片) 对并取中段：首个分片多为极短头部片段，按其体积估码率会严重偏低
function midSeg(lines) {
  const segs = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i] || lines[i].startsWith('#')) continue;
    const m = /#EXTINF:([\d.]+)/.exec(lines[i - 1] || '');
    if (m) segs.push({ dur: parseFloat(m[1]), uri: lines[i] });
  }
  return segs[Math.floor(segs.length / 2)] || null;
}

// 单源单关键词全链路测量：搜索 -> 详情 -> m3u8 主清单最高档 -> 中段分片实测码率
async function measure(s, kw) {
  const r1 = await get(`${s.api}?ac=videolist&wd=${encodeURIComponent(kw)}`);
  if (!r1.ok) return { st: '搜索失败:' + (r1.err || r1.status) };
  let d1; try { d1 = JSON.parse(r1.text); } catch { return { st: '搜索非JSON' }; }
  if (d1.code !== 1 || !Array.isArray(d1.list) || !d1.list.length) return { st: '搜索无结果' };
  const r2 = await get(`${s.api}?ac=videolist&ids=${d1.list[0].vod_id}`);
  if (!r2.ok) return { st: '详情失败' };
  let d2; try { d2 = JSON.parse(r2.text); } catch { return { st: '详情非JSON' }; }
  const v = d2.list && d2.list[0];
  if (!v) return { st: '详情为空' };
  // 与线上 detail 同一套分集解析（跳过分享页组，选 m3u8 最多的播放组）
  const eps = extractM3u8Episodes(v.vod_play_url || '');
  const epUrl = eps[0] && eps[0].url;
  if (!epUrl) return { st: '无m3u8直链', eps: 0 };
  const r3 = await get(epUrl);
  if (!r3.ok) return { st: '清单失败:' + (r3.err || r3.status), eps: eps.length };
  const acao = r3.acao;
  const lines = r3.text.split(/\r?\n/).map(l => l.trim());

  if (r3.text.includes('#EXT-X-STREAM-INF')) {
    let best = { bw: 0, res: '', uri: '' };
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
      const bw = +(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] || 0);
      const res = (lines[i].match(/RESOLUTION=(\d+x\d+)/) || [])[1] || '';
      const uri = lines[i + 1] && !lines[i + 1].startsWith('#') ? lines[i + 1] : '';
      if (bw > best.bw) best = { bw, res, uri };
    }
    if (!best.uri) return { st: '主清单无档位', eps: eps.length, acao };
    const varUrl = new URL(best.uri, epUrl).href;
    const r5 = await get(varUrl);
    if (!r5.ok) return { st: '子清单失败', eps: eps.length, acao };
    const vlines = r5.text.split(/\r?\n/).map(l => l.trim());
    const mid = midSeg(vlines);
    if (!mid) return { st: '子清单无分片', eps: eps.length, acao };
    const size = await segSize(new URL(mid.uri, varUrl).href);
    return { st: 'OK', kbps: size && mid.dur ? Math.round(size * 8 / mid.dur / 1000) : 0, res: best.res, eps: eps.length, acao };
  }

  if (r3.text.includes('#EXTINF')) {
    const mid = midSeg(lines);
    if (!mid) return { st: '清单无分片', eps: eps.length, acao };
    const size = await segSize(new URL(mid.uri, epUrl).href);
    return { st: 'OK', kbps: size && mid.dur ? Math.round(size * 8 / mid.dur / 1000) : 0, res: '', eps: eps.length, acao };
  }

  return { st: '清单异常', eps: eps.length, acao };
}

async function probeSource(s) {
  const t0 = Date.now();
  const tries = [await measure(s, KWS[0]), await measure(s, KWS[1])];
  const ms = Date.now() - t0;
  const oks = tries.filter(r => r.st === 'OK');
  if (!oks.length) return { ...s, st: tries[0].st, kbps: 0, res: '', eps: 0, cors: false, ms };
  const best = oks.reduce((a, b) => ((b.kbps || 0) > (a.kbps || 0) ? b : a));
  // 浏览器端 hls.js 直连播放必须支持 CORS，无 CORS 不参与排名
  const corsOk = oks.some(r => r.acao === '*' || r.acao === ORIGIN);
  return {
    ...s,
    st: corsOk ? 'OK' : '无CORS(不可直连)',
    kbps: best.kbps || 0, res: best.res || '', eps: best.eps || 0, cors: corsOk, ms,
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

const t0 = Date.now();
const results = await mapLimit(POOL, 6, probeSource);
// 排序按画质评分：码率 × min(分辨率高度,1080)/1080，伪1080（如1080x608）码率虚高也不该占前排；分辨率未知按码率原值计
const qScore = r => {
  const h = r.res ? parseInt(r.res.split('x')[1], 10) || 0 : 0;
  return r.kbps * Math.min(h || 1080, 1080) / 1080;
};
const ok = results.filter(r => r.st === 'OK').sort((a, b) => qScore(b) - qScore(a));
const fails = results.filter(r => r.st !== 'OK');

let report = `## 片源巡检报告 ${new Date().toISOString()}\n\n`;
report += `探测 ${POOL.length} 源，可用 ${ok.length} 个，耗时 ${Math.round((Date.now() - t0) / 1000)}s\n\n`;
report += '| # | 片源 | 实测码率 | 分辨率 | 集数 | CORS | 探测耗时 |\n|---|---|---|---|---|---|---|\n';
report += ok.map((r, i) => `| ${i + 1} | ${r.name}(${r.id}) | ${r.kbps} kbps | ${r.res || '-'} | ${r.eps} | ✓ | ${r.ms}ms |`).join('\n') + '\n\n';
if (fails.length) {
  report += `### 不可用（${fails.length} 个）\n\n` + fails.map(r => `- ${r.name}(${r.id})：${r.st}`).join('\n') + '\n';
}

if (WRITE) {
  if (ok.length < 3) {
    report += '\n> ⚠️ 可用源不足 3 个，疑似探测环境网络异常，保留现有 sources.json 不变\n';
    console.log(report);
    process.exit(1);
  }
  const cur = JSON.parse(await readFile(SRC_PATH, 'utf8'));
  const next = ok.slice(0, TOP_N).map(s => ({ id: s.id, name: s.name, api: s.api }));
  if (JSON.stringify(next.map(s => s.id)) !== JSON.stringify(cur.cmsSources.map(s => s.id))) {
    await writeFile(SRC_PATH, JSON.stringify({ remoteSourceUrl: cur.remoteSourceUrl || '', cmsSources: next }, null, 2) + '\n');
    report += `\n> ✅ sources.json 已更新：${next.map(s => s.id).join(' → ')}\n`;
  } else {
    report += `\n> ✅ 排名无变化（${cur.cmsSources.map(s => s.id).join(' → ')}）\n`;
  }
}
console.log(report);

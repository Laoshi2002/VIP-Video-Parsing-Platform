import { loadSources } from '../lib/sources.js';
import { fetchWithTimeout } from '../lib/aggregate.js';
import { json } from '../lib/http.js';

// 首页导航分类（对应暴风资源 type_id；已排除福利/理论等分类）
export const HOME_CATEGORIES = [
  { group: '电影', subs: [[21, '动作片'], [22, '喜剧片'], [24, '科幻片'], [25, '爱情片'], [23, '恐怖片'], [26, '剧情片'], [27, '战争片'], [28, '纪录片']] },
  { group: '剧集', subs: [[31, '国产剧'], [32, '欧美剧'], [33, '香港剧'], [34, '韩国剧'], [35, '台湾剧'], [36, '日本剧'], [37, '海外剧'], [38, '泰国剧']] },
  { group: '动漫', subs: [[40, '国产动漫'], [41, '日韩动漫'], [42, '欧美动漫']] },
  { group: '综艺', subs: [[46, '大陆综艺'], [47, '港台综艺'], [48, '日韩综艺'], [49, '欧美综艺']] },
  { group: '短剧', subs: [[67, '现代言情'], [72, '古装仙侠'], [68, '反转爽文'], [71, '都市脑洞']] },
];

export function normalizeHomeItem(v) {
  return {
    id: String(v.vod_id ?? ''),
    name: String(v.vod_name ?? ''),
    pic: v.vod_pic || '',
    remark: v.vod_remarks || '',
    year: String(v.vod_year ?? ''),
  };
}

// 首页数据统一取暴风源（实测响应最快最稳）
function homeSource(config) {
  return (config.cmsSources || []).find(s => s.id === 'bfzy');
}

export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams;
  const t = q.get('t') || '';
  const pg = Math.max(1, parseInt(q.get('pg') || '1', 10) || 1);
  const src = homeSource(await loadSources());
  if (!src) return json({ code: 0, msg: '未配置片源' });
  const api = src.api + (src.api.includes('?') ? '&' : '?') + `ac=videolist&pg=${pg}` + (t ? `&t=${t}` : '');
  let data;
  try { data = await (await fetchWithTimeout(api, 6000)).json(); }
  catch { return json({ code: 0, msg: '片源暂不可用' }); }
  const raw = data.list || [];
  if (t) return json({ code: 1, list: raw.map(normalizeHomeItem) }, 600);
  // 最近更新：过滤成人/擦边分类
  const latest = raw
    .filter(v => !/福利|理论/.test(v.vod_class || '') && !/福利|理论/.test(v.vod_name || ''))
    .map(normalizeHomeItem)
    .slice(0, 12);
  return json({ code: 1, categories: HOME_CATEGORIES, latest }, 600);
}

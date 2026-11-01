import { loadSources } from '../lib/sources.js';
import { fetchWithTimeout } from '../lib/aggregate.js';
import { filterAdult } from '../lib/filter.js';
import { json } from '../lib/http.js';

// 首页数据源由源池顺序自动决定（每日巡检维护），各源分类 type_id 体系不同，按源适配
export const HOME_CATEGORIES = [
  { group: '电影', subs: [[21, '动作片'], [22, '喜剧片'], [24, '科幻片'], [25, '爱情片'], [23, '恐怖片'], [26, '剧情片'], [27, '战争片'], [28, '纪录片']] },
  { group: '剧集', subs: [[31, '国产剧'], [32, '欧美剧'], [33, '香港剧'], [34, '韩国剧'], [35, '台湾剧'], [36, '日本剧'], [37, '海外剧'], [38, '泰国剧']] },
  { group: '动漫', subs: [[40, '国产动漫'], [41, '日韩动漫'], [42, '欧美动漫']] },
  { group: '综艺', subs: [[46, '大陆综艺'], [47, '港台综艺'], [48, '日韩综艺'], [49, '欧美综艺']] },
  { group: '短剧', subs: [[61, '现代言情'], [62, '反转爽文'], [65, '都市脑洞'], [66, '古装仙侠']] },
];

// 苹果CMS 通用分类体系（电影天堂/非凡等多数源一致；未收录的源默认走此体系）
const CAT_STD = {
  categories: [
    { group: '电影', subs: [[6, '动作片'], [7, '喜剧片'], [9, '科幻片'], [8, '爱情片'], [10, '恐怖片'], [11, '剧情片'], [12, '战争片'], [20, '纪录片']] },
    { group: '剧集', subs: [[13, '国产剧'], [16, '欧美剧'], [14, '香港剧'], [15, '韩国剧'], [21, '台湾剧'], [22, '日本剧'], [23, '海外剧'], [24, '泰国剧']] },
    { group: '动漫', subs: [[29, '国产动漫'], [30, '日韩动漫'], [31, '欧美动漫']] },
    { group: '综艺', subs: [[25, '大陆综艺'], [26, '港台综艺'], [27, '日韩综艺'], [28, '欧美综艺']] },
    { group: '短剧', subs: [[36, '短剧']] },
  ],
  rows: { action: 6, series: 13 },
};

const SCHEMES = {
  std: CAT_STD,
  // 量子资源：与通用体系一致，仅短剧 id 不同
  lzi: { ...CAT_STD, categories: CAT_STD.categories.map(c => c.group === '短剧' ? { group: '短剧', subs: [[46, '短剧']] } : c) },
  bfzy: { categories: HOME_CATEGORIES, rows: { action: 21, series: 31 } },
  bdzy: {
    categories: [
      { group: '电影', subs: [[6, '动作片'], [7, '喜剧片'], [9, '科幻片'], [8, '爱情片'], [10, '恐怖片'], [11, '剧情片'], [12, '战争片'], [20, '纪录片']] },
      { group: '剧集', subs: [[13, '国产剧'], [14, '欧美剧'], [15, '韩国剧'], [16, '日本剧'], [17, '港台剧'], [18, '台湾剧'], [19, '泰国剧']] },
      { group: '动漫', subs: [[29, '国产动漫'], [30, '日韩动漫'], [31, '欧美动漫']] },
      { group: '综艺', subs: [[25, '大陆综艺'], [26, '日韩综艺'], [27, '港台综艺'], [28, '欧美综艺']] },
      { group: '短剧', subs: [[64, '女频恋爱'], [65, '反转爽剧'], [66, '古装仙侠'], [67, '年代穿越'], [68, '脑洞悬疑'], [69, '现代都市']] },
    ],
    rows: { action: 6, series: 13 },
  },
  '360zy': {
    categories: [
      { group: '电影', subs: [[6, '动作片'], [7, '喜剧片'], [9, '科幻片'], [8, '爱情片'], [10, '恐怖片'], [11, '剧情片'], [12, '战争片'], [27, '纪录片']] },
      { group: '剧集', subs: [[13, '国产剧'], [16, '欧美剧'], [14, '香港剧'], [15, '韩国剧'], [30, '台湾剧'], [31, '日本剧'], [32, '海外剧'], [33, '泰国剧']] },
      { group: '动漫', subs: [[38, '国产动漫'], [40, '日韩动漫'], [39, '欧美动漫']] },
      { group: '综艺', subs: [[34, '大陆综艺'], [35, '港台综艺'], [36, '日韩综艺'], [37, '欧美综艺']] },
      { group: '短剧', subs: [[47, '现代都市'], [48, '脑洞悬疑'], [49, '年代穿越'], [50, '古装仙侠'], [51, '反转爽剧'], [52, '女频恋爱'], [53, '成长逆袭']] },
    ],
    rows: { action: 6, series: 13 },
  },
  modu: {
    categories: [
      { group: '电影', subs: [[10, '动作片'], [11, '喜剧片'], [13, '科幻片'], [12, '爱情片'], [14, '恐怖片'], [15, '剧情片'], [16, '战争片'], [24, '纪录片']] },
      { group: '剧集', subs: [[26, '国产剧'], [29, '欧美剧'], [27, '香港剧'], [28, '韩国剧'], [30, '台湾剧'], [31, '日本剧'], [32, '海外剧'], [33, '泰国剧']] },
      { group: '动漫', subs: [[1, '国产动漫'], [2, '日韩动漫'], [3, '欧美动漫']] },
      { group: '综艺', subs: [[34, '大陆综艺'], [35, '港台综艺'], [36, '日韩综艺'], [37, '欧美综艺']] },
      { group: '短剧', subs: [[38, '短剧']] },
    ],
    rows: { action: 10, series: 26 },
  },
  jisu: {
    categories: [
      { group: '电影', subs: [[9, '动作片'], [11, '喜剧片'], [12, '科幻片'], [10, '爱情片'], [13, '恐怖片'], [14, '剧情片'], [15, '战争片'], [16, '纪录片']] },
      { group: '剧集', subs: [[20, '国产剧'], [3, '欧美剧'], [4, '香港剧'], [5, '韩国剧'], [28, '台湾剧'], [6, '日本剧'], [23, '海外剧'], [7, '马泰剧']] },
      { group: '动漫', subs: [[24, '国产动漫'], [25, '日韩动漫'], [26, '欧美动漫']] },
      { group: '综艺', subs: [[30, '大陆综艺'], [32, '港台综艺'], [31, '日韩综艺'], [33, '欧美综艺']] },
      { group: '短剧', subs: [[45, '古装仙侠'], [46, '现代都市'], [48, '言情总裁'], [50, '反转爽剧'], [52, '脑洞悬疑']] },
    ],
    rows: { action: 9, series: 20 },
  },
};
SCHEMES.zuida = SCHEMES.bdzy; // 最大资源与百度云资源同体系
const schemeFor = id => SCHEMES[id] || SCHEMES.std;

export function normalizeHomeItem(v) {
  return {
    id: String(v.vod_id ?? ''),
    name: String(v.vod_name ?? ''),
    pic: v.vod_pic || '',
    remark: v.vod_remarks || '',
    year: String(v.vod_year ?? ''),
  };
}

// 首页数据按源池顺序容错自愈：依序尝试，第一个返回有效数据的源生效；
// 分类模式要求非空，可顺带跳过分类体系不兼容的源。source 参数锁定指定源，
// 避免故障切换时跨源分类 id 错乱
export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams;
  const t = q.get('t') || '';
  const pg = Math.max(1, parseInt(q.get('pg') || '1', 10) || 1);
  const want = q.get('source') || '';
  const { cmsSources } = await loadSources();
  const pool = cmsSources || [];
  const locked = want && pool.find(s => s.id === want);
  for (const src of (locked ? [locked] : pool)) {
    const api = src.api + (src.api.includes('?') ? '&' : '?') + `ac=videolist&pg=${pg}` + (t ? `&t=${t}` : '');
    let raw;
    try { raw = (await (await fetchWithTimeout(api, 5000)).json()).list; } catch { continue; }
    if (!Array.isArray(raw) || (t && !raw.length)) continue;
    const list = filterAdult(raw).map(normalizeHomeItem);
    if (t) return json({ code: 1, source: src.id, list }, 600);
    const sch = schemeFor(src.id);
    return json({ code: 1, source: src.id, categories: sch.categories, rows: sch.rows, latest: list.slice(0, 12) }, 600);
  }
  return json({ code: 0, msg: '片源暂不可用' });
}

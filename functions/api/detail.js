import { fetchWithTimeout } from '../lib/aggregate.js';
import { extractM3u8Episodes } from '../lib/cms.js';
import { isAdultContent } from '../lib/filter.js';
import { loadSources } from '../lib/sources.js';
import { json } from '../lib/http.js';

const stripTags = s => String(s || '').replace(/<[^>]*>/g, '').trim();

export async function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams;
  const sourceId = params.get('source') || '';
  const vodId = params.get('id') || '';
  if (!sourceId || !vodId) return json({ code: 0, msg: '缺少参数' });

  const { cmsSources } = await loadSources();
  const source = cmsSources.find(s => s.id === sourceId);
  if (!source) return json({ code: 0, msg: '未找到该片源' });

  try {
    const sep = source.api.includes('?') ? '&' : '?';
    const res = await fetchWithTimeout(`${source.api}${sep}ac=videolist&ids=${encodeURIComponent(vodId)}`, 8000);
    if (!res.ok) return json({ code: 0, msg: '获取片源详情失败' });
    const data = await res.json();
    const vod = Array.isArray(data.list) && data.list[0];
    if (!vod) return json({ code: 0, msg: '获取片源详情失败' });
    // 成人/擦边内容直接拒绝（含通过直链访问的情况）
    if (isAdultContent(vod)) return json({ code: 0, msg: '内容不可用' });
    const episodes = extractM3u8Episodes(vod.vod_play_url || '');
    return json({
      code: 1,
      name: vod.vod_name,
      pic: vod.vod_pic || '',
      sourceName: source.name,
      remark: vod.vod_remarks || '',
      year: String(vod.vod_year ?? ''),
      type: vod.vod_class || '',
      actor: stripTags(vod.vod_actor),
      director: stripTags(vod.vod_director),
      content: stripTags(vod.vod_content),
      episodes,
    }, 300);
  } catch {
    return json({ code: 0, msg: '获取片源详情失败' });
  }
}

import { aggregateSearch } from '../lib/aggregate.js';
import { dedupe } from '../lib/dedupe.js';
import { loadSources } from '../lib/sources.js';
import { json } from '../lib/http.js';

export async function onRequestGet({ request }) {
  const wd = (new URL(request.url).searchParams.get('wd') || '').trim();
  if (!wd) return json({ code: 0, msg: '缺少关键词' });
  const { cmsSources } = await loadSources();
  const items = await aggregateSearch(cmsSources, wd);
  return json({ code: 1, list: dedupe(items) }, 600);
}

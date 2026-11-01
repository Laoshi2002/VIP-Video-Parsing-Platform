import { aggregateSearch } from '../lib/aggregate.js';
import { dedupe } from '../lib/dedupe.js';
import { filterAdult } from '../lib/filter.js';
import { loadSources } from '../lib/sources.js';
import { json } from '../lib/http.js';

export async function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams;
  const wd = (params.get('wd') || '').trim();
  if (!wd) return json({ code: 0, msg: '缺少关键词' });
  const { cmsSources } = await loadSources();
  const only = params.get('source');
  const sources = only ? cmsSources.filter(s => s.id === only) : cmsSources;
  const items = await aggregateSearch(sources, wd);
  return json({ code: 1, list: filterAdult(dedupe(items)) }, 600);
}

// 苹果CMS V10 vod_play_url 解析：多播放组以 $$$ 分隔，组内 # 分集，集内 $ 分隔 名称$URL
export function parsePlayGroups(vodPlayUrl) {
  if (!vodPlayUrl) return [];
  const firstGroup = String(vodPlayUrl).split('$$$')[0];
  const eps = [];
  for (const seg of firstGroup.split('#')) {
    const idx = seg.indexOf('$');
    if (idx === -1) continue;
    const name = seg.slice(0, idx).trim();
    const url = seg.slice(idx + 1).trim();
    if (!name || !url) continue;
    eps.push({ name, url });
  }
  return eps;
}

export function extractM3u8Episodes(vodPlayUrl) {
  return parsePlayGroups(vodPlayUrl).filter(e => e.url.toLowerCase().endsWith('.m3u8'));
}

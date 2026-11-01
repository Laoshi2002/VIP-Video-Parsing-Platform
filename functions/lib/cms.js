// 苹果CMS V10 vod_play_url 解析：多播放组以 $$$ 分隔，组内 # 分集，集内 $ 分隔 名称$URL
function parseGroup(group) {
  const eps = [];
  for (const seg of String(group).split('#')) {
    const idx = seg.indexOf('$');
    if (idx === -1) continue;
    const name = seg.slice(0, idx).trim();
    const url = seg.slice(idx + 1).trim();
    if (!name || !url) continue;
    eps.push({ name, url });
  }
  return eps;
}

export function parsePlayGroups(vodPlayUrl) {
  if (!vodPlayUrl) return [];
  return parseGroup(String(vodPlayUrl).split('$$$')[0]);
}

// 取直链 m3u8 分集：部分源（非凡/电影天堂等）第一播放组是分享页而非直链，
// 直链组排在后面，因此扫描全部组，选 .m3u8 分集最多的一组
export function extractM3u8Episodes(vodPlayUrl) {
  if (!vodPlayUrl) return [];
  const groups = String(vodPlayUrl)
    .split('$$$')
    .map(g => parseGroup(g).filter(e => e.url.toLowerCase().includes('.m3u8')))
    .filter(g => g.length);
  if (!groups.length) return [];
  return groups.reduce((a, b) => (b.length > a.length ? b : a));
}

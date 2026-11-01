// 成人/软色情内容过滤：采集站（尤其短剧分区）常混入传媒出品等擦边内容，
// 命中黑名单即剔除。黑名单只收高置信度词，避免误杀正常剧目（如《激情的岁月》不受影响）。
// 检查范围包含 type_name（实测暴风源把福利区内容错挂进短剧分类，靠它才能识别）。
const BAN = /福利姬?|理论|理論|伦理|倫理|色情|情色|无码|有码|女优|人妻|熟女|巨乳|调教|偷拍|流出|外流|麻豆|传媒|蜜桃|果冻|精东|天美|MDX|MD-0|MD0\d|JAV|淫|啪啪|做爱|性爱|援交|嫩模|私拍|三级|风月|魅魔|哔咔|换妻|群交|乱伦|强奸|轮奸|巨屌|裸体|porn|sex/i;

export function isAdultContent(v) {
  if (!v || typeof v !== 'object') return false;
  const hay = [v.vod_name, v.name, v.vod_remarks, v.remark, v.vod_class, v.type, v.type_name, v.vod_blurb, v.blurb, v.vod_content, v.content]
    .map(x => (typeof x === 'string' ? x : ''))
    .join('|');
  return BAN.test(hay);
}

export function filterAdult(list) {
  return (Array.isArray(list) ? list : []).filter(v => !isAdultContent(v));
}

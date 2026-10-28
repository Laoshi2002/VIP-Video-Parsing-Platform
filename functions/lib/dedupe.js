// 同名同年份合并为一部；pic 取首个有图源；remark 取更长（信息更全）者
export function dedupe(items) {
  const map = new Map();
  for (const it of items) {
    const key = `${it.name}|${it.year}`;
    const src = { source_id: it.source_id, source_name: it.source_name || '', vod_id: it.vod_id };
    const exist = map.get(key);
    if (!exist) {
      map.set(key, {
        name: it.name, year: it.year, pic: it.pic || '', remark: it.remark || '', sources: [src]
      });
    } else {
      exist.sources.push(src);
      if (!exist.pic && it.pic) exist.pic = it.pic;
      if ((it.remark || '').length > (exist.remark || '').length) exist.remark = it.remark;
    }
  }
  return [...map.values()];
}

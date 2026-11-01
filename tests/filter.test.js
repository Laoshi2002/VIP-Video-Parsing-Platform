import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdultContent, filterAdult } from '../functions/lib/filter.js';

test('命中黑名单的成人内容被识别（片名/备注/类型标签/分类名/简介任一字段）', () => {
  assert.equal(isAdultContent({ vod_name: '麻豆传媒MDX-001 沉沦' }), true);
  assert.equal(isAdultContent({ name: '蜜桃味的夏天', remark: '更新至第8集', type: '短剧' }), true);
  assert.equal(isAdultContent({ vod_name: '看起来正常的剧名', vod_class: '短剧,伦理' }), true);
  assert.equal(isAdultContent({ name: 'MD0033 完整版' }), true);
  assert.equal(isAdultContent({ vod_name: 'Campus Sex Life' }), true);
  // 暴风源福利区内容错挂进短剧分类：type_name 才是唯一可靠信号
  assert.equal(isAdultContent({ vod_name: '铃村爱理-Airi5 秘密假期', type_name: '福利', vod_class: '' }), true);
  assert.equal(isAdultContent({ vod_name: '某部剧', vod_blurb: '拍摄裸体形象作品' }), true);
});

test('正常内容不受影响（避免误杀）', () => {
  assert.equal(isAdultContent({ vod_name: '庆余年第二季', remark: '更新至第36集', vod_class: '国产剧,古装' }), false);
  assert.equal(isAdultContent({ name: '激情的岁月', vod_class: '剧情' }), false);
  assert.equal(isAdultContent({ name: '甜蜜的家', remark: 'HD', vod_class: '恐怖片' }), false);
});

test('filterAdult 批量过滤并保留正常项', () => {
  const list = [{ name: '正常剧' }, { name: '精东影业之欲乱' }, { name: '另一部好剧' }];
  const out = filterAdult(list);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(v => v.name), ['正常剧', '另一部好剧']);
});

test('非数组/空值安全', () => {
  assert.deepEqual(filterAdult(undefined), []);
  assert.deepEqual(filterAdult(null), []);
  assert.equal(isAdultContent(null), false);
  assert.equal(isAdultContent('字符串'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../functions/lib/dedupe.js';

const item = (over = {}) => ({
  source_id: 'a1', source_name: '源A', vod_id: '1',
  name: '狂飙', year: '2023', pic: 'p1.jpg', remark: '共39集', ...over
});

test('同名同年份合并为一部，保留全部来源', () => {
  const out = dedupe([item(), item({ source_id: 'b2', source_name: '源B', vod_id: '9', pic: '' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].sources.length, 2);
  assert.deepEqual(out[0].sources, [
    { source_id: 'a1', source_name: '源A', vod_id: '1' },
    { source_id: 'b2', source_name: '源B', vod_id: '9' }
  ]);
});

test('不同名或不同年份不合并', () => {
  const out = dedupe([item(), item({ name: '狂飙2' }), item({ year: '2024' })]);
  assert.equal(out.length, 3);
});

test('海报取首个有图源', () => {
  const out = dedupe([item({ pic: '' }), item({ source_id: 'b2', vod_id: '9', pic: 'p2.jpg' })]);
  assert.equal(out[0].pic, 'p2.jpg');
});

test('remark 取信息最全者（更长字符串）', () => {
  const out = dedupe([item({ remark: 'HD' }), item({ source_id: 'b2', vod_id: '9', remark: '共39集' })]);
  assert.equal(out[0].remark, '共39集');
});

test('空列表返回空数组', () => {
  assert.deepEqual(dedupe([]), []);
});

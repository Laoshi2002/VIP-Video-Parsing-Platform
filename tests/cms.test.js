import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlayGroups, extractM3u8Episodes } from '../functions/lib/cms.js';

test('parsePlayGroups 解析单组剧集', () => {
  const raw = '第01集$https://a.com/1.m3u8#第02集$https://a.com/2.m3u8';
  assert.deepEqual(parsePlayGroups(raw), [
    { name: '第01集', url: 'https://a.com/1.m3u8' },
    { name: '第02集', url: 'https://a.com/2.m3u8' }
  ]);
});

test('parsePlayGroups 只取第一组（$$$ 分隔多播放组）', () => {
  const raw = '第01集$https://a.com/1.m3u8$$$第01集$https://b.com/1.mp4';
  const eps = parsePlayGroups(raw);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].url, 'https://a.com/1.m3u8');
});

test('parsePlayGroups 跳过格式不完整的段', () => {
  const raw = '第01集$https://a.com/1.m3u8#坏段#$$#第02集$https://a.com/2.m3u8';
  assert.equal(parsePlayGroups(raw).length, 2);
});

test('parsePlayGroups 空输入返回空数组', () => {
  assert.deepEqual(parsePlayGroups(''), []);
  assert.deepEqual(parsePlayGroups(null), []);
});

test('extractM3u8Episodes 过滤非 m3u8 链接', () => {
  const raw = '第01集$https://a.com/1.m3u8#第02集$https://a.com/2.mp4#第03集$https://a.com/3.M3U8';
  const eps = extractM3u8Episodes(raw);
  assert.equal(eps.length, 2);
  assert.equal(eps[0].url, 'https://a.com/1.m3u8');
  assert.equal(eps[1].url, 'https://a.com/3.M3U8');
});

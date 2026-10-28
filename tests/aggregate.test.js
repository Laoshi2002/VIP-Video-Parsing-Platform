import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout, searchSource, aggregateSearch } from '../functions/lib/aggregate.js';

const src = { id: 'a1', name: '源A', api: 'https://x.example/provide/vod' };

test('searchSource 正常映射字段', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ code: 1, list: [{ vod_id: 7, vod_name: '狂飙', vod_pic: 'p.jpg', vod_remarks: '共39集', vod_year: '2023' }] })
  });
  const out = await searchSource(src, '狂飙', fetchImpl, 1000);
  assert.deepEqual(out, [{
    source_id: 'a1', source_name: '源A', vod_id: '7',
    name: '狂飙', pic: 'p.jpg', remark: '共39集', year: '2023'
  }]);
});

test('searchSource 失败/超时/坏数据返回空数组不抛错', async () => {
  assert.deepEqual(await searchSource(src, 'x', async () => { throw new Error('net'); }, 1000), []);
  assert.deepEqual(await searchSource(src, 'x', async () => ({ ok: false }), 1000), []);
  assert.deepEqual(await searchSource(src, 'x', async () => ({ ok: true, json: async () => ({ code: 0 }) }), 1000), []);
});

test('fetchWithTimeout 超时中止请求', async () => {
  const slow = (url, opts) => new Promise((_, rej) =>
    opts.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  await assert.rejects(fetchWithTimeout('https://x.example', 30, slow), /aborted/);
});

test('aggregateSearch 并行扁平合并且保持源顺序', async () => {
  const s2 = { id: 'b2', name: '源B', api: 'https://y.example/provide/vod' };
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => ({ code: 1, list: [{ vod_id: url.includes('y.') ? 2 : 1, vod_name: '剧', vod_year: '2024' }] })
  });
  const out = await aggregateSearch([src, s2], '剧', fetchImpl, 1000);
  assert.equal(out.length, 2);
  assert.equal(out[0].source_id, 'a1');
  assert.equal(out[1].source_id, 'b2');
});

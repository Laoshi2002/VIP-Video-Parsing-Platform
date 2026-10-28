# VIP 视频解析平台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建搜索式影视聚合播放站（搜剧名 → 多源聚合 → 点击剧集自动播放），部署于 Cloudflare Pages + Functions。

**Architecture:** 单仓库：`public/` 静态前端（原生 JS 单页，hash 路由）+ `functions/` Pages Functions（`/api/search` 并行聚合各苹果CMS采集源、`/api/detail` 取剧集 m3u8、`/api/sources` 提供解析线路）。纯逻辑（聚合/去重/CMS解析）做成纯函数并用 Node 内置 test runner 做单元测试；接口连通性用 wrangler pages dev + curl 验证。

**Tech Stack:** 原生 HTML/CSS/JS、hls.js（本地内置）、Cloudflare Pages Functions、Node 内置 `node:test`、wrangler v4。

**规格文档:** `docs/superpowers/specs/2026-10-28-vip-video-parsing-platform-design.md`

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "vip-video-platform",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "dev": "wrangler pages dev public"
  },
  "devDependencies": {
    "wrangler": "^4"
  }
}
```

- [ ] **Step 2: 创建 .gitignore**

```
node_modules/
.wrangler/
.superpowers/
```

- [ ] **Step 3: 安装依赖并验证**

Run: `npm install`
Expected: 安装成功，无 error。

Run: `npx wrangler --version`
Expected: 输出 ` ⛅️ wrangler 4.x.x`（4.x 版本号）。

Run: `npm test`
Expected: `# pass 0` / `# fail 0`（tests 目录尚不存在时 node --test 会报找不到；此时先建空目录 `tests/` 再跑，需通过）。

---

### Task 2: CMS 解析纯函数（TDD）

**Files:**
- Create: `functions/lib/cms.js`
- Test: `tests/cms.test.js`

- [ ] **Step 1: 写失败测试 tests/cms.test.js**

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module .../functions/lib/cms.js`）。

- [ ] **Step 3: 实现 functions/lib/cms.js**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS（5 个测试）。

---

### Task 3: 聚合去重纯函数（TDD）

**Files:**
- Create: `functions/lib/dedupe.js`
- Test: `tests/dedupe.test.js`

- [ ] **Step 1: 写失败测试 tests/dedupe.test.js**

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 functions/lib/dedupe.js**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS（11 个测试）。

---

### Task 4: 多源并行聚合纯函数（TDD）

**Files:**
- Create: `functions/lib/aggregate.js`
- Test: `tests/aggregate.test.js`

- [ ] **Step 1: 写失败测试 tests/aggregate.test.js**

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 functions/lib/aggregate.js**

```js
export async function fetchWithTimeout(url, ms = 5000, fetchImpl = fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function searchSource(source, wd, fetchImpl = fetch, timeoutMs = 5000) {
  try {
    const sep = source.api.includes('?') ? '&' : '?';
    const res = await fetchWithTimeout(
      `${source.api}${sep}ac=videolist&wd=${encodeURIComponent(wd)}`, timeoutMs, fetchImpl);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.code !== 1 || !Array.isArray(data.list)) return [];
    return data.list.map(v => ({
      source_id: source.id,
      source_name: source.name,
      vod_id: String(v.vod_id),
      name: v.vod_name,
      pic: v.vod_pic || '',
      remark: v.vod_remarks || '',
      year: String(v.vod_year || '')
    }));
  } catch {
    return [];
  }
}

export async function aggregateSearch(sources, wd, fetchImpl = fetch, timeoutMs = 5000) {
  const lists = await Promise.all(sources.map(s => searchSource(s, wd, fetchImpl, timeoutMs)));
  return lists.flat();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS（15 个测试）。

---

### Task 5: 内置片源列表（联网实测）

**Files:**
- Create: `public/sources.json`

- [ ] **Step 1: 逐个 curl 验证候选采集源（返回 JSON 且 code==1、list 非空才算通过）**

```powershell
curl.exe -s --max-time 8 "https://api.ffzyapi.com/api.php/provide/vod?ac=videolist&wd=%E7%8B%82%E9%A3%99"
curl.exe -s --max-time 8 "https://bfzyapi.com/api.php/provide/vod?ac=videolist&wd=%E7%8B%82%E9%A3%99"
curl.exe -s --max-time 8 "https://tyyszy.com/api.php/provide/vod?ac=videolist&wd=%E7%8B%82%E9%A3%99"
curl.exe -s --max-time 8 "https://sdzyapi.com/api.php/provide/vod?ac=videolist&wd=%E7%8B%82%E9%A3%99"
curl.exe -s --max-time 8 "https://collect.wolongzy.cc/api.php/provide/vod?ac=videolist&wd=%E7%8B%82%E9%A3%99"
curl.exe -s --max-time 8 "https://cj.lziapi.com/api.php/provide/vod?ac=videolist&wd=%E7%8B%82%E9%A3%99"
```

Expected: 每条返回 `{"code":1,"list":[...],"page_count":...}` 形状的 JSON。全部失败则更换候选源重试（可搜索"苹果CMS 采集接口 最新"获取候选），**至少保留 2 个通过源，否则停下来询问用户**。

- [ ] **Step 2: 将通过的源写入 public/sources.json（以下为通过后的示例形态，id 用短横线小写）**

```json
{
  "remoteSourceUrl": "",
  "cmsSources": [
    { "id": "ffzy", "name": "非凡资源", "api": "https://api.ffzyapi.com/api.php/provide/vod" },
    { "id": "bfzy", "name": "暴风资源", "api": "https://bfzyapi.com/api.php/provide/vod" },
    { "id": "tyyszy", "name": "天涯资源", "api": "https://tyyszy.com/api.php/provide/vod" }
  ],
  "parseApis": [
    { "name": "线路1", "url": "https://jx.aidouer.net/?url=" },
    { "name": "线路2", "url": "https://www.yemu.xyz/?url=" },
    { "name": "线路3", "url": "https://jx.playerjy.com/?url=" }
  ]
}
```

（cmsSources 只保留 Step 1 实测通过的条目；parseApis 无法用 curl 验证，保持 3 条候选，Task 10 验收时人工核验，失效的删除或替换。）

- [ ] **Step 3: 验证 JSON 合法**

Run: `node -e "JSON.parse(require('fs').readFileSync('public/sources.json','utf8')); console.log('ok')"`
Expected: `ok`。

---

### Task 6: Functions API 三个端点

**Files:**
- Create: `functions/lib/http.js`
- Create: `functions/lib/sources.js`
- Create: `functions/api/sources.js`
- Create: `functions/api/search.js`
- Create: `functions/api/detail.js`

- [ ] **Step 1: 实现 functions/lib/http.js**

```js
export function json(data, maxAge = 0) {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  if (maxAge > 0) headers['cache-control'] = `public, max-age=${maxAge}`;
  return new Response(JSON.stringify(data), { headers });
}
```

- [ ] **Step 2: 实现 functions/lib/sources.js（远程优先 + 5 分钟内存缓存 + 内置兜底）**

```js
import builtinSources from '../../public/sources.json';
import { fetchWithTimeout } from './aggregate.js';

const CACHE_MS = 5 * 60 * 1000;
let cache = { data: null, at: 0 };

export async function loadSources() {
  const remoteUrl = builtinSources.remoteSourceUrl;
  if (remoteUrl) {
    if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
    try {
      const res = await fetchWithTimeout(remoteUrl, 5000);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.cmsSources) && data.cmsSources.length) {
          cache = { data, at: Date.now() };
          return data;
        }
      }
    } catch { /* 回退内置 */ }
  }
  return builtinSources;
}
```

- [ ] **Step 3: 实现 functions/api/sources.js**

```js
import { loadSources } from '../lib/sources.js';
import { json } from '../lib/http.js';

export async function onRequestGet() {
  const data = await loadSources();
  return json({ code: 1, parseApis: data.parseApis || [] });
}
```

- [ ] **Step 4: 实现 functions/api/search.js**

```js
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
```

- [ ] **Step 5: 实现 functions/api/detail.js**

```js
import { fetchWithTimeout } from '../lib/aggregate.js';
import { extractM3u8Episodes } from '../lib/cms.js';
import { loadSources } from '../lib/sources.js';
import { json } from '../lib/http.js';

export async function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams;
  const sourceId = params.get('source') || '';
  const vodId = params.get('id') || '';
  if (!sourceId || !vodId) return json({ code: 0, msg: '缺少参数' });

  const { cmsSources } = await loadSources();
  const source = cmsSources.find(s => s.id === sourceId);
  if (!source) return json({ code: 0, msg: '未找到该片源' });

  try {
    const sep = source.api.includes('?') ? '&' : '?';
    const res = await fetchWithTimeout(`${source.api}${sep}ac=videolist&ids=${encodeURIComponent(vodId)}`, 8000);
    if (!res.ok) return json({ code: 0, msg: '获取片源详情失败' });
    const data = await res.json();
    const vod = Array.isArray(data.list) && data.list[0];
    if (!vod) return json({ code: 0, msg: '获取片源详情失败' });
    const episodes = extractM3u8Episodes(vod.vod_play_url || '');
    return json({ code: 1, name: vod.vod_name, pic: vod.vod_pic || '', sourceName: source.name, episodes }, 300);
  } catch {
    return json({ code: 0, msg: '获取片源详情失败' });
  }
}
```

- [ ] **Step 6: 启动本地服务并 curl 验证三个端点**

Run（后台）: `npm run dev`
Run: `curl.exe -s "http://127.0.0.1:8788/api/sources"`
Expected: `{"code":1,"parseApis":[{...3 条...}]}`

Run: `curl.exe -s "http://127.0.0.1:8788/api/search?wd=%E7%8B%82%E9%A3%99"`
Expected: `{"code":1,"list":[...]}` 且 list 非空、元素含 `name/pic/remark/sources`。记下某结果第一个 `sources[0]` 的 `source_id` 与 `vod_id` 供下一步。

Run: `curl.exe -s "http://127.0.0.1:8788/api/detail?source=<上一步source_id>&id=<上一步vod_id>"`
Expected: `{"code":1,"name":"...","episodes":[{"name":"...","url":"https://....m3u8"}...]}` 且 episodes 非空。

Run: `curl.exe -s "http://127.0.0.1:8788/api/search"`（缺参数负例）
Expected: `{"code":0,"msg":"缺少关键词"}`。

---

### Task 7: 前端基础 — 布局、路由、首页与结果页

**Files:**
- Create: `public/index.html`
- Create: `public/assets/js/config.js`
- Create: `public/assets/css/style.css`
- Create: `public/assets/js/app.js`

- [ ] **Step 1: 创建 public/index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>云影搜 — 全网影视免费看</title>
<link rel="stylesheet" href="/assets/css/style.css">
</head>
<body>
<header class="site-header">
  <a class="logo" href="#/">▶ <span id="siteName">云影搜</span></a>
  <form id="searchForm" class="search-form">
    <input id="searchInput" type="search" placeholder="输入剧名 / 电影名，或粘贴视频链接" autocomplete="off">
    <button type="submit">搜索</button>
  </form>
</header>
<main id="view"></main>
<script src="/assets/js/config.js"></script>
<script src="/assets/vendor/hls.min.js"></script>
<script src="/assets/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 创建 public/assets/js/config.js**

```js
window.CONFIG = {
  siteName: '云影搜',
  hotKeywords: ['狂飙', '繁花', '三体', '庆余年', '流浪地球3'],
  vipHosts: ['iqiyi.com', 'iq.com', 'v.qq.com', 'youku.com', 'mgtv.com', 'bilibili.com', 'sohu.com', 'miguvideo.com', '1905.com', 'le.com', 'pptv.com']
};
document.title = window.CONFIG.siteName + ' — 全网影视免费看';
document.getElementById('siteName').textContent = window.CONFIG.siteName;
```

- [ ] **Step 3: 创建 public/assets/css/style.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #1a1d29; --bg2: #22263a; --line: #2a2e3f; --txt: #e8ecf4;
  --sub: #8892a8; --dim: #5c6478; --primary: #4f7cff;
}
html { color-scheme: dark; }
body { background: var(--bg); color: var(--txt); font: 15px/1.6 -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; min-height: 100vh; }
a { color: inherit; text-decoration: none; }
button { font: inherit; cursor: pointer; }

.site-header { display: flex; align-items: center; gap: 16px; padding: 12px 20px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: rgba(26,29,41,.95); backdrop-filter: blur(8px); z-index: 10; }
.logo { font-weight: 700; font-size: 17px; white-space: nowrap; color: var(--primary); }
.search-form { display: flex; flex: 1; max-width: 560px; gap: 8px; }
.search-form input { flex: 1; background: var(--bg2); border: 1px solid var(--line); border-radius: 8px; padding: 9px 14px; color: var(--txt); outline: none; min-width: 0; }
.search-form input:focus { border-color: var(--primary); }
.search-form button { background: var(--primary); border: 0; color: #fff; border-radius: 8px; padding: 9px 18px; }

main { max-width: 1200px; margin: 0 auto; padding: 20px; }

.hero { text-align: center; padding: 72px 0 36px; }
.hero h1 { font-size: 30px; margin-bottom: 10px; }
.hero-sub { color: var(--sub); margin-bottom: 22px; }
.hot { color: var(--dim); font-size: 14px; }
.hot a { color: var(--sub); margin: 0 6px; }
.hot a:hover { color: var(--primary); }
.features { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; margin-top: 48px; }
.feature { background: var(--bg2); border: 1px solid var(--line); border-radius: 10px; padding: 16px 22px; text-align: center; min-width: 160px; }
.feature b { display: block; margin-bottom: 4px; }
.feature span { color: var(--sub); font-size: 13px; }

.grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; }
.card .poster { aspect-ratio: 2 / 3; background: var(--bg2); border-radius: 8px; overflow: hidden; }
.card .poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
.card-name { margin-top: 8px; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-remark { color: var(--dim); font-size: 12px; }
.card:hover .card-name { color: var(--primary); }

.play-wrap { max-width: 1100px; margin: 0 auto; }
.player-box { position: relative; aspect-ratio: 16 / 9; background: #000; border-radius: 10px; overflow: hidden; }
.player-box video, .player-box iframe { width: 100%; height: 100%; border: 0; display: block; }
.play-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.65); text-align: center; padding: 20px; }
.play-title { margin: 14px 0 6px; }
.play-title span { color: var(--sub); font-size: 14px; }
.source-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 10px 0; color: var(--sub); font-size: 14px; }
.source-bar button, .episodes button, .ep-nav button { background: var(--bg2); border: 1px solid var(--line); color: var(--sub); border-radius: 6px; padding: 8px 12px; min-height: 44px; min-width: 44px; }
.source-bar button.on, .episodes button.on { background: var(--primary); border-color: var(--primary); color: #fff; }
.ep-nav { display: flex; gap: 8px; margin: 8px 0; }
.episodes { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; margin-top: 6px; }

.msg { text-align: center; color: var(--sub); padding: 80px 20px; }
.msg a { color: var(--primary); }
.msg-sub { color: var(--dim); font-size: 13px; margin-top: 8px; text-align: center; }

@media (max-width: 1279px) { .grid { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 767px) {
  .grid { grid-template-columns: repeat(2, 1fr); }
  .site-header { flex-wrap: wrap; padding: 10px 14px; }
  .hero { padding: 40px 0 24px; }
  .hero h1 { font-size: 22px; }
  main { padding: 14px; }
}
```

- [ ] **Step 4: 创建 public/assets/js/app.js（本任务先实现 路由 + 首页 + 结果页；播放页/解析页函数在 Task 8/9 补齐）**

```js
(() => {
  const $view = document.getElementById('view');
  const $form = document.getElementById('searchForm');
  const $input = document.getElementById('searchInput');
  let lastResults = [];   // 最近一次搜索结果，供播放页"片源切换"使用

  // ---------- 工具 ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (path, params) =>
    fetch(`${path}?${new URLSearchParams(params)}`).then(r => r.json());

  function isVipUrl(text) {
    try {
      const host = new URL(text).hostname.replace(/^www\./, '');
      return window.CONFIG.vipHosts.some(h => host === h || host.endsWith('.' + h));
    } catch { return false; }
  }

  // ---------- 路由 ----------
  const routes = { '': renderHome, search: renderSearch, play: renderPlay, parse: renderParse };
  function router() {
    destroyPlayer();
    const [path, query = ''] = location.hash.slice(2).split('?');
    (routes[path] || renderHome)(new URLSearchParams(query));
  }
  window.addEventListener('hashchange', router);

  $form.addEventListener('submit', e => {
    e.preventDefault();
    const q = $input.value.trim();
    if (!q) return;
    if (isVipUrl(q)) location.hash = '#/parse?url=' + encodeURIComponent(q);
    else location.hash = '#/search?wd=' + encodeURIComponent(q);
  });

  // ---------- 首页 ----------
  function renderHome() {
    $view.innerHTML = `
      <section class="hero">
        <h1>搜剧名，免费看全网VIP</h1>
        <p class="hero-sub">聚合全网资源 · 无需下载 · 支持手机与电脑</p>
        <div class="hot">热门：${window.CONFIG.hotKeywords.map(k =>
          `<a href="#/search?wd=${encodeURIComponent(k)}">${esc(k)}</a>`).join('')}</div>
      </section>
      <section class="features">
        <div class="feature"><b>① 搜索</b><span>输入剧名或电影名</span></div>
        <div class="feature"><b>② 选片</b><span>多资源站聚合去重</span></div>
        <div class="feature"><b>③ 播放</b><span>点击剧集自动解析</span></div>
      </section>`;
    $input.focus();
  }

  // ---------- 结果页 ----------
  async function renderSearch(params) {
    const wd = (params.get('wd') || '').trim();
    $input.value = wd;
    $view.innerHTML = `<p class="msg">正在搜索「${esc(wd)}」…</p>`;
    let data;
    try { data = await api('/api/search', { wd }); }
    catch { $view.innerHTML = `<p class="msg">搜索失败，请稍后再试</p>`; return; }
    if (data.code !== 1 || !data.list.length) {
      $view.innerHTML = `<p class="msg">${data.code === 1
        ? '没有找到相关片源，换个关键词试试' : '搜索失败，请稍后再试'}</p>`;
      return;
    }
    lastResults = data.list;
    $view.innerHTML = `<div class="grid">${data.list.map(v => {
      const s = v.sources[0];
      return `<a class="card" href="#/play?source=${encodeURIComponent(s.source_id)}&id=${encodeURIComponent(s.vod_id)}&name=${encodeURIComponent(v.name)}&year=${encodeURIComponent(v.year)}">
        <div class="poster">${v.pic ? `<img src="${esc(v.pic)}" loading="lazy" alt="">` : ''}</div>
        <div class="card-name">${esc(v.name)}</div>
        <div class="card-remark">${esc(v.remark || v.year || '')}</div>
      </a>`;
    }).join('')}</div>`;
  }

  // ---------- 播放页（Task 8 实现）----------
  function renderPlay() { $view.innerHTML = `<p class="msg">播放页建设中</p>`; }

  // ---------- VIP 解析页（Task 9 实现）----------
  function renderParse() { $view.innerHTML = `<p class="msg">解析页建设中</p>`; }

  // ---------- 播放器占位（Task 8 实现）----------
  function destroyPlayer() {}

  router();
})();
```

- [ ] **Step 5: 浏览器验证**

保持 `npm run dev` 运行，浏览器打开 `http://127.0.0.1:8788`。
Expected: 深色首页、热门标签可点击；搜索"狂飙"显示海报网格（6 列）；窗口缩到 <768px 时变 2 列；在搜索框粘贴 `https://v.qq.com/x/cover/xxx.html` 回车 → hash 变为 `#/parse?url=...` 且显示"解析页建设中"。

---

### Task 8: 播放页与 hls.js 播放器

**Files:**
- Create: `public/assets/vendor/hls.min.js`
- Modify: `public/assets/js/app.js`（替换 renderPlay 与 destroyPlayer 占位，新增播放逻辑）

- [ ] **Step 1: 下载 hls.js 到本地 vendor**

Run:
```powershell
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js" -OutFile "public/assets/vendor/hls.min.js"
```
若下载失败，改用 `curl.exe -L -o public/assets/vendor/hls.min.js "https://unpkg.com/hls.js@1/dist/hls.min.js"`（先创建 vendor 目录）。

Run: `node -e "const s=require('fs').statSync('public/assets/vendor/hls.min.js'); console.log(s.size>200000 ? 'ok' : 'too small: '+s.size)"`
Expected: `ok`（文件 > 200KB）。

- [ ] **Step 2: 在 app.js 中替换占位实现（renderPlay 与 destroyPlayer 两个占位整体替换，Task 7 中的 renderParse 占位保留给 Task 9，并新增 playEpisode / startHls / showPlayMsg / findAlternatives）**

将 Step 4（Task 7）中的 `renderPlay` 与 `destroyPlayer` 两个占位函数整体替换为（`renderParse` 占位保留，Task 9 再替换）：

```js
  // ---------- 播放页 ----------
  let player = null;        // hls 实例
  let currentPlay = null;   // { detail, epIndex, alts, sourceId, vodId }
  let playRetried = false;

  function findAlternatives(name, year) {
    const hit = lastResults.find(v => v.name === name && v.year === year);
    return hit ? hit.sources : [];
  }

  async function renderPlay(params) {
    const sourceId = params.get('source') || '';
    const vodId = params.get('id') || '';
    const name = params.get('name') || '';
    const year = params.get('year') || '';
    $view.innerHTML = `<p class="msg">正在获取片源…</p>`;
    let data;
    try { data = await api('/api/detail', { source: sourceId, id: vodId }); }
    catch { $view.innerHTML = `<p class="msg">获取片源详情失败，<a href="javascript:history.back()">返回换源</a></p>`; return; }
    if (data.code !== 1 || !data.episodes.length) {
      $view.innerHTML = `<p class="msg">${esc(data.msg || '该片源暂无可播放剧集')}，<a href="javascript:history.back()">返回换源</a></p>`;
      return;
    }
    const alts = findAlternatives(name, year);
    const epIndex = Math.min(parseInt(params.get('ep') || '0', 10) || 0, data.episodes.length - 1);
    currentPlay = { detail: data, epIndex, alts, sourceId, vodId };
    $view.innerHTML = `
      <div class="play-wrap">
        <div class="player-box">
          <video id="video" controls playsinline></video>
          <div id="playMsg" class="play-msg" hidden></div>
        </div>
        <div class="play-title"><b>${esc(data.name)}</b><span id="epNow"></span></div>
        ${alts.length > 1 ? `<div class="source-bar">片源：${alts.map(s =>
          `<button data-source="${esc(s.source_id)}" data-vodid="${esc(s.vod_id)}"
            ${s.source_id === sourceId ? 'class="on"' : ''}>${esc(s.source_name || s.source_id)}</button>`).join('')}</div>` : ''}
        <div class="ep-nav">
          <button id="prevEp">上一集</button><button id="nextEp">下一集</button>
        </div>
        <div class="episodes">${data.episodes.map((e, i) =>
          `<button data-ep="${i}" ${i === epIndex ? 'class="on"' : ''}>${esc(e.name)}</button>`).join('')}</div>
      </div>`;

    $view.querySelector('.episodes').addEventListener('click', e => {
      const b = e.target.closest('button[data-ep]');
      if (b) playEpisode(+b.dataset.ep);
    });
    $view.querySelector('.ep-nav').addEventListener('click', e => {
      if (e.target.id === 'prevEp' && currentPlay.epIndex > 0) playEpisode(currentPlay.epIndex - 1);
      if (e.target.id === 'nextEp' && currentPlay.epIndex < currentPlay.detail.episodes.length - 1) playEpisode(currentPlay.epIndex + 1);
    });
    const sourceBar = $view.querySelector('.source-bar');
    if (sourceBar) sourceBar.addEventListener('click', e => {
      const b = e.target.closest('button[data-source]');
      if (!b || b.dataset.source === sourceId) return;
      location.hash = `#/play?source=${encodeURIComponent(b.dataset.source)}&id=${encodeURIComponent(b.dataset.vodid)}&name=${encodeURIComponent(name)}&year=${encodeURIComponent(year)}`;
    });

    playEpisode(epIndex);
  }

  function showPlayMsg(text) {
    const el = document.getElementById('playMsg');
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
  }

  function startHls(url) {
    destroyPlayer();
    const video = document.getElementById('video');
    if (!video) return;
    if (window.Hls && window.Hls.isSupported()) {
      player = new window.Hls();
      player.on(window.Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (!playRetried) { playRetried = true; startHls(url); }
        else showPlayMsg('播放失败，请尝试切换其他片源');
      });
      player.loadSource(url);
      player.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url; // Safari 原生 HLS
    } else {
      showPlayMsg('当前浏览器不支持 HLS 播放');
    }
  }

  function playEpisode(i) {
    const ep = currentPlay.detail.episodes[i];
    currentPlay.epIndex = i;
    playRetried = false;
    document.getElementById('epNow').textContent = ` · ${ep.name}`;
    document.querySelectorAll('.episodes button').forEach(b =>
      b.classList.toggle('on', +b.dataset.ep === i));
    showPlayMsg('');
    history.replaceState(null, '', `#/play?source=${encodeURIComponent(currentPlay.sourceId)}&id=${encodeURIComponent(currentPlay.vodId)}&ep=${i}`);
    startHls(ep.url);
  }

  function destroyPlayer() {
    if (player) { player.destroy(); player = null; }
  }
```

- [ ] **Step 3: 浏览器验证**

Run: `npm run dev`（如未运行）。
浏览器：搜索"狂飙" → 点第一个结果 → 点第 2 集。
Expected: 视频开始播放；URL 更新含 `&ep=1`；"上一集/下一集"可用；播放页出现"片源：xxx"切换条且点击后换源重载；DevTools Console 无报错。

- [ ] **Step 4: 播放失败换源提示验证**

临时把某个源 api 改错（或断网后点播放）。
Expected: 自动重试 1 次后播放器上出现"播放失败，请尝试切换其他片源"。验证后还原。

---

### Task 9: VIP 解析视图

**Files:**
- Modify: `public/assets/js/app.js`（替换 renderParse 占位）

- [ ] **Step 1: 替换 renderParse 占位实现**

```js
  // ---------- VIP 解析页 ----------
  async function renderParse(params) {
    const url = params.get('url') || '';
    let parseApis = [];
    try { parseApis = (await api('/api/sources', {})).parseApis || []; } catch { /* 走空列表提示 */ }
    if (!parseApis.length) {
      $view.innerHTML = `<p class="msg">暂无可用解析线路，<a href="#/">返回首页</a></p>`;
      return;
    }
    let idx = 0;
    $view.innerHTML = `
      <div class="play-wrap">
        <div class="play-title"><b>VIP 链接解析</b><span id="lineNow"></span></div>
        <div class="player-box"><iframe id="parseFrame" allowfullscreen frameborder="0" referrerpolicy="no-referrer"></iframe></div>
        <div class="source-bar">线路：<span id="parseBtns" style="display:contents"></span></div>
        <p class="msg-sub">解析线路由第三方提供，如播放失败请换线路</p>
      </div>`;
    const frame = document.getElementById('parseFrame');
    const apply = () => {
      frame.src = parseApis[idx].url + encodeURIComponent(url);
      document.getElementById('lineNow').textContent = ` · ${parseApis[idx].name}`;
      document.querySelectorAll('#parseBtns button').forEach((b, i) =>
        b.classList.toggle('on', i === idx));
    };
    document.getElementById('parseBtns').innerHTML = parseApis.map((a, i) =>
      `<button data-i="${i}">${esc(a.name)}</button>`).join('');
    document.getElementById('parseBtns').addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (b) { idx = +b.dataset.i; apply(); }
    });
    apply();
  }
```

- [ ] **Step 2: 浏览器验证**

浏览器：搜索框粘贴一个真实爱奇艺/腾讯视频播放页链接 → 回车。
Expected: 出现"VIP 链接解析"页，iframe 加载线路 1；点击"线路 2/3"切换后 iframe 地址变化。若某线路白屏/报错属第三方问题，换线路即可（Task 10 验收时记录可用线路）。

---

### Task 10: 错误态、响应式与验收清单

**Files:**
- Verify only（如发现小问题，修复对应文件后复验）

- [ ] **Step 1: 验收标准逐条核验（对应规格第 9 节）**

1. `npm run dev` 下手动走通：首页 → 搜索"狂飙" → 点结果 → 点剧集 → 视频播放。✅/❌
2. `npm test` 全部通过（15 个单元测试）。Run: `npm test` → Expected: `# pass 15`、`# fail 0`。✅/❌
3. 响应式：DevTools 设备模拟 375px / 768px / 1440px 三档，首页/结果页/播放页无横向滚动、无布局错乱。✅/❌
4. 失效源场景：临时的坏源不影响其他源结果（搜索接口在 Task 6 已验证跳过逻辑）；播放失败出现"切换片源"提示（Task 8 Step 4 已验证）。✅/❌
5. VIP 解析：粘贴爱奇艺或腾讯链接，至少一条线路 iframe 可播放；将可用线路排到 parseApis 前列。✅/❌

- [ ] **Step 2: 修复验收中发现的问题并复验**

仅修复与验收相关的问题；每处修复后重跑对应验收项。

- [ ] **Step 3: 全量回归**

Run: `npm test`
Expected: `# pass 15`、`# fail 0`。

Run: `curl.exe -s "http://127.0.0.1:8788/api/search?wd=%E4%B8%89%E4%BD%93"`
Expected: `{"code":1,...}` list 非空。

---

## 部署（验收通过后，由用户执行或协助执行）

1. 初始化 Git 仓库并推送到 GitHub（需用户确认后执行）
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → 连接该仓库
3. 构建配置：Framework preset 选 None；Build command 留空；Build output directory 填 `public`（`functions/` 自动识别）
4. 部署完成后绑定自定义域名（可选）
5. 片源更新：改 GitHub 上的 `public/sources.json` 或 `remoteSourceUrl` 指向的远程 JSON（即时生效，无需重新部署代码逻辑）

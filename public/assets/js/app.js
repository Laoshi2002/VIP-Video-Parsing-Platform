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

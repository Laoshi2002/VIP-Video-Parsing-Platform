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

  // ---------- 路由 ----------
  const routes = { '': renderHome, search: renderSearch, play: renderPlay };
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
    location.hash = '#/search?wd=' + encodeURIComponent(q);
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

  // ---------- 播放页 ----------
  let player = null;        // hls 实例
  let currentPlay = null;   // { detail, epIndex, alts, sourceId, vodId }
  let playRetried = false;

  function findAlternatives(name, year) {
    const hit = lastResults.find(v => v.name === name && v.year === year);
    return hit ? hit.sources : [];
  }

  async function renderPlay(params) {
    let sourceId = params.get('source') || '';
    let vodId = params.get('id') || '';
    const name = params.get('name') || '';
    const year = params.get('year') || '';
    $view.innerHTML = `<p class="msg">正在获取片源…</p>`;
    let data;
    try { data = await api('/api/detail', { source: sourceId, id: vodId }); }
    catch { data = { code: 0, msg: '' }; }
    if (data.code !== 1 || !data.episodes.length) {
      // 当前源无剧集（如收录了条目但没有可播链接）→ 自动尝试同片名的其他片源
      const others = findAlternatives(name, year).filter(s => s.source_id !== sourceId);
      for (const s of others) {
        try {
          const d2 = await api('/api/detail', { source: s.source_id, id: s.vod_id });
          if (d2.code === 1 && d2.episodes.length) { data = d2; sourceId = s.source_id; vodId = s.vod_id; break; }
        } catch { /* 尝试下一个源 */ }
      }
    }
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
        <div id="qualityBar" class="source-bar" hidden></div>
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

    // 点击画面暂停/播放（自动播放被浏览器拦截时，点一下即可开始）
    document.getElementById('video').addEventListener('click', () => {
      const v = document.getElementById('video');
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    });

    // 画质切换（-1 = 自动）
    document.getElementById('qualityBar').addEventListener('click', e => {
      const b = e.target.closest('button[data-q]');
      if (!b || !player) return;
      player.currentLevel = +b.dataset.q;
      document.querySelectorAll('#qualityBar button').forEach(x => x.classList.toggle('on', x === b));
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
      player.on(window.Hls.Events.MANIFEST_PARSED, () => {
        const bar = document.getElementById('qualityBar');
        if (!bar) return;
        const levels = player.levels || [];
        if (levels.length < 2) { bar.hidden = true; return; }
        bar.hidden = false;
        bar.innerHTML = `画质：` + ['<button data-q="-1" class="on">自动</button>']
          .concat(levels.map((l, i) => `<button data-q="${i}">${l.height ? l.height + 'P' : Math.round(l.bitrate / 1000) + 'k'}</button>`))
          .join('');
      });
      player.loadSource(url);
      player.attachMedia(video);
      video.play().catch(() => {}); // 剧集点击路径有用户手势可直接起播；直链进入时浏览器可能拦截，用户手动点播放即可
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url; // Safari 原生 HLS
      video.play().catch(() => {});
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

  router();
})();

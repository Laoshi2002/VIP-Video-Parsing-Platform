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
  const routes = { '': renderHome, search: renderSearch, play: renderPlay, cat: renderCat };
  function router() {
    destroyPlayer();
    const [path, query = ''] = location.hash.slice(2).split('?');
    const params = new URLSearchParams(query);
    (routes[path] || renderHome)(params);
    document.querySelectorAll('.nav-bar a').forEach(a => {
      const g = a.dataset.g || '';
      a.classList.toggle('on', g ? (path === 'cat' && (params.get('g') || '') === g) : path === '');
    });
  }
  window.addEventListener('hashchange', router);

  $form.addEventListener('submit', e => {
    e.preventDefault();
    const q = $input.value.trim();
    if (!q) return;
    location.hash = '#/search?wd=' + encodeURIComponent(q);
  });

  // ---------- 首页（推荐 + 分类） ----------
  let homeCache = null;
  async function getHomeData() {
    if (homeCache) return homeCache;
    const [a, b, c] = await Promise.all([
      api('/api/home', {}).catch(() => ({ code: 0 })),
      api('/api/home', { t: 31 }).catch(() => ({ code: 0, list: [] })),
      api('/api/home', { t: 21 }).catch(() => ({ code: 0, list: [] })),
    ]);
    homeCache = {
      code: a.code,
      categories: a.categories || [],
      latest: a.latest || [],
      series: b.list || [],
      action: c.list || [],
    };
    return homeCache;
  }

  const HOME_SOURCE = 'bfzy';
  function cardHtml(v) {
    return `<a class="card" href="#/play?source=${HOME_SOURCE}&id=${encodeURIComponent(v.id)}&name=${encodeURIComponent(v.name)}&year=${encodeURIComponent(v.year)}">
      <div class="poster">${v.pic ? `<img src="${esc(v.pic)}" loading="lazy" alt="">` : ''}</div>
      <div class="card-name">${esc(v.name)}</div>
      <div class="card-remark">${esc(v.remark || v.year || '')}</div>
    </a>`;
  }

  function rowHtml(title, items, moreHref) {
    return `<section class="row">
      <div class="row-head"><h2>${esc(title)}</h2>${moreHref ? `<a class="more" href="${moreHref}">更多 ›</a>` : ''}</div>
      <div class="row-items">${items.map(cardHtml).join('')}</div>
    </section>`;
  }

  async function renderHome() {
    $view.innerHTML = `<p class="msg">正在加载推荐…</p>`;
    const data = await getHomeData();
    if (data.code !== 1 || !data.latest.length) {
      $view.innerHTML = `<p class="msg">推荐内容加载失败，<a href="#/">点击重试</a></p>`;
      return;
    }
    const bannerItems = data.latest.filter(v => v.pic).slice(0, 4);
    $view.innerHTML = `
      <section class="banner">
        ${bannerItems.map((v, i) => `
        <a class="banner-item${i === 0 ? ' on' : ''}" href="#/play?source=${HOME_SOURCE}&id=${encodeURIComponent(v.id)}&name=${encodeURIComponent(v.name)}&year=${encodeURIComponent(v.year)}" style="background-image:url('${esc(v.pic)}')">
          <div class="banner-info"><b>${esc(v.name)}</b><span>${esc(v.remark || v.year || '')}</span></div>
          <img class="banner-poster" src="${esc(v.pic)}" alt="">
        </a>`).join('')}
        <div class="banner-dots">${bannerItems.map((_, i) => `<i data-i="${i}"${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div>
      </section>
      ${rowHtml('最近更新', data.latest)}
      ${rowHtml('热播国产剧', data.series, `#/cat?g=${encodeURIComponent('剧集')}&t=31&name=${encodeURIComponent('国产剧')}`)}
      ${rowHtml('动作电影', data.action, `#/cat?g=${encodeURIComponent('电影')}&t=21&name=${encodeURIComponent('动作片')}`)}`;
    // 轮播
    if (bannerItems.length > 1) {
      let bi = 0;
      const show = i => {
        bi = (i + bannerItems.length) % bannerItems.length;
        document.querySelectorAll('.banner-item').forEach((el, k) => el.classList.toggle('on', k === bi));
        document.querySelectorAll('.banner-dots i').forEach((el, k) => el.classList.toggle('on', k === bi));
      };
      const banner = document.querySelector('.banner');
      window.clearInterval(window.__bannerTimer);
      window.__bannerTimer = setInterval(() => show(bi + 1), 6000);
      banner.addEventListener('click', e => {
        const d = e.target.closest('.banner-dots i');
        if (d) { window.clearInterval(window.__bannerTimer); show(+d.dataset.i); }
      });
    }
  }

  // ---------- 分类页 ----------
  async function renderCat(params) {
    const g = params.get('g') || '分类';
    let t = params.get('t') || '';
    const data = await getHomeData();
    const group = (data.categories || []).find(c => c.group === g);
    const subs = group ? group.subs : [];
    if (!t && subs.length) t = String(subs[0][0]);
    const curName = params.get('name') || (subs.find(s => String(s[0]) === t) || ['', ''])[1] || g;
    $view.innerHTML = `
      <div class="cat-head">
        <h2>${esc(g)}${curName && curName !== g ? ' · ' + esc(curName) : ''}</h2>
        ${subs.length ? `<div class="chips">${subs.map(s =>
          `<a class="chip${String(s[0]) === t ? ' on' : ''}" href="#/cat?g=${encodeURIComponent(g)}&t=${s[0]}&name=${encodeURIComponent(s[1])}">${esc(s[1])}</a>`).join('')}</div>` : ''}
      </div>
      <div class="grid" id="catGrid"><p class="msg">加载中…</p></div>
      <div class="cat-more"><button id="catMore" hidden>加载更多</button></div>`;
    let pg = 1;
    const grid = document.getElementById('catGrid');
    const moreBtn = document.getElementById('catMore');
    const load = async () => {
      moreBtn.hidden = true;
      let d;
      try { d = await api('/api/home', { t, pg }); }
      catch { if (pg === 1) grid.innerHTML = `<p class="msg">加载失败，<a href="javascript:location.reload()">重试</a></p>`; return; }
      if (d.code !== 1 || !d.list.length) {
        if (pg === 1) grid.innerHTML = `<p class="msg">暂无内容</p>`;
        return;
      }
      grid.innerHTML = (pg === 1 ? '' : grid.innerHTML) + d.list.map(cardHtml).join('');
      pg += 1;
      moreBtn.hidden = false;
    };
    moreBtn.addEventListener('click', load);
    await load();
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

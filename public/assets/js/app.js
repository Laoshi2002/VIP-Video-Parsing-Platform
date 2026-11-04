(() => {
  const $view = document.getElementById('view');
  const $form = document.getElementById('searchForm');
  const $input = document.getElementById('searchInput');
  const DEFAULT_TITLE = document.title;
  let lastResults = [];   // 最近一次搜索结果，供详情/播放页"换源回退"使用

  // ---------- 工具 ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (path, params) =>
    fetch(`${path}?${new URLSearchParams(params)}`).then(r => r.json());
  const setTitle = t => { document.title = t ? `${t} — ${window.CONFIG.siteName}` : DEFAULT_TITLE; };
  const playHref = (sourceId, vodId, ep, name, year) =>
    `#/play?source=${encodeURIComponent(sourceId)}&id=${encodeURIComponent(vodId)}&ep=${ep || 0}&name=${encodeURIComponent(name)}&year=${encodeURIComponent(year)}`;
  const detailHref = (sourceId, vodId, name, year) =>
    `#/detail?source=${encodeURIComponent(sourceId)}&id=${encodeURIComponent(vodId)}&name=${encodeURIComponent(name)}&year=${encodeURIComponent(year)}`;

  function showToast(text) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------- 播放历史（localStorage） ----------
  const HKEY = 'vph_history';
  function histAll() {
    try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; }
  }
  function histSave(rec) {
    const list = histAll();
    const key = rec.source + '|' + rec.id;
    const rest = list.filter(r => (r.source + '|' + r.id) !== key);
    rest.unshift({ ...rec, ts: Date.now() });
    localStorage.setItem(HKEY, JSON.stringify(rest.slice(0, 50)));
  }
  const histGet = (source, id) => histAll().find(r => r.source === source && r.id === id) || null;
  const histByName = (name, year) => histAll().find(r => r.name === name && r.year === year) || null;

  function histCardHtml(r) {
    const pct = r.dur ? Math.min(100, Math.round(r.pos / r.dur * 100)) : 0;
    return `<a class="card hist-card" href="${playHref(r.source, r.id, r.ep || 0, r.name, r.year)}">
      <div class="poster">${r.pic ? `<img src="${esc(r.pic)}" loading="lazy" alt="">` : ''}
        <span class="hist-ep">${esc(r.epName || `第${(r.ep || 0) + 1}集`)}</span>
        <i class="hist-bar" style="width:${pct}%"></i></div>
      <div class="card-name">${esc(r.name)}</div>
      <div class="card-remark">${pct ? '看到 ' + pct + '%' : '继续观看'}</div>
    </a>`;
  }

  // ---------- 深浅主题（初始值由 index.html 内联脚本提前设置，避免闪烁） ----------
  document.getElementById('themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('vph_theme', next);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === 'light' ? '#f4f5f9' : '#0d0e12';
  });

  // ---------- 路由 ----------
  const routes = { '': renderHome, search: renderSearch, play: renderPlay, cat: renderCat, detail: renderDetail, history: renderHistory };
  function router() {
    destroyPlayer();
    stopBannerVideo();
    const [path, query = ''] = location.hash.slice(2).split('?');
    const params = new URLSearchParams(query);
    (routes[path] || renderHome)(params);
    document.querySelectorAll('.nav-bar a').forEach(a => {
      const g = a.dataset.g || '';
      a.classList.toggle('on', g ? (path === 'cat' && (params.get('g') || '') === g) : path === '');
    });
    const tabFor = { '': 'home', cat: 'cat', history: 'history' };
    document.querySelectorAll('.tab-bar a').forEach(a =>
      a.classList.toggle('on', a.dataset.tab === (tabFor[path] || '')));
  }
  window.addEventListener('hashchange', router);

  $form.addEventListener('submit', e => {
    e.preventDefault();
    const q = $input.value.trim();
    if (!q) return;
    location.hash = '#/search?wd=' + encodeURIComponent(q);
  });

  // ---------- 键盘快捷键（播放页生效） ----------
  document.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const v = document.getElementById('video');
    if (!v) return;
    if (e.key === ' ') { e.preventDefault(); v.paused ? v.play().catch(() => {}) : v.pause(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); v.currentTime += 5; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); }
    else if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else {
        const box = document.getElementById('playerBox');
        if (box && box.requestFullscreen) box.requestFullscreen().catch(() => {});
        else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
      }
    }
  });

  // ---------- 首页（推荐 + 分类） ----------
  let homeCache = null;
  async function getHomeData() {
    if (homeCache) return homeCache;
    const a = await api('/api/home', {}).catch(() => ({ code: 0 }));
    if (a.source) HOME_SOURCE = a.source;
    // 首页数据源与行分类 id 均由 /api/home 按当前源返回，自动跟随每日巡检排名
    const rows = a.rows || { action: 21, series: 31 };
    const [b, c] = await Promise.all([
      api('/api/home', { source: a.source || '', t: rows.series }).catch(() => ({ code: 0, list: [] })),
      api('/api/home', { source: a.source || '', t: rows.action }).catch(() => ({ code: 0, list: [] })),
    ]);
    homeCache = {
      code: a.code,
      source: a.source || HOME_SOURCE,
      categories: a.categories || [],
      rows: rows,
      latest: a.latest || [],
      series: b.list || [],
      action: c.list || [],
    };
    return homeCache;
  }

  let HOME_SOURCE = 'bfzy'; // 首页数据源，由 /api/home 返回并自动跟随巡检排名
  function cardHtml(v) {
    const badge = v.remark ? `<span class="badge">${esc(v.remark)}</span>` : '';
    return `<a class="card" href="${detailHref(HOME_SOURCE, v.id, v.name, v.year)}">
      <div class="poster">${v.pic ? `<img src="${esc(v.pic)}" loading="lazy" alt="">` : ''}${badge}</div>
      <div class="card-name">${esc(v.name)}</div>
      <div class="card-remark">${esc(v.year || '')}</div>
    </a>`;
  }

  const CHEVRON_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 6-6 6 6 6"/></svg>';
  const CHEVRON_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9.5 6 6 6-6 6"/></svg>';
  const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
  const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.6z"/></svg>';
  const NEXT_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5.5v13l9-6.5zM16.6 5H19v14h-2.6z"/></svg>';
  const VOL_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h3.6L13 20V4L7.6 9zM15.5 8.6a5 5 0 0 1 0 6.8l1.3 1.3a6.8 6.8 0 0 0 0-9.4z"/></svg>';
  const MUTE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h3.6L13 20V4L7.6 9zM15.2 9.3l1.3-1.3 2 2 2-2 1.3 1.3-2 2 2 2-1.3 1.3-2-2-2 2-1.3-1.3 2-2z"/></svg>';
  const FULL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';

  function rowHtml(title, items, moreHref, cardFn = cardHtml) {
    return `<section class="row">
      <div class="row-head"><h2>${esc(title)}</h2>${moreHref ? `<a class="more" href="${moreHref}">更多</a>` : ''}</div>
      <div class="row-body">
        <button class="row-arrow prev" type="button" aria-label="向左滚动">${CHEVRON_L}</button>
        <div class="row-items">${items.map(cardFn).join('')}</div>
        <button class="row-arrow next" type="button" aria-label="向右滚动">${CHEVRON_R}</button>
      </div>
    </section>`;
  }

  // 行滚动箭头（点击滚动 / 按位置显隐）与海报图片渐显，全局事件委托
  document.addEventListener('click', e => {
    const b = e.target.closest('.row-arrow');
    if (!b) return;
    const items = b.parentElement.querySelector('.row-items');
    items.scrollBy({ left: (b.classList.contains('next') ? 1 : -1) * items.clientWidth * 0.9, behavior: 'smooth' });
  });
  document.addEventListener('scroll', e => {
    const el = e.target;
    if (!el || !el.classList || !el.classList.contains('row-items')) return;
    const prev = el.parentElement.querySelector('.row-arrow.prev');
    const next = el.parentElement.querySelector('.row-arrow.next');
    if (prev) prev.classList.toggle('hide', el.scrollLeft < 10);
    if (next) next.classList.toggle('hide', el.scrollLeft > el.scrollWidth - el.clientWidth - 10);
  }, true);
  document.addEventListener('load', e => {
    if (e.target && e.target.tagName === 'IMG') e.target.classList.add('ld');
  }, true);
  // 图片加载失败：隐藏 img，让海报底色兜底，避免闪裂图图标
  document.addEventListener('error', e => {
    if (e.target && e.target.tagName === 'IMG') e.target.classList.add('err');
  }, true);
  // 缓存命中的图片插入时可能已 complete、不再触发 load 事件，用 MutationObserver 兜底补亮
  const fixImg = img => { if (img.complete) img.classList.add(img.naturalWidth ? 'ld' : 'err'); };
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const imgs = n.tagName === 'IMG' ? [n] : (n.querySelectorAll ? [...n.querySelectorAll('img')] : []);
      imgs.forEach(fixImg);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // —— 轮播视频片段：当前帧静音自动播放对应影片第一集的中段循环，失败时保持海报图 ——
  const bannerVideo = { hls: null, el: null, playing: false, timer: 0 };
  let bannerSeq = 0;
  const bannerM3u8Cache = new Map();

  function stopBannerVideo() {
    window.clearTimeout(bannerVideo.timer);
    bannerVideo.playing = false;
    if (bannerVideo.hls) { try { bannerVideo.hls.destroy(); } catch {} bannerVideo.hls = null; }
    if (bannerVideo.el) {
      const host = bannerVideo.el.parentElement;
      if (host) host.classList.remove('has-video');
      bannerVideo.el.remove();
      bannerVideo.el = null;
    }
  }

  async function playBannerSlide(item, host, seq) {
    let url = bannerM3u8Cache.get(item.id);
    if (url === undefined) {
      try {
        const d = await api('/api/detail', { source: HOME_SOURCE, id: item.id });
        url = d.code === 1 && d.episodes && d.episodes[0] ? d.episodes[0].url : null;
      } catch { url = null; }
      bannerM3u8Cache.set(item.id, url);
    }
    if (!url || seq !== bannerSeq || !host.isConnected) return null;
    const v = document.createElement('video');
    v.className = 'banner-video';
    v.muted = true; v.loop = true; v.autoplay = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    host.appendChild(v);
    bannerVideo.el = v;
    if (window.Hls && window.Hls.isSupported()) {
      const h = new window.Hls({ maxBufferLength: 10, capLevelToPlayerSize: true });
      bannerVideo.hls = h;
      let sought = false, clipFrom = 0;
      // 跳过片头进入中段，并把循环窗口限制在 30 秒内，形成"精彩片段"循环
      h.on(window.Hls.Events.LEVEL_LOADED, (_, data) => {
        const dur = data.details && data.details.totalduration;
        if (sought || !dur) return;
        sought = true;
        clipFrom = Math.min(10, dur / 3);
        v.currentTime = clipFrom;
      });
      v.addEventListener('timeupdate', () => {
        if (clipFrom && (v.currentTime > clipFrom + 30 || v.currentTime < clipFrom - 1)) v.currentTime = clipFrom;
      });
      h.on(window.Hls.Events.ERROR, (_, data) => { if (data.fatal) stopBannerVideo(); });
      h.loadSource(url);
      h.attachMedia(v);
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url; // Safari 原生 HLS
    } else return null;
    v.play().catch(() => {});
    return v;
  }


  async function renderHome() {
    setTitle('');
    // 骨架屏：加载中保持版式稳定
    const skelCards = Array.from({ length: 8 }, () => '<div class="skel-card"><i></i><i></i></div>').join('');
    $view.innerHTML = `<div class="skel-banner"></div>
      <div class="skel-row"><div class="skel-line"></div><div class="skel-items">${skelCards}</div></div>
      <div class="skel-row"><div class="skel-line"></div><div class="skel-items">${skelCards}</div></div>`;
    const data = await getHomeData();
    if (data.code !== 1 || !data.latest.length) {
      $view.innerHTML = `<p class="msg">推荐内容加载失败，<a href="#/">点击重试</a></p>`;
      return;
    }
    const bannerItems = data.latest.filter(v => v.pic).slice(0, 4);
    const histList = histAll().slice(0, 12);
    $view.innerHTML = `
      <section class="banner">
        ${bannerItems.map((v, i) => `
        <a class="banner-item${i === 0 ? ' on' : ''}" href="${detailHref(HOME_SOURCE, v.id, v.name, v.year)}" style="background-image:url('${esc(v.pic)}')">
          <div class="banner-info">
            <b>${esc(v.name)}</b>
            <div class="banner-meta">${[v.year, v.remark].filter(Boolean).map(s => `<span>${esc(s)}</span>`).join('')}</div>
            <span class="banner-cta">立即播放</span>
          </div>
          <img class="banner-poster" src="${esc(v.pic)}" alt="">
        </a>`).join('')}
        <div class="banner-dots">${bannerItems.map((_, i) => `<i data-i="${i}"${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div>
        ${bannerItems.length > 1 ? `<button class="banner-arrow prev" type="button" aria-label="上一张">${CHEVRON_L}</button>
        <button class="banner-arrow next" type="button" aria-label="下一张">${CHEVRON_R}</button>` : ''}
      </section>
      ${histList.length ? rowHtml('继续观看', histList, '#/history', histCardHtml) : ''}
      ${rowHtml('最近更新', data.latest)}
      ${rowHtml('热播国产剧', data.series, `#/cat?g=${encodeURIComponent('剧集')}&t=${data.rows.series}&name=${encodeURIComponent('国产剧')}`)}
      ${rowHtml('动作电影', data.action, `#/cat?g=${encodeURIComponent('电影')}&t=${data.rows.action}&name=${encodeURIComponent('动作片')}`)}`;
    // 轮播：自动播放 + 圆点 + 触摸滑动 + 当前帧视频片段
    if (bannerItems.length > 1) {
      let bi = 0;
      // 未起播按 7 秒轮换；视频起播后延长到 15 秒
      const schedule = () => {
        window.clearTimeout(bannerVideo.timer);
        bannerVideo.timer = window.setTimeout(() => show(bi + 1), bannerVideo.playing ? 15000 : 7000);
      };
      const show = i => {
        bi = (i + bannerItems.length) % bannerItems.length;
        document.querySelectorAll('.banner-item').forEach((el, k) => el.classList.toggle('on', k === bi));
        document.querySelectorAll('.banner-dots i').forEach((el, k) => el.classList.toggle('on', k === bi));
        stopBannerVideo();
        schedule();
        const seq = ++bannerSeq;
        const host = document.querySelectorAll('.banner-item')[bi];
        playBannerSlide(bannerItems[bi], host, seq).then(v => {
          if (!v || seq !== bannerSeq) return;
          v.addEventListener('playing', () => {
            bannerVideo.playing = true;
            v.classList.add('playing');
            host.classList.add('has-video');
            schedule();
          }, { once: true });
        });
      };
      const banner = document.querySelector('.banner');
      banner.addEventListener('click', e => {
        const d = e.target.closest('.banner-dots i');
        if (d) { show(+d.dataset.i); return; }
        const a = e.target.closest('.banner-arrow');
        if (a) show(bi + (a.classList.contains('next') ? 1 : -1));
      });
      let tx = 0;
      banner.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
      banner.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - tx;
        if (Math.abs(dx) > 40) show(bi + (dx < 0 ? 1 : -1));
      }, { passive: true });
      // PC 悬停暂停轮换（视频继续播）
      banner.addEventListener('mouseenter', () => window.clearTimeout(bannerVideo.timer));
      banner.addEventListener('mouseleave', schedule);
      // 页面不可见时停止播放与轮换，回到页面恢复
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopBannerVideo();
        else if (document.querySelector('.banner') && bannerItems.length > 1) show(bi);
      });
      show(0);
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
    setTitle(g + (curName && curName !== g ? ' · ' + curName : ''));
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
      try { d = await api('/api/home', { source: homeCache.source || '', t, pg }); }
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
    setTitle('搜索：' + wd);
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
      const badge = v.remark ? `<span class="badge">${esc(v.remark)}</span>` : '';
      return `<a class="card" href="${detailHref(s.source_id, s.vod_id, v.name, v.year)}">
        <div class="poster">${v.pic ? `<img src="${esc(v.pic)}" loading="lazy" alt="">` : ''}${badge}</div>
        <div class="card-name">${esc(v.name)}</div>
        <div class="card-remark">${esc(v.year || '')}</div>
      </a>`;
    }).join('')}</div>`;
  }

  // ---------- 换源回退：从搜索结果里找同片的可用片源 ----------
  function findAlternatives(name, year) {
    return lastResults.filter(v => v.name === name && v.year === year).flatMap(v => v.sources);
  }
  async function findWorkingDetail(name, year, excludeSource) {
    for (const s of findAlternatives(name, year).filter(s => s.source_id !== excludeSource)) {
      try {
        const d = await api('/api/detail', { source: s.source_id, id: s.vod_id });
        if (d.code === 1 && d.episodes.length) return { d, s };
      } catch { /* 尝试下一个源 */ }
    }
    return null;
  }

  // ---------- 详情页 ----------
  async function renderDetail(params) {
    let sourceId = params.get('source') || '';
    let vodId = params.get('id') || '';
    const name = params.get('name') || '';
    const year = params.get('year') || '';
    $view.innerHTML = `<p class="msg">正在加载详情…</p>`;
    let data;
    try { data = await api('/api/detail', { source: sourceId, id: vodId }); }
    catch { data = { code: 0, msg: '' }; }
    // 当前源无内容 → 自动尝试搜索结果里的其他片源
    if (data.code !== 1 || !data.episodes.length) {
      const alt = await findWorkingDetail(name, year, sourceId);
      if (alt) { data = alt.d; sourceId = alt.s.source_id; vodId = alt.s.vod_id; }
    }
    if (data.code !== 1 || !data.episodes.length) {
      $view.innerHTML = `<p class="msg">${esc(data.msg || '该片源暂无内容')}，<a href="#/search?wd=${encodeURIComponent(name || data.name || '')}">搜索同名影片</a></p>`;
      return;
    }
    setTitle(data.name);
    const linkName = name || data.name;
    const linkYear = year || data.year;
    // 跨源匹配观看记录：优先精确匹配，再按片名+年份匹配
    const hist = histGet(sourceId, vodId) || histByName(linkName, linkYear) || histByName(data.name, data.year);
    const resumeEp = hist ? Math.min(hist.ep || 0, data.episodes.length - 1) : 0;
    const meta = [data.year, data.type, data.remark, data.sourceName ? data.sourceName + '片源' : ''].filter(Boolean).map(esc).join(' · ');
    const longDesc = (data.content || '').length > 90;
    $view.innerHTML = `
      <div class="detail-wrap">
        <div class="detail-hero">
          ${data.pic ? `<div class="detail-hero-blur" style="background-image:url('${esc(data.pic)}')"></div>` : ''}
          <div class="detail-hero-inner">
            <div class="detail-poster">${data.pic ? `<img src="${esc(data.pic)}" alt="${esc(data.name)}">` : ''}</div>
            <div class="detail-info">
              <h1>${esc(data.name)}</h1>
              <div class="detail-meta">${meta}</div>
              ${data.content ? `<p class="detail-desc${longDesc ? ' clamp' : ''}" id="detailDesc">${esc(data.content)}</p>
              ${longDesc ? `<button class="desc-toggle" id="descToggle">展开</button>` : ''}` : '<p class="detail-desc">暂无剧情简介</p>'}
              ${data.director ? `<p class="detail-people">导演：${esc(data.director)}</p>` : ''}
              ${data.actor ? `<p class="detail-people">主演：${esc(data.actor)}</p>` : ''}
              <div class="detail-actions">
                <a class="btn-primary" href="${playHref(sourceId, vodId, resumeEp, linkName, linkYear)}">${hist ? '继续播放' : '立即播放'}</a>
                ${hist ? `<span class="resume-hint">上次看到 ${esc(hist.epName || `第${resumeEp + 1}集`)}</span>` : ''}
              </div>
            </div>
          </div>
        </div>
        <section class="detail-eps">
          <div class="row-head"><h2>选集 <span class="ep-count">共 ${data.episodes.length} 集</span></h2></div>
          <div class="episodes">${data.episodes.map((e, i) =>
            `<a href="${playHref(sourceId, vodId, i, linkName, linkYear)}"${i === resumeEp ? ' class="on"' : ''}>${esc(e.name)}</a>`).join('')}</div>
        </section>
      </div>`;
    const toggle = document.getElementById('descToggle');
    if (toggle) toggle.addEventListener('click', () => {
      const clamped = document.getElementById('detailDesc').classList.toggle('clamp');
      toggle.textContent = clamped ? '展开' : '收起';
    });
  }

  // ---------- 播放页 ----------
  let player = null;        // hls 实例
  let currentPlay = null;   // { detail, epIndex, alts, sourceId, vodId }
  let playRetried = false;
  let pendingSeek = 0;      // 待恢复的播放位置（秒）
  let playerRate = 1;       // 倍速记忆（自绘控制层）

  // —— 自绘播放器控制层（腾讯风格）：进度条/播放/倍速/音量/全屏/自动隐藏 ——
  function setupPlayerUI(video) {
    const box = document.getElementById('playerBox');
    const ui = document.getElementById('playerUI');
    const $ = id => document.getElementById(id);
    const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

    // 状态同步
    const flash = icon => { const f = $('puFlash'); if (!f) return; f.innerHTML = icon; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); };
    const sync = () => {
      const pp = $('puPlay'), big = $('puBig'), tm = $('puTime'), pl = $('puPlayed'), sp = $('puSpeed'), qb = $('puQuality');
      if (!pp) return; // 换源/换集重渲染后旧监听器不再生效
      const paused = video.paused;
      pp.innerHTML = paused ? PLAY_SVG : PAUSE_SVG;
      big.style.display = paused ? '' : 'none';
      const d = video.duration || 0, c = video.currentTime || 0;
      tm.textContent = `${fmt(c)} / ${fmt(d)}`;
      pl.style.width = d ? `${(c / d) * 100}%` : '0%';
      sp.textContent = playerRate === 1 ? '倍速' : playerRate + 'x';
      if (qb.dataset.single && video.videoHeight) { // 单画质片源：按真实分辨率标注档位（横版按宽度判定）
        const w = video.videoWidth, h = video.videoHeight;
        const wRef = w >= h ? w : Math.round(h * 16 / 9);
        qb.textContent = wRef >= 2400 ? '2K' : wRef >= 1920 ? '1080P' : wRef >= 1280 ? '720P' : wRef >= 854 ? '480P' : '360P';
      }
    };
    ['play', 'pause', 'ended', 'loadedmetadata', 'durationchange'].forEach(ev => video.addEventListener(ev, sync));
    video.addEventListener('timeupdate', () => {
      sync();
      try {
        const b = video.buffered;
        if (b.length && video.duration) $('puBuffered').style.width = `${(b.end(b.length - 1) / video.duration) * 100}%`;
      } catch {}
    });

    // 点击画面暂停/播放；1 秒意图锁定，防内嵌浏览器原生切换干扰
    let reconcileTimer = 0;
    const togglePlay = () => {
      window.clearTimeout(reconcileTimer);
      if (video.paused) {
        video.play().catch(() => {});
        flash(PLAY_SVG);
        reconcileTimer = window.setTimeout(() => { if (!video.ended && video.paused) video.play().catch(() => {}); }, 1000);
      } else {
        video.pause();
        flash(PAUSE_SVG);
        reconcileTimer = window.setTimeout(() => { if (!video.ended && !video.paused) video.pause(); }, 1000);
      }
      sync();
    };
    video.addEventListener('click', e => { e.preventDefault(); togglePlay(); });
    $('puBig').addEventListener('click', togglePlay);
    $('puPlay').addEventListener('click', togglePlay);

    // 进度条：点击/拖拽跳转
    const progress = $('puProgress');
    let dragging = false;
    const seekTo = e => {
      const r = progress.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      if (video.duration) video.currentTime = x * video.duration;
      sync();
    };
    progress.addEventListener('pointerdown', e => { dragging = true; progress.setPointerCapture(e.pointerId); seekTo(e); });
    progress.addEventListener('pointermove', e => { if (dragging) seekTo(e); });
    progress.addEventListener('pointerup', () => { dragging = false; });
    progress.addEventListener('pointercancel', () => { dragging = false; });

    // 进度条悬停时间提示（腾讯式）
    const tip = document.createElement('div');
    tip.className = 'pu-tip';
    progress.appendChild(tip);
    progress.addEventListener('pointermove', e => {
      if (!video.duration) { tip.style.opacity = 0; return; }
      const r = progress.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      tip.textContent = fmt(x * video.duration);
      tip.style.left = `${x * 100}%`;
      tip.style.opacity = 1;
    });
    progress.addEventListener('pointerleave', () => { tip.style.opacity = 0; });

    // 倍速菜单
    const speedMenu = $('puSpeedMenu');
    const qualityMenu = $('puQualityMenu');
    $('puSpeed').addEventListener('click', e => { e.stopPropagation(); qualityMenu.hidden = true; speedMenu.hidden = !speedMenu.hidden; });
    speedMenu.addEventListener('click', e => {
      const b = e.target.closest('button[data-r]');
      if (!b) return;
      playerRate = +b.dataset.r;
      video.playbackRate = playerRate;
      speedMenu.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      speedMenu.hidden = true;
      sync();
    });
    document.addEventListener('click', e => {
      if (!speedMenu.hidden && !e.target.closest('.pu-menu-wrap')) speedMenu.hidden = true;
      if (!qualityMenu.hidden && !e.target.closest('.pu-menu-wrap')) qualityMenu.hidden = true;
    });

    // 清晰度菜单（MANIFEST_PARSED 时由 startHls 填充；腾讯式：选择后按钮显示当前画质）
    const qualityBtn = $('puQuality');
    $('puQuality').addEventListener('click', e => {
      e.stopPropagation();
      if (!qualityMenu.hidden || qualityMenu.children.length) { speedMenu.hidden = true; qualityMenu.hidden = !qualityMenu.hidden; }
    });
    qualityMenu.addEventListener('click', e => {
      const b = e.target.closest('button[data-q]');
      if (!b || !player) return;
      player.currentLevel = +b.dataset.q;
      qualityMenu.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      qualityBtn.textContent = b.textContent === '自动' ? '自动' : b.textContent;
      qualityMenu.hidden = true;
    });

    // 音量（移动端隐藏，用系统音量）
    const syncVol = () => {
      const mb = $('puMute'), vol = $('puVol');
      if (!mb || !vol) return; // 换源/换集重渲染后旧监听器不再生效
      mb.innerHTML = video.muted || video.volume === 0 ? MUTE_SVG : VOL_SVG;
      vol.value = video.muted ? 0 : video.volume;
    };
    $('puVol').addEventListener('input', () => { video.volume = +$('puVol').value; video.muted = video.volume === 0; syncVol(); });
    $('puMute').addEventListener('click', () => { video.muted = !video.muted; syncVol(); });
    video.addEventListener('volumechange', syncVol);

    // 全屏（容器全屏，控制层随之保留；iOS 用视频原生全屏）
    $('puFull').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (box.requestFullscreen) box.requestFullscreen().catch(() => {});
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    });
    video.addEventListener('dblclick', () => $('puFull').click()); // 双击全屏（腾讯式）

    // 底部"下一集"
    $('puNextEp').addEventListener('click', () => {
      if (currentPlay && currentPlay.epIndex < currentPlay.detail.episodes.length - 1) playEpisode(currentPlay.epIndex + 1);
    });

    // 控制层自动隐藏（播放中 2.5 秒无操作隐藏，暂停时常显）
    let hideTimer = 0;
    const wake = () => {
      ui.classList.remove('hide');
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => { if (!video.paused && !dragging) ui.classList.add('hide'); }, 2500);
    };
    box.addEventListener('pointermove', wake);
    box.addEventListener('pointerdown', wake);
    box.addEventListener('pointerleave', () => { if (!video.paused) ui.classList.add('hide'); });
    video.addEventListener('play', wake);
    video.addEventListener('pause', wake);
    wake();

    video.playbackRate = playerRate;
    sync();
    syncVol();
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
      const alt = await findWorkingDetail(name, year, sourceId);
      if (alt) { data = alt.d; sourceId = alt.s.source_id; vodId = alt.s.vod_id; }
    }
    if (data.code !== 1 || !data.episodes.length) {
      $view.innerHTML = `<p class="msg">${esc(data.msg || '该片源暂无可播放剧集')}，<a href="javascript:history.back()">返回换源</a></p>`;
      return;
    }
    setTitle(data.name);
    const alts = findAlternatives(name, year);
    const epIndex = Math.min(parseInt(params.get('ep') || '0', 10) || 0, data.episodes.length - 1);
    currentPlay = { detail: data, epIndex, alts, sourceId, vodId };
    const collapsed = data.episodes.length > 30 && epIndex < 30;
    $view.innerHTML = `
      <div class="play-wrap">
        <div class="player-box" id="playerBox">
          <video id="video" playsinline></video>
          <div id="playMsg" class="play-msg" hidden></div>
          <div class="player-ui" id="playerUI">
            <div class="pu-flash" id="puFlash"></div>
            <button id="puBig" class="pu-big" type="button" aria-label="播放">${PLAY_SVG}</button>
            <div class="pu-bottom">
              <div class="pu-progress" id="puProgress">
                <div class="pu-buffered" id="puBuffered"></div>
                <div class="pu-played" id="puPlayed"><span class="pu-thumb"></span></div>
              </div>
              <div class="pu-bar">
                <button id="puPlay" type="button" aria-label="播放/暂停">${PLAY_SVG}</button>
                <button id="puNextEp" type="button" aria-label="下一集">${NEXT_SVG}</button>
                <span class="pu-time" id="puTime">00:00 / 00:00</span>
                <span class="pu-spacer"></span>
                <div class="pu-menu-wrap">
                  <button id="puSpeed" type="button">倍速</button>
                  <div class="pu-menu" id="puSpeedMenu" hidden>${['0.5', '0.75', '1', '1.25', '1.5', '2'].map(r =>
                    `<button data-r="${r}"${+r === 1 ? ' class="on"' : ''}>${+r === 1 ? '正常' : r + 'x'}</button>`).join('')}</div>
                </div>
                <div class="pu-menu-wrap">
                  <button id="puQuality" type="button">清晰度</button>
                  <div class="pu-menu" id="puQualityMenu" hidden></div>
                </div>
                <div class="pu-vol">
                  <button id="puMute" type="button" aria-label="静音">${VOL_SVG}</button>
                  <input id="puVol" type="range" min="0" max="1" step="0.05" value="1" aria-label="音量">
                </div>
                <button id="puFull" type="button" aria-label="全屏">${FULL_SVG}</button>
              </div>
            </div>
          </div>
        </div>
        <div class="play-title"><b>${esc(data.name)}</b><span id="epNow"></span>
          <a class="back-detail" href="${detailHref(sourceId, vodId, name || data.name, year || data.year)}">影片详情 ›</a></div>
        <div class="episodes${collapsed ? ' collapsed' : ''}">${data.episodes.map((e, i) =>
          `<button data-ep="${i}" ${i === epIndex ? 'class="on"' : ''}>${esc(e.name)}</button>`).join('')}</div>
        ${collapsed ? `<div class="ep-toggle-wrap"><button id="epToggle" class="ghost-btn">展开全部 ${data.episodes.length} 集</button></div>` : ''}
      </div>`;

    $view.querySelector('.episodes').addEventListener('click', e => {
      const b = e.target.closest('button[data-ep]');
      if (b) playEpisode(+b.dataset.ep);
    });
    const epToggle = document.getElementById('epToggle');
    if (epToggle) epToggle.addEventListener('click', () => {
      $view.querySelector('.episodes').classList.remove('collapsed');
      epToggle.parentElement.remove();
    });

    const video = document.getElementById('video');
    setupPlayerUI(video);
    // 自动连播
    video.addEventListener('ended', () => {
      if (currentPlay && currentPlay.epIndex < currentPlay.detail.episodes.length - 1) {
        showToast('自动播放下一集');
        playEpisode(currentPlay.epIndex + 1);
      }
    });
    // 断点续播：元数据就绪后恢复进度、应用倍速
    video.addEventListener('loadedmetadata', () => {
      if (pendingSeek > 15 && video.duration && pendingSeek < video.duration * 0.95) {
        video.currentTime = pendingSeek;
      }
      pendingSeek = 0;
    });
    // 每5秒记录播放进度
    let lastSave = 0;
    video.addEventListener('timeupdate', () => {
      if (!video.duration || !currentPlay || Date.now() - lastSave < 5000) return;
      lastSave = Date.now();
      const prev = histGet(currentPlay.sourceId, currentPlay.vodId);
      if (prev && prev.ep === currentPlay.epIndex) {
        histSave({ ...prev, pos: video.currentTime, dur: video.duration });
      }
    });

    playEpisode(epIndex);
    // 后台测速：自动切换到画质评分最高（码率×分辨率）的片源（不阻塞起播）
    if (alts.length > 1) autoPickBestSource(alts, epIndex);
  }

  const fmtKbps = k => (k >= 1000 ? (k / 1000).toFixed(1) + 'M' : k + 'k');
  // 画质评分：码率 × min(分辨率高度,1080)/1080 —— 伪1080（如1080x608）码率再高也不如真1080p
  const qScore = (kbps, res) => {
    const h = res ? parseInt(res.split('x')[1], 10) || 0 : 0;
    return kbps * Math.min(h || 1080, 1080) / 1080;
  };
  // 对各片源并行测速，择画质评分最高者自动切换（当前源测不出码率或优势不足 10% 则不动，避免无意义重载）
  async function autoPickBestSource(alts, epIndex) {
    const results = await Promise.all(alts.map(async a => {
      try {
        const r = await api('/api/bitrate', { source: a.source_id, id: a.vod_id, ep: epIndex });
        return { ...a, kbps: r && r.code ? (r.kbps || 0) : 0, res: r && r.resolution || '' };
      } catch { return { ...a, kbps: 0, res: '' }; }
    }));
    if (!currentPlay) return;
    const valid = results.filter(r => r.kbps > 0);
    const cur = valid.find(r => r.source_id === currentPlay.sourceId);
    if (!valid.length || !cur) return;
    const best = valid.reduce((a, b) => (qScore(b.kbps, b.res) > qScore(a.kbps, a.res) ? b : a));
    // 阈值同样按画质评分比较：裸码率比较会让伪1080（码率虚高）永远不被切走
    if (best.source_id === currentPlay.sourceId || qScore(best.kbps, best.res) <= qScore(cur.kbps, cur.res) * 1.1) return;
    const v = document.getElementById('video');
    if (v && v.currentTime > 1) sessionStorage.setItem('vph_auto_seek', String(Math.floor(v.currentTime)));
    showToast(`已自动切换到更高画质片源：${best.source_name || best.source_id}（${fmtKbps(best.kbps)} ≻ ${fmtKbps(cur.kbps)}）`);
    location.hash = playHref(best.source_id, best.vod_id, epIndex, currentPlay.detail.name, currentPlay.detail.year || '');
  }

  function showPlayMsg(text) {
    const el = document.getElementById('playMsg');
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
  }

  function playEpisode(i) {
    const ep = currentPlay.detail.episodes[i];
    currentPlay.epIndex = i;
    playRetried = false;
    document.getElementById('epNow').textContent = ` · ${ep.name}`;
    document.querySelectorAll('.episodes button').forEach(b =>
      b.classList.toggle('on', +b.dataset.ep === i));
    // 折叠态下跳到预览范围之外的集数时自动展开
    const eps = $view.querySelector('.episodes');
    if (eps && eps.classList.contains('collapsed') && i >= 30) {
      eps.classList.remove('collapsed');
      const t = document.getElementById('epToggle');
      if (t) t.parentElement.remove();
    }
    showPlayMsg('');
    // 记录历史：同集重进保留进度用于续播，换集则清零
    const prev = histGet(currentPlay.sourceId, currentPlay.vodId);
    const sameEp = prev && prev.ep === i;
    // 片源自动升级时迁移播放进度（优先于历史续播位置）
    const autoSeek = parseInt(sessionStorage.getItem('vph_auto_seek') || '0', 10);
    sessionStorage.removeItem('vph_auto_seek');
    pendingSeek = autoSeek > 0 ? autoSeek : (sameEp && prev.pos > 15 ? prev.pos : 0);
    histSave({
      source: currentPlay.sourceId, id: currentPlay.vodId,
      name: currentPlay.detail.name, year: currentPlay.detail.year || '',
      pic: currentPlay.detail.pic || '', remark: currentPlay.detail.remark || '',
      ep: i, epName: ep.name, epTotal: currentPlay.detail.episodes.length,
      pos: pendingSeek, dur: sameEp ? (prev.dur || 0) : 0,
    });
    history.replaceState(null, '', playHref(currentPlay.sourceId, currentPlay.vodId, i, currentPlay.detail.name, currentPlay.detail.year || ''));
    startHls(ep.url);
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
        const menu = document.getElementById('puQualityMenu');
        const btn = document.getElementById('puQuality');
        if (!menu || !btn) return;
        const levels = player.levels || [];
        if (levels.length < 2) { // 单一画质：不弹菜单，按钮显示实际画质档并置灰
          menu.hidden = true;
          btn.textContent = '清晰度';
          btn.dataset.single = '1';
          btn.disabled = true;
          return;
        }
        btn.disabled = false; delete btn.dataset.single;
        menu.innerHTML = ['<button data-q="-1" class="on">自动</button>']
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

  function destroyPlayer() {
    if (player) { player.destroy(); player = null; }
    pendingSeek = 0;
  }

  // ---------- 看过页 ----------
  function renderHistory() {
    setTitle('看过');
    const list = histAll();
    $view.innerHTML = `
      <div class="cat-head hist-head">
        <h2>看过</h2>
        ${list.length ? `<button id="clearHist" class="ghost-btn">清空记录</button>` : ''}
      </div>
      ${list.length
        ? `<div class="grid">${list.map(histCardHtml).join('')}</div>`
        : `<p class="msg">还没有观看记录，<a href="#/">去首页看看</a></p>`}`;
    const btn = document.getElementById('clearHist');
    if (btn) btn.addEventListener('click', () => {
      localStorage.removeItem(HKEY);
      renderHistory();
    });
  }

  router();
})();

// ==UserScript==
// @name         小窗净读器（通用适配/目录分页/多页拼合/可拖可调/记忆进度/可扩展）
// @namespace    https://github.com/jx-j-x/Greasemonkey-script
// @version      0.6.2
// @description  Alt+L 输入链接→抽正文；Alt+T 目录（每页50条，可跳页）；Alt+R 续读上次；←/→ 翻页/跳章；↑/↓ 平滑滚动；Ctrl+Alt+X 显示/隐藏。多站点适配可扩展，跨域抓取（含 GBK/Big5），小窗可拖动/调整大小，自动记忆目录与最后章节链接。
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      *
// @connect      3wwd.com
// @connect      m.3wwd.com
// @connect      biquge.tw
// @connect      www.biquge.tw
// @connect      m.biquge.tw
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ========== 样式 ==========
  GM_addStyle(`
  #cr-panel{
    position: fixed; left: 16px; bottom: 16px; width: 300px; height: 300px;
    background: #fff; color:#222; border:1px solid #ddd; border-radius:10px;
    box-shadow:0 6px 24px rgba(0,0,0,.15); z-index: 2147483646;
    display:none; overflow:hidden; font:14px/1.7 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  }
  #cr-drag{ position:absolute; top:0; left:0; right:0; height:10px; cursor:move; z-index:3; }
  #cr-resize{
    position:absolute; right:2px; bottom:2px; width:14px; height:14px; cursor:nwse-resize; z-index:3; opacity:.7;
    background:linear-gradient(135deg, rgba(0,0,0,0) 0, rgba(0,0,0,0) 50%, #cfcfcf 50%, #cfcfcf 100%);
    border-radius:3px;
  }
  #cr-content{ height:100%; overflow:auto; padding:12px 14px; position:relative; z-index:1; }
  #cr-content p{ margin:0 0 6px 0; }

  /* URL 输入弹窗 & 目录弹窗 */
  #cr-modal, #cr-toc{
    position: fixed; inset: 0; background: rgba(0,0,0,.35); display:none;
    align-items: center; justify-content: center; z-index: 2147483647;
  }
  #cr-modal .cr-box, #cr-toc .cr-box{
    width: min(800px, 96vw); background:#fff; border-radius:12px;
    box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 16px;
  }
  #cr-modal h3, #cr-toc h3{ margin:0 0 10px 0; font-size:16px; }
  #cr-url{
    width:100%; box-sizing:border-box; padding:10px 12px; font-size:14px;
    border:1px solid #ddd; border-radius:8px; outline:none;
  }
  #cr-modal .ops{ margin-top:12px; display:flex; gap:8px; justify-content:flex-end; }
  #cr-modal button{ border:1px solid #ddd; background:#fff; border-radius:8px; padding:6px 12px; cursor:pointer; }
  #cr-modal button.primary{ background:#111; color:#fff; border-color:#111; }

  /* 目录弹窗 */
  #cr-toc .cr-box{ padding:12px 12px 8px;}
  .cr-toc-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
  .cr-toc-head .title{ font-weight:600; }
  .cr-toc-head .close{ border:1px solid #ddd; background:#fff; border-radius:8px; padding:6px 10px; cursor:pointer; }

  .toc-list{
    max-height: 65vh; overflow:auto; border:1px solid #eee; border-radius:8px;
    padding: 6px;
  }
  .toc-item{
    padding:6px 8px; border-radius:6px; cursor:pointer; user-select:none;
    display:flex; gap:10px; align-items:flex-start;
  }
  .toc-item:hover{ background:#f6f6f6; }
  .toc-item.active{ background:#111; color:#fff; }
  .toc-idx{ min-width: 56px; opacity:.7; font-variant-numeric: tabular-nums; }
  .toc-title{ flex:1; word-break: break-all; }

  .cr-toc-foot{
    display:flex; align-items:center; justify-content:space-between;
    margin-top:8px; gap:12px; flex-wrap:wrap;
  }
  .range{ font-size:12px; color:#666; }
  .pager{ display:flex; align-items:center; gap:8px; }
  .pager button{
    border:1px solid #ddd; background:#fff; border-radius:8px; padding:6px 10px; cursor:pointer;
  }
  .pager input{
    width:90px; padding:6px 8px; border:1px solid #ddd; border-radius:8px; outline:none; font-size:14px;
  }
  `);

  // ========== DOM ==========
  const panel = document.createElement('div');
  panel.id = 'cr-panel';
  panel.innerHTML = `
    <div id="cr-drag" title="按住上沿拖动"></div>
    <div id="cr-resize" title="拖动调整大小"></div>
    <div id="cr-content"><div style="color:#888">Alt+L 输入链接；Alt+T 目录；Alt+R 续读上次；←/→ 翻页或跳章；↑/↓ 平滑滚动；Ctrl+Alt+X 显示/隐藏。可拖动小窗，右下角可调大小。</div></div>
  `;
  document.documentElement.appendChild(panel);

  const modal = document.createElement('div');
  modal.id = 'cr-modal';
  modal.innerHTML = `
    <div class="cr-box">
      <h3>输入章节链接</h3>
      <input id="cr-url" type="url" placeholder="https://…" spellcheck="false" />
      <div class="ops">
        <button id="cr-cancel">取消(Esc)</button>
        <button id="cr-confirm" class="primary">开始(Enter)</button>
      </div>
    </div>
  `;
  document.documentElement.appendChild(modal);

  const toc = document.createElement('div');
  toc.id = 'cr-toc';
  toc.innerHTML = `
    <div class="cr-box">
      <div class="cr-toc-head">
        <div class="title">目录</div>
        <button class="close" id="cr-toc-close">关闭(Esc)</button>
      </div>
      <div class="toc-list" id="cr-toc-list"></div>
      <div class="cr-toc-foot">
        <div class="range" id="cr-toc-range">—</div>
        <div class="pager">
          <button id="cr-toc-prev">上一页</button>
          <button id="cr-toc-next">下一页</button>
          <span>跳转页：</span>
          <input type="number" id="cr-toc-goto" min="1" step="1" />
          <button id="cr-toc-go">跳</button>
        </div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(toc);

  const $ = (sel, root = document) => root.querySelector(sel);
  const contentEl = $('#cr-content', panel);
  const urlInput = $('#cr-url', modal);
  const tocListEl = $('#cr-toc-list', toc);
  const tocRangeEl = $('#cr-toc-range', toc);
  const tocGotoEl = $('#cr-toc-goto', toc);
  const dragEl = $('#cr-drag', panel);
  const resizeEl = $('#cr-resize', panel);

  // ========== 状态 ==========
  const state = {
    visible: false,
    modalOpen: false,
    seriesId: null,
    pages: [],
    pageIndex: 0,
    nextChapterUrl: null,
    prevChapterUrl: null,
    loading: false,

    profile: null,          // 当前命中的站点 profile
    bookBase: null,         // 当前书籍基准路径
    tocUrl: null,
    tocItems: [],
    tocPage: 0,
    tocPageSize: 50,

    dragging: false, dragDX: 0, dragDY: 0,
    resizing: false, startW: 0, startH: 0, startX: 0, startY: 0,
  };

  // ========== Profiles（站点适配表） ==========
  const PROFILES = [
    // --- 3wwd.com ---
    {
      id: '3wwd',
      test: (url) => /(^|\.)3wwd\.com$/i.test(new URL(url).hostname),
      deriveBookBase: (url) => {
        const u = new URL(url);
        const m = u.pathname.match(/^(.*?\/book_\d+\/)/);
        if (m) return new URL(m[1], u.origin).href;
        return generic.deriveBookBase(url);
      },
      tocContainers: ['#list', '.box_con #list'],
      isChapterLink: (abs, bookBase) => sameBook(abs, bookBase) && /\/\d+(?:_\d+)?\.html(?:[#?].*)?$/i.test(abs),
      extractContent: (doc, baseUrl) => preferFirst(doc, [
        '#content', '#chaptercontent', '#chapterContent', '.content', '.read-content', '#contentTxt', '#BookText', '#txtContent'
      ], baseUrl),
      findInfoUrl: (doc, baseUrl, entry) => {
        const el = doc.querySelector('#info_url');
        if (el) return absolutize(baseUrl, el.getAttribute('href') || '');
        return generic.findInfoUrl(doc, baseUrl, entry);
      },
      findNav: (doc, baseUrl) => generic.findNav(doc, baseUrl),
    },

    // --- biquge.tw / www.biquge.tw / m.biquge.tw ---
    {
      id: 'biquge-tw',
      test: (url) => /(^|\.)(biquge\.tw)$/i.test(new URL(url).hostname.replace(/^www\./,'')),
      deriveBookBase: (url) => {
        const u = new URL(url);
        const m = u.pathname.match(/^(.*?\/book\/\d+\/)/);
        if (m) return new URL(m[1], u.origin).href; // 形如 https://www.biquge.tw/book/2319336/
        return generic.deriveBookBase(url);
      },
      tocContainers: ['#list', '.listmain', '#chapterlist', '.chapterlist', '#listmain', '#chapters', '.chapters'],
      isChapterLink: (abs, bookBase) => sameBook(abs, bookBase) && /\/book\/\d+\/\d+(?:_\d+)?\.html(?:[#?].*)?$/i.test(abs),
      extractContent: (doc, baseUrl) => preferFirst(doc, [
        '#content', '#chaptercontent', '#chapterContent', '.content', '.read-content', '#contentTxt', '#BookText', '#txtContent'
      ], baseUrl),
      findInfoUrl: (doc, baseUrl, entry) => {
        // biquge.tw 正文页一般没有明确“目录”按钮，直接回落到书籍根
        return generic.deriveBookBase(entry);
      },
      findNav: (doc, baseUrl) => generic.findNav(doc, baseUrl),
      tocCandidates: (base) => {
        // biquge 常见目录页：/book/<id>/、/book/<id>/index.html、也有 all.html
        const out = [];
        const b = base.replace(/\/?$/,'/');
        out.push(b);
        out.push(b + 'index.html');
        out.push(b + 'all.html');
        try {
          const u = new URL(b);
          if (u.hostname.startsWith('www.')) {
            const mu = new URL(b); mu.hostname = 'm.' + u.hostname.slice(4); out.push(mu.href); out.push(mu.href + 'index.html');
          } else if (u.hostname.startsWith('m.')) {
            const wu = new URL(b); wu.hostname = 'www.' + u.hostname.slice(2); out.push(wu.href); out.push(wu.href + 'index.html');
          }
        } catch {}
        return Array.from(new Set(out));
      }
    },

    // --- 通用兜底（最后一项） ---
    {
      id: 'generic',
      test: (_url) => true,
      deriveBookBase: (url) => generic.deriveBookBase(url),
      tocContainers: ['#list', '.listmain', '#listmain', '#chapterlist', '.chapterlist', '#chapters', '.chapters', '.volume', '.mulu'],
      isChapterLink: (abs, bookBase) => sameBook(abs, bookBase) && /\/\d+(?:_\d+)?\.html(?:[#?].*)?$/i.test(abs),
      extractContent: (doc, baseUrl) => preferFirst(doc, [
        '#content', '#chaptercontent', '#chapterContent', '.content', '.read-content', '#contentTxt', '#BookText', '#txtContent'
      ], baseUrl),
      findInfoUrl: (doc, baseUrl, entry) => generic.findInfoUrl(doc, baseUrl, entry),
      findNav: (doc, baseUrl) => generic.findNav(doc, baseUrl)
    }
  ];

  // ========== 通用实现 ==========
  const generic = {
    deriveBookBase(url) {
      try {
        const u = new URL(url);
        const m1 = u.pathname.match(/^(.*?\/book_\d+\/)/);
        if (m1) return new URL(m1[1], u.origin).href;
        const m2 = u.pathname.match(/^(.*?\/book\/\d+\/)/);
        if (m2) return new URL(m2[1], u.origin).href;
        const p = u.pathname.endsWith('/') ? u.pathname : u.pathname.replace(/[^/]+$/, '');
        return new URL(p, u.origin).href;
      } catch { return null; }
    },
    findInfoUrl(doc, baseUrl, entryUrl) {
      const el = doc.querySelector('#info_url');
      if (el) return absolutize(baseUrl, el.getAttribute('href') || '');
      const hint = Array.from(doc.querySelectorAll('a')).find(a => /(目录|章节目录|返回书页|返回目录)/.test((a.textContent || '').trim()));
      if (hint) return absolutize(baseUrl, hint.getAttribute('href') || '');
      return generic.deriveBookBase(entryUrl);
    },
    findNav(doc, baseUrl) {
      const norm = (u)=>u ? absolutize(baseUrl, u) : null;
      let prev = safeHref(doc.querySelector('#prev_url')?.getAttribute('href') || '');
      let next = safeHref(doc.querySelector('#next_url')?.getAttribute('href') || '');
      if (!prev) { const c = Array.from(doc.querySelectorAll('a')).find(a => /上[一页一章]/.test((a.textContent || '').trim())); if (c) prev = safeHref(c.getAttribute('href') || ''); }
      if (!next) { const anchors = Array.from(doc.querySelectorAll('a')); const c = anchors.reverse().find(a => /下[一页一章]/.test((a.textContent || '').trim())); if (c) next = safeHref(c.getAttribute('href') || ''); }
      return { prev: prev ? norm(prev) : null, next: next ? norm(next) : null };
    }
  };

  // ========== 工具 ==========
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  function absolutize(base, href) { try { return new URL(href, base).href; } catch { return href; } }
  function safeHref(href) {
    if (!href) return null;
    if (/^\s*javascript:/i.test(href)) return null;
    if (href.trim() === '#') return null;
    return href;
  }
  function getSeriesIdFromUrl(url) { try { const m = new URL(url).pathname.match(/(\d+)(?:_(\d+))?\.html$/); return m ? m[1] : null; } catch { return null; } }
  function isSameChapterPage(u1, u2) { const a = getSeriesIdFromUrl(u1), b = getSeriesIdFromUrl(u2); return a && b && a === b; }
  function sameBook(hrefAbs, bookBase) {
    try {
      const u = new URL(hrefAbs), b = new URL(bookBase);
      return u.origin === b.origin && u.pathname.startsWith(b.pathname);
    } catch { return false; }
  }
  function chapterIdFromHref(href) {
    try { const m = href.match(/\/(\d+)(?:_\d+)?\.html/); return m ? m[1] : null; } catch { return null; }
  }
  function chooseProfile(url) {
    for (const p of PROFILES) { try { if (p.test(url)) return p; } catch {} }
    return PROFILES[PROFILES.length-1];
  }
  function preferFirst(doc, selList, baseUrl) {
    for (const sel of selList) {
      const node = doc.querySelector(sel);
      if (node) return cleanContentNode(node, baseUrl);
    }
    const body = doc.body.cloneNode(true);
    try { body.querySelectorAll('script,style,ins,.adsbygoogle,.ad,[class*="ad-"],.advert,[id^="hm_t_"],.recommend,.toolbar').forEach(e=>e.remove()); } catch {}
    const txt = (body.textContent || '').trim().replace(/\n{2,}/g,'</p><p>');
    return txt ? `<p>${txt}</p>` : '<p>（未找到正文容器）</p>';
  }
  function cleanContentNode(node, baseUrl) {
    const n = node.cloneNode(true);
    try { n.querySelectorAll('script,style,ins,.adsbygoogle,.ad,[class*="ad-"],.advert,[id^="hm_t_"],.recommend,.toolbar').forEach(e=>e.remove()); } catch {}
    n.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      try { img.src = new URL(src, baseUrl).href; } catch { img.src = src; }
      img.style.maxWidth = '100%';
    });
    n.querySelectorAll('a').forEach(a => {
      const href = safeHref(a.getAttribute('href') || '');
      if (!href) { a.removeAttribute('href'); return; }
      try { a.href = new URL(href, baseUrl).href; } catch { a.href = href; }
      a.rel = 'noreferrer noopener';
    });
    return n.innerHTML || '<p>（正文为空）</p>';
  }

  // ========== 存储 ==========
  const LS_KEY_PANEL = 'cr_reader_panel_state';
  const LS_KEY_PROGRESS = 'cr_reader_progress';

  function savePanelState() {
    const rect = panel.getBoundingClientRect();
    const data = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    try { localStorage.setItem(LS_KEY_PANEL, JSON.stringify(data)); } catch {}
  }
  function restorePanelState() {
    try {
      const raw = localStorage.getItem(LS_KEY_PANEL);
      if (!raw) return;
      const { x, y, w, h } = JSON.parse(raw);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        panel.style.top = Math.max(2, Math.min(y, window.innerHeight - 50)) + 'px';
        panel.style.left = Math.max(2, Math.min(x, window.innerWidth - 50)) + 'px';
        panel.style.bottom = ''; panel.style.right = '';
      }
      if (Number.isFinite(w) && Number.isFinite(h)) {
        const cw = Math.max(220, Math.min(w, window.innerWidth - 10));
        const ch = Math.max(160, Math.min(h, window.innerHeight - 10));
        panel.style.width = cw + 'px';
        panel.style.height = ch + 'px';
      }
    } catch {}
  }
  function clampIntoViewport() {
    const rect = panel.getBoundingClientRect();
    let x = rect.left, y = rect.top, w = rect.width, h = rect.height;
    const maxX = window.innerWidth - w - 2;
    const maxY = window.innerHeight - h - 2;
    x = Math.max(2, Math.min(x, Math.max(2, maxX)));
    y = Math.max(2, Math.min(y, Math.max(2, maxY)));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  }
  window.addEventListener('resize', () => { clampIntoViewport(); savePanelState(); });

  function saveProgress({ tocUrl, chapterUrl, seriesId }) {
    const bookBase = (state.profile?.deriveBookBase?.(tocUrl || chapterUrl)) || generic.deriveBookBase(tocUrl || chapterUrl) || '';
    const payload = {
      tocUrl: tocUrl || null, chapterUrl: chapterUrl || null, seriesId: seriesId || null,
      bookBase, updatedAt: Date.now()
    };
    try { localStorage.setItem(LS_KEY_PROGRESS, JSON.stringify(payload)); } catch {}
  }
  function getSavedProgress() {
    try {
      const raw = localStorage.getItem(LS_KEY_PROGRESS);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || (!o.tocUrl && !o.chapterUrl)) return null;
      return o;
    } catch { return null; }
  }

  // ========== 抓取 ==========
  function decodeText(arrayBuffer, headersStr) {
    const lower = (headersStr || '').toLowerCase();
    const m = lower.match(/charset\s*=\s*([^\s;]+)/);
    const fromHeader = m && m[1] ? m[1].replace(/["']/g,'').toLowerCase() : '';
    const tryDec = enc => { try { return new TextDecoder(enc).decode(arrayBuffer); } catch { return null; } };
    let text = null;
    if (/big5/.test(fromHeader)) text = tryDec('big5') || tryDec('utf-8');
    else if (/gbk|gb18030|gb2312/.test(fromHeader)) text = tryDec('gbk') || tryDec('gb18030') || tryDec('utf-8');
    else text = tryDec('utf-8') || tryDec('gbk') || tryDec('gb18030') || tryDec('big5');
    if (!text) text = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer));
    const hint = (text.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9-]+)/i) || [])[1];
    if (hint) {
      const h = hint.toLowerCase();
      if (/big5/.test(h)) text = tryDec('big5') || text;
      else if (/gb/.test(h)) text = tryDec('gbk') || tryDec('gb18030') || text;
    }
    return text;
  }

  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
        timeout: 30000,
        onload: (res) => {
          try {
            const html = decodeText(res.response, res.responseHeaders || '');
            resolve({ html, finalUrl: url, headers: res.responseHeaders || '' });
          } catch (e) { reject(e); }
        },
        onerror: reject,
        ontimeout: () => reject(new Error('请求超时')),
      });
    });
  }

  const parseHTML = html => new DOMParser().parseFromString(html, 'text/html');

  // ========== 正文抽取（走 profile，可回落通用） ==========
  function extractMain(doc, baseUrl) {
    console.log('profile:', state.profile);
    if (state.profile?.extractContent) {
      try { return state.profile.extractContent(doc, baseUrl); } catch {}
    }
    return preferFirst(doc, [
      '#content', '#chaptercontent', '#chapterContent', '.content', '.read-content', '#contentTxt', '#BookText', '#txtContent'
    ], baseUrl);
  }

  // ========== 上下页 & 目录链接 ==========
  function getNavUrls(doc, baseUrl) {
    if (state.profile?.findNav) {
      try { return state.profile.findNav(doc, baseUrl); } catch {}
    }
    return generic.findNav(doc, baseUrl);
  }

  function getInfoUrl(doc, baseUrl, entryUrl) {
    if (state.profile?.findInfoUrl) {
      try { return state.profile.findInfoUrl(doc, baseUrl, entryUrl); } catch {}
    }
    return generic.findInfoUrl(doc, baseUrl, entryUrl);
  }

  // ========== 抓取章节（多页拼合） ==========
  async function fetchChapterSeries(entryUrl) {
    const visited = new Set();
    state.loading = true;
    state.pages = []; state.pageIndex = 0;
    state.seriesId = getSeriesIdFromUrl(entryUrl);
    state.nextChapterUrl = null; state.prevChapterUrl = null;
    state.profile = chooseProfile(entryUrl);

    const newBase = state.profile.deriveBookBase?.(entryUrl) || generic.deriveBookBase(entryUrl) || null;
    if (state.bookBase && newBase && state.bookBase !== newBase) {
      state.tocItems = []; // 切书：清空老目录缓存
    }
    state.bookBase = newBase;

    renderInfo('正在抓取章节…');

    try {
      const first = await gmFetch(entryUrl);
      const firstDoc = parseHTML(first.html);

      state.tocUrl = getInfoUrl(firstDoc, entryUrl, entryUrl);
      saveProgress({ tocUrl: state.tocUrl, chapterUrl: entryUrl, seriesId: state.seriesId });

      const { prev: prev0, next: next0 } = getNavUrls(firstDoc, entryUrl);
      state.prevChapterUrl = (prev0 && !isSameChapterPage(prev0, entryUrl)) ? prev0 : null;

      state.pages.push({ url: entryUrl, html: extractMain(firstDoc, entryUrl) });
      visited.add(new URL(entryUrl, location.href).href);

      // 连抓分页
      let cursor = next0, step = 0;
      while (cursor && isSameChapterPage(cursor, entryUrl) && step < 50) {
        const abs = new URL(cursor, entryUrl).href;
        if (visited.has(abs)) break;
        visited.add(abs);

        const pg = await gmFetch(abs);
        const d = parseHTML(pg.html);
        state.pages.push({ url: abs, html: extractMain(d, abs) });

        const nav = getNavUrls(d, abs);
        cursor = nav.next;
        step++;
        await sleep(60);
      }

      if (cursor && !isSameChapterPage(cursor, entryUrl)) state.nextChapterUrl = cursor;

      if (!state.pages.length) throw new Error('未抓到正文');
      showCurrentPage();

    } catch (err) {
      console.error('[clean-reader] 抓取失败：', err);
      renderInfo('抓取失败：' + (err && err.message ? err.message : '未知错误'));
    } finally {
      state.loading = false;
    }
  }

  // ========== 目录抓取与渲染 ==========
  async function openTOC() {
    state.modalOpen = true;

    // 切书校验：目录缓存属于别的书则清空
    const saved = getSavedProgress?.() || null;
    const desiredBase = (state.tocUrl ? (state.profile?.deriveBookBase?.(state.tocUrl) || generic.deriveBookBase(state.tocUrl))
                                      : (saved?.tocUrl ? (state.profile?.deriveBookBase?.(saved.tocUrl) || generic.deriveBookBase(saved.tocUrl))
                                                       : generic.deriveBookBase(location.href))) || null;
    const currBase = state.tocItems.length ? generic.deriveBookBase(state.tocItems[0].href) : null;
    if (currBase && desiredBase && currBase !== desiredBase) state.tocItems = [];

    toc.style.display = 'flex';
    $('#cr-toc-goto').value = '';

    if (!state.tocUrl) {
      const sp = getSavedProgress();
      if (sp && sp.tocUrl) state.tocUrl = sp.tocUrl;
      else state.tocUrl = state.bookBase || generic.deriveBookBase(location.href);
    }

    if (!state.tocItems.length) {
      tocListEl.innerHTML = `<div style="padding:8px;color:#666">正在加载目录…</div>`;
      try {
        const ok = await tryFetchTOC(state.tocUrl);
        if (!ok) throw new Error('未找到目录链接');
        state.tocPage = clampTocPageToCurrent(state.tocItems);
        renderTOC();
      } catch (e) {
        console.error('[clean-reader] 目录抓取失败：', e);
        tocListEl.innerHTML = `<div style="padding:8px;color:#c00">目录加载失败：${e && e.message ? e.message : '未知错误'}</div>`;
        tocRangeEl.textContent = '—';
      }
    } else {
      state.tocPage = clampTocPageToCurrent(state.tocItems);
      renderTOC();
    }
  }

  async function tryFetchTOC(tocUrl) {
    const base = (state.profile?.deriveBookBase?.(tocUrl) || generic.deriveBookBase(tocUrl) || tocUrl).replace(/\/?$/,'/');
    const candidates = (state.profile?.tocCandidates?.(base)) || [base, base + 'index.html'];

    for (const u of candidates) {
      try {
        const res = await gmFetch(u);
        const doc = parseHTML(res.html);
        const items = collectTOCItems(doc, u);
        if (items && items.length) {
          state.tocUrl = (state.profile?.deriveBookBase?.(u) || generic.deriveBookBase(u) || u);
          state.tocItems = items;
          return true;
        }
      } catch {}
    }
    return false;
  }

  function clampTocPageToCurrent(items) {
    const idx = items.findIndex(it => it.id && state.seriesId && it.id === state.seriesId);
    if (idx < 0) return state.tocPage || 0;
    return Math.floor(idx / state.tocPageSize);
  }

  function closeTOC() { state.modalOpen = false; toc.style.display = 'none'; }

  function collectTOCItems(doc, baseUrl) {
    const bookBase = (state.profile?.deriveBookBase?.(baseUrl) || generic.deriveBookBase(baseUrl) || '').replace(/\/?$/,'/');
    const isChapterLink = (abs) => (state.profile?.isChapterLink?.(abs, bookBase)) ?? (sameBook(abs, bookBase) && /\/\d+(?:_\d+)?\.html(?:[#?].*)?$/i.test(abs));

    // 1) 优先从 profile 指定容器搜
    const containersSel = state.profile?.tocContainers || [];
    const containerEls = containersSel.map(sel => doc.querySelector(sel)).filter(Boolean);

    let anchors = [];
    for (const c of containerEls) anchors.push(...c.querySelectorAll('a'));
    // 2) 容器里没拿到就全局兜底
    if (anchors.length === 0) anchors = Array.from(doc.querySelectorAll('a'));

    const out = [];
    const seen = new Set();

    for (const a of anchors) {
      const raw = safeHref(a.getAttribute('href') || '');
      if (!raw) continue;
      const abs = absolutize(baseUrl, raw);
      if (!isChapterLink(abs)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      const title = (a.textContent || a.getAttribute('title') || '').trim().replace(/\s+/g, ' ');
      const id = chapterIdFromHref(abs);
      out.push({ title: title || (id ? `章节 ${id}` : abs), href: abs, id });
    }

    // 3) 目录由脚本写入或结构非常规时，正则兜底（biquge.tw 常见）
    if (out.length < 5) {
      const html = doc.documentElement.innerHTML || '';
      const re = /<a[^>]+href=["']([^"']*\/book\/\d+\/\d+(?:_\d+)?\.html)["'][^>]*>([^<]*)<\/a>/ig;
      let m;
      while ((m = re.exec(html))) {
        const abs = absolutize(baseUrl, m[1]);
        if (!isChapterLink(abs) || seen.has(abs)) continue;
        seen.add(abs);
        const id = chapterIdFromHref(abs);
        const title = (m[2] || '').trim().replace(/\s+/g, ' ');
        out.push({ title: title || (id ? `章节 ${id}` : abs), href: abs, id });
      }
    }

    // 4) 过滤噪声项
    const blacklist = /(上一[页章]|下一[页章]|返回|顶|底|最新|目录)/;
    return out.filter(it => !blacklist.test(it.title));
  }

  // ========== 渲染 ==========
  function renderInfo(msg) { contentEl.innerHTML = `<div style="color:#666;font-size:12px">${msg}</div>`; }
  function showCurrentPage() {
    const idx = state.pageIndex;
    if (!state.pages[idx]) return;
    const total = state.pages.length;
    contentEl.innerHTML = `
      <div style="color:#666; font-size:12px; margin-bottom:8px;">第 ${idx+1}/${total} 页 · ←/→ 翻页，↑/↓ 滚动</div>
      <div>${state.pages[idx].html}</div>
    `;
    contentEl.scrollTop = 0;
  }

  // ========== 面板显示/隐藏 ==========
  function showPanel(){ state.visible = true; panel.style.display = 'block'; restorePanelState(); clampIntoViewport(); }
  function hidePanel(){ state.visible = false; panel.style.display = 'none'; }
  function togglePanel(){ state.visible ? hidePanel() : showPanel(); }

  // ========== URL 弹窗 ==========
  function openUrlModal(defaultUrl) {
    state.modalOpen = true; showPanel(); modal.style.display = 'flex';
    const saved = getSavedProgress();
    urlInput.value = (saved && saved.chapterUrl) || defaultUrl || location.href;
    urlInput.focus(); urlInput.select();
  }
  function closeUrlModal() { state.modalOpen = false; modal.style.display = 'none'; }

  $('#cr-cancel', modal).addEventListener('click', closeUrlModal);
  $('#cr-confirm', modal).addEventListener('click', () => {
    const u = urlInput.value.trim();
    if (!u) return;
    closeUrlModal();
    fetchChapterSeries(u);
  });
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#cr-confirm', modal).click(); }
    if (e.key === 'Escape') { e.preventDefault(); closeUrlModal(); }
  });

  // ========== 目录弹窗事件 ==========
  $('#cr-toc-close', toc).addEventListener('click', closeTOC);
  $('#cr-toc-prev', toc).addEventListener('click', () => { state.tocPage = Math.max(0, state.tocPage - 1); renderTOC(); });
  $('#cr-toc-next', toc).addEventListener('click', () => {
    const total = state.tocItems.length;
    const maxPage = Math.max(0, Math.ceil(total / state.tocPageSize) - 1);
    state.tocPage = Math.min(maxPage, state.tocPage + 1);
    renderTOC();
  });
  $('#cr-toc-go', toc).addEventListener('click', () => {
    const total = state.tocItems.length;
    const maxPage = Math.max(1, Math.ceil(total / state.tocPageSize));
    let p = parseInt(tocGotoEl.value, 10);
    if (!isFinite(p) || p < 1) p = 1;
    if (p > maxPage) p = maxPage;
    state.tocPage = p - 1;
    renderTOC();
  });
  tocGotoEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#cr-toc-go', toc).click(); }
    if (e.key === 'Escape') { e.preventDefault(); closeTOC(); }
  });
  toc.addEventListener('keydown', (e) => {
    if (!state.modalOpen) return;
    if (e.key === 'PageDown') { e.preventDefault(); $('#cr-toc-next', toc).click(); }
    if (e.key === 'PageUp')   { e.preventDefault(); $('#cr-toc-prev', toc).click(); }
    if (e.key === 'Escape')   { e.preventDefault(); closeTOC(); }
  });

  function renderTOC() {
    const total = state.tocItems.length;
    const size = state.tocPageSize;
    const page = Math.max(0, Math.min(state.tocPage, Math.floor((total-1)/size) || 0));
    const start = page * size;
    const end = Math.min(start + size, total);
    const slice = state.tocItems.slice(start, end);

    tocListEl.innerHTML = slice.map((it, i) => {
      const idx = start + i + 1;
      const active = (it.id && state.seriesId && it.id === state.seriesId) ? ' active' : '';
      return `
        <div class="toc-item${active}" data-href="${it.href.replace(/"/g,'&quot;')}">
          <div class="toc-idx">${idx}.</div>
          <div class="toc-title">${escapeHTML(it.title)}</div>
        </div>
      `;
    }).join('') || `<div style="padding:8px;color:#666">目录为空</div>`;

    tocRangeEl.textContent = total ? `${start+1}-${end}` : '—';

    const maxPage = Math.max(1, Math.ceil(total / size));
    tocGotoEl.setAttribute('max', String(maxPage));
    tocGotoEl.setAttribute('placeholder', `1~${maxPage}`);

    tocListEl.querySelectorAll('.toc-item').forEach(el => {
      el.addEventListener('click', () => {
        const href = el.getAttribute('data-href');
        if (href) {
          closeTOC(); showPanel(); fetchChapterSeries(href);
        }
      });
      el.addEventListener('dblclick', () => {
        const href = el.getAttribute('data-href');
        if (href) {
          closeTOC(); showPanel(); fetchChapterSeries(href);
        }
      });
    });
  }

  function escapeHTML(s) {
    return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ========== 拖动/大小 ==========
  function startDrag(e){
    state.dragging = true;
    const rect = panel.getBoundingClientRect();
    state.dragDX = e.clientX - rect.left;
    state.dragDY = e.clientY - rect.top;
    panel.style.top = rect.top + 'px';
    panel.style.left = rect.left + 'px';
    panel.style.bottom = ''; panel.style.right = '';
    document.addEventListener('mousemove', onDragMove, true);
    document.addEventListener('mouseup', endDrag, true);
    e.preventDefault(); e.stopPropagation();
  }
  function onDragMove(e){
    if (!state.dragging) return;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    let nx = e.clientX - state.dragDX;
    let ny = e.clientY - state.dragDY;
    const maxX = window.innerWidth - w - 2;
    const maxY = window.innerHeight - h - 2;
    nx = Math.max(2, Math.min(nx, maxX));
    ny = Math.max(2, Math.min(ny, maxY));
    panel.style.left = nx + 'px';
    panel.style.top  = ny + 'px';
  }
  function endDrag(){
    state.dragging = false;
    document.removeEventListener('mousemove', onDragMove, true);
    document.removeEventListener('mouseup', endDrag, true);
    savePanelState();
  }
  dragEl.addEventListener('mousedown', startDrag, true);

  function startResize(e){
    state.resizing = true;
    const rect = panel.getBoundingClientRect();
    state.startW = rect.width;
    state.startH = rect.height;
    state.startX = e.clientX;
    state.startY = e.clientY;
    panel.style.top = rect.top + 'px';
    panel.style.left = rect.left + 'px';
    panel.style.bottom = ''; panel.style.right = '';
    document.addEventListener('mousemove', onResizeMove, true);
    document.addEventListener('mouseup', endResize, true);
    e.preventDefault(); e.stopPropagation();
  }
  function onResizeMove(e){
    if (!state.resizing) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    let w = state.startW + dx;
    let h = state.startH + dy;
    const minW = 220, minH = 160;
    const maxW = Math.min(window.innerWidth - 10, 900);
    const maxH = Math.min(window.innerHeight - 10, 900);
    w = Math.max(minW, Math.min(w, maxW));
    h = Math.max(minH, Math.min(h, maxH));
    panel.style.width  = w + 'px';
    panel.style.height = h + 'px';
    clampIntoViewport();
  }
  function endResize(){
    state.resizing = false;
    document.removeEventListener('mousemove', onResizeMove, true);
    document.removeEventListener('mouseup', endResize, true);
    savePanelState();
  }
  resizeEl.addEventListener('mousedown', startResize, true);

  // ========== 键盘捕获 ==========
  const SCROLL_STEP = 80;
  function handleKey(e) {
    if (e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); e.stopPropagation(); openUrlModal(location.href); return; }
    if (e.altKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); e.stopPropagation(); openTOC(); return; }
    if (e.altKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault(); e.stopPropagation();
      const saved = getSavedProgress();
      if (saved && saved.chapterUrl) { showPanel(); fetchChapterSeries(saved.chapterUrl); }
      else { openUrlModal(location.href); }
      return;
    }
    if (e.ctrlKey && e.altKey && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); e.stopPropagation(); togglePanel(); return; }

    if (state.modalOpen) return;
    if (!state.visible) return;
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;

    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();

    if (e.key === 'ArrowUp') {
      if (contentEl.scrollTop <= 0) {
        if (state.pageIndex > 0) { state.pageIndex--; showCurrentPage(); }
        else if (state.prevChapterUrl && !state.loading) { fetchChapterSeries(state.prevChapterUrl); }
        else contentEl.scrollTop = 0;
      } else {
        contentEl.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' });
      }
    }
    if (e.key === 'ArrowDown') {
      const atBottom = contentEl.scrollTop + contentEl.clientHeight >= contentEl.scrollHeight - 2;
      if (atBottom) {
        if (state.pageIndex < state.pages.length - 1) { state.pageIndex++; showCurrentPage(); }
        else if (state.nextChapterUrl && !state.loading) { fetchChapterSeries(state.nextChapterUrl); }
      } else {
        contentEl.scrollBy({ top: SCROLL_STEP, behavior: 'smooth' });
      }
    }
    if (e.key === 'ArrowLeft') {
      if (state.pageIndex > 0) { state.pageIndex--; showCurrentPage(); }
      else if (state.prevChapterUrl && !state.loading) { fetchChapterSeries(state.prevChapterUrl); }
    }
    if (e.key === 'ArrowRight') {
      if (state.pageIndex < state.pages.length - 1) { state.pageIndex++; showCurrentPage(); }
      else if (state.nextChapterUrl && !state.loading) { fetchChapterSeries(state.nextChapterUrl); }
    }
  }
  window.addEventListener('keydown', handleKey, true);

  // ========== 辅助 ==========
  function renderInfo(msg) { contentEl.innerHTML = `<div style="color:#666;font-size:12px">${msg}</div>`; }

  restorePanelState();
})();

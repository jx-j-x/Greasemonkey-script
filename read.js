// ==UserScript==
// @name         小窗净读器（极简/目录分页/多页拼合/可拖动可调大小/记忆进度）
// @namespace    https://github.com/jx-j-x/Greasemonkey-script
// @version      0.5.3
// @description  Alt+L 输入链接→抽正文；Alt+T 目录（每页50条，可跳页）；Alt+R 续读上次；←/→ 翻页/跳章；↑/↓ 平滑滚动；Ctrl+Alt+X 显示/隐藏；拖动+右下角把手可调大小；跨域抓取含 GBK；自动记忆目录与最后章节链接。
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      *
// @connect      3wwd.com
// @connect      m.3wwd.com
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
  /* 顶部拖拽区（不可见） */
  #cr-drag{
    position:absolute; top:0; left:0; right:0; height:10px;
    cursor:move; z-index:3; background: transparent;
  }
  /* 右下角调整大小把手 */
  #cr-resize{
    position:absolute; right:2px; bottom:2px; width:14px; height:14px;
    cursor:nwse-resize; z-index:3; opacity:.7;
    background:
      linear-gradient(135deg, rgba(0,0,0,0) 0, rgba(0,0,0,0) 50%, #cfcfcf 50%, #cfcfcf 100%);
    border-radius:3px;
  }
  #cr-content{ height:100%; overflow:auto; padding:12px 14px; position:relative; z-index:1; line-height:1; }
  #cr-content p{ margin:0 0 6px 0; }

  /* URL 输入弹窗 & 目录弹窗 */
  #cr-modal, #cr-toc{
    position: fixed; inset: 0; background: rgba(0,0,0,.35); display:none;
    align-items: center; justify-content: center; z-index: 2147483647;
  }
  #cr-modal .cr-box, #cr-toc .cr-box{
    width: min(720px, 94vw); background:#fff; border-radius:12px;
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
  .toc-idx{ min-width: 48px; opacity:.7; font-variant-numeric: tabular-nums; }
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
    width:80px; padding:6px 8px; border:1px solid #ddd; border-radius:8px; outline:none; font-size:14px;
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

  // URL 弹窗
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

  // 目录弹窗
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

    tocUrl: null,
    tocItems: [],
    tocPage: 0,
    tocPageSize: 50,

    dragging: false,
    dragDX: 0,
    dragDY: 0,

    resizing: false,
    startW: 0,
    startH: 0,
    startX: 0,
    startY: 0,
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
  function deriveBookBase(url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/^(.*?\/book_\d+\/)/);
      if (m) return new URL(m[1], u.origin).href;
      return new URL(u.pathname.replace(/[^/]+$/, ''), u.origin).href;
    } catch { return null; }
  }
  function chapterIdFromHref(href) {
    try { const m = href.match(/\/(\d+)(?:_(\d+))?\.html$/); return m ? m[1] : null; } catch { return null; }
  }

  // —— 面板位置尺寸本地存储
  const LS_KEY_PANEL = 'cr_reader_panel_state';
  // —— 阅读进度本地存储（目录 & 最后章节）
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

  // —— 阅读进度：保存/恢复
  function saveProgress({ tocUrl, chapterUrl, seriesId }) {
    const bookBase = deriveBookBase(tocUrl || chapterUrl) || '';
    const payload = {
      tocUrl: tocUrl || null,
      chapterUrl: chapterUrl || null,
      seriesId: seriesId || null,
      bookBase,
      updatedAt: Date.now()
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

  function decodeText(arrayBuffer, headersStr) {
    const lower = (headersStr || '').toLowerCase();
    const m = lower.match(/charset\s*=\s*([^\s;]+)/);
    const fromHeader = m && m[1] ? m[1].replace(/["']/g,'').toLowerCase() : '';
    const tryDec = enc => { try { return new TextDecoder(enc).decode(arrayBuffer); } catch { return null; } };
    let text = null;
    if (/gbk|gb18030|gb2312/.test(fromHeader)) text = tryDec('gbk') || tryDec('gb18030') || tryDec('utf-8');
    else text = tryDec('utf-8') || tryDec('gbk') || tryDec('gb18030');
    if (!text) text = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer));
    const hint = (text.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9-]+)/i) || [])[1];
    if (hint && /gb/.test(hint.toLowerCase())) text = tryDec('gbk') || tryDec('gb18030') || text;
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

  // ========== 正文抽取 ==========
  function extractMain(doc, baseUrl) {
    let node = doc.querySelector('#content')
             || doc.querySelector('#chaptercontent, #chapterContent, .content, .read-content, #contentTxt, #BookText, #txtContent');
    if (!node) {
      const body = doc.body.cloneNode(true);
      try { body.querySelectorAll('script,style,ins,.adsbygoogle,.ad,.advert,[id^="hm_t_"],.recommend,.toolbar').forEach(e=>e.remove()); } catch {}
      const txt = (body.textContent || '').trim().replace(/\n{2,}/g,'</p><p>');
      return txt ? `<p>${txt}</p>` : '<p>（未找到正文容器）</p>';
    }
    try { node.querySelectorAll('script,style,ins,.adsbygoogle,.ad,.advert,[id^="hm_t_"],.recommend,.toolbar').forEach(e=>e.remove()); } catch {}
    node.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      try { img.src = new URL(src, baseUrl).href; } catch { img.src = src; }
      img.style.maxWidth = '100%';
    });
    node.querySelectorAll('a').forEach(a => {
      const href = safeHref(a.getAttribute('href') || '');
      if (!href) { a.removeAttribute('href'); return; }
      try { a.href = new URL(href, baseUrl).href; } catch { a.href = href; }
      a.rel = 'noreferrer noopener';
    });
    return node.innerHTML || '<p>（正文为空）</p>';
  }

  function getNavUrls(doc, baseUrl) {
    const norm = (u)=>u ? absolutize(baseUrl, u) : null;
    let prev = safeHref(doc.querySelector('#prev_url')?.getAttribute('href') || '');
    let next = safeHref(doc.querySelector('#next_url')?.getAttribute('href') || '');
    if (!prev) { const c = Array.from(doc.querySelectorAll('a')).find(a => /上[一页一章]/.test((a.textContent || '').trim())); if (c) prev = safeHref(c.getAttribute('href') || ''); }
    if (!next) { const anchors = Array.from(doc.querySelectorAll('a')); const c = anchors.reverse().find(a => /下[一页一章]/.test((a.textContent || '').trim())); if (c) next = safeHref(c.getAttribute('href') || ''); }
    return { prev: prev ? norm(prev) : null, next: next ? norm(next) : null };
  }

  function getInfoUrl(doc, baseUrl, entryUrl) {
    const el = doc.querySelector('#info_url');
    if (el) return absolutize(baseUrl, el.getAttribute('href') || '');
    const derived = deriveBookBase(entryUrl);
    return derived;
  }

  // ========== 抓取章节（多页拼合） ==========
  async function fetchChapterSeries(entryUrl) {
    const visited = new Set();
    state.loading = true;
    state.pages = []; state.pageIndex = 0;
    state.seriesId = getSeriesIdFromUrl(entryUrl);
    state.nextChapterUrl = null; state.prevChapterUrl = null;

    renderInfo('正在抓取章节…');

    try {
      const first = await gmFetch(entryUrl);
      const firstDoc = parseHTML(first.html);

      // 目录 URL
      state.tocUrl = getInfoUrl(firstDoc, entryUrl, entryUrl);

      // 保存进度（目录 + 当前章节）
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
    toc.style.display = 'flex';
    $('#cr-toc-goto').value = '';

    // 优先使用记忆目录
    if (!state.tocUrl) {
      const saved = getSavedProgress();
      if (saved && saved.tocUrl) state.tocUrl = saved.tocUrl;
    }

    if (!state.tocItems.length) {
      tocListEl.innerHTML = `<div style="padding:8px;color:#666">正在加载目录…</div>`;
      let tocUrl = state.tocUrl;
      if (!tocUrl) {
        // 若仍无记忆目录，则按当前页推断
        tocUrl = deriveBookBase(location.href);
        state.tocUrl = tocUrl;
      }
      try {
        const res = await gmFetch(tocUrl);
        const doc = parseHTML(res.html);
        const items = collectTOCItems(doc, tocUrl);
        state.tocItems = items;
        state.tocPage = clampTocPageToCurrent(items);
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

  function clampTocPageToCurrent(items) {
    const idx = items.findIndex(it => it.id && state.seriesId && it.id === state.seriesId);
    if (idx < 0) return state.tocPage || 0;
    return Math.floor(idx / state.tocPageSize);
  }

  function closeTOC() {
    state.modalOpen = false;
    toc.style.display = 'none';
  }

  function collectTOCItems(doc, baseUrl) {
    const bookBase = deriveBookBase(baseUrl) || '';
    const anchors = Array.from(doc.querySelectorAll('a'));
    const out = [];
    const seen = new Set();

    anchors.forEach(a => {
      const raw = safeHref(a.getAttribute('href') || '');
      if (!raw) return;
      const abs = absolutize(baseUrl, raw);
      if (!abs.startsWith(bookBase)) return;
      if (!/\/\d+(?:_\d+)?\.html(?:[#?].*)?$/.test(abs)) return;
      if (seen.has(abs)) return;
      seen.add(abs);
      const title = (a.textContent || a.getAttribute('title') || '').trim().replace(/\s+/g,' ');
      const id = chapterIdFromHref(abs);
      out.push({ title: title || (id ? `章节 ${id}` : abs), href: abs, id });
    });

    const blacklist = /(上一[页章]|下一[页章]|返回|顶|底|最新|目录)/;
    return out.filter(it => !blacklist.test(it.title));
  }

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
          closeTOC();
          showPanel();
          fetchChapterSeries(href);
        }
      });
      el.addEventListener('dblclick', () => {
        const href = el.getAttribute('data-href');
        if (href) {
          closeTOC();
          showPanel();
          fetchChapterSeries(href);
        }
      });
    });
  }

  function escapeHTML(s) {
    return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  function showPanel(){
    state.visible = true; panel.style.display = 'block';
    restorePanelState(); clampIntoViewport();
  }
  function hidePanel(){ state.visible = false; panel.style.display = 'none'; }
  function togglePanel(){ state.visible ? hidePanel() : showPanel(); }

  // ========== URL 弹窗 ==========
  function openUrlModal(defaultUrl) {
    state.modalOpen = true;
    showPanel();
    modal.style.display = 'flex';

    // 默认填入「上次章节」> 传入默认 > 当前页
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
  $('#cr-toc-prev', toc).addEventListener('click', () => {
    state.tocPage = Math.max(0, state.tocPage - 1);
    renderTOC();
  });
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

  // ========== 拖动 ==========
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

  // ========== 调整大小 ==========
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

  // ========== 键盘捕获（仅面板可见且无弹窗时） ==========
  const SCROLL_STEP = 80;
  function handleKey(e) {
    // Alt+L：输入链接
    if (e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); e.stopPropagation(); openUrlModal(location.href); return; }
    // Alt+T：目录（优先使用记忆目录）
    if (e.altKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); e.stopPropagation(); openTOC(); return; }
    // Alt+R：续读上次章节
    if (e.altKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault(); e.stopPropagation();
      const saved = getSavedProgress();
      if (saved && saved.chapterUrl) { showPanel(); fetchChapterSeries(saved.chapterUrl); }
      else { openUrlModal(location.href); }
      return;
    }
    // Ctrl+Alt+X：显示/隐藏面板
    if (e.ctrlKey && e.altKey && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); e.stopPropagation(); togglePanel(); return; }

    if (state.modalOpen) return;
    if (!state.visible) return;
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;

    // 捕获方向键
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

  // 首次尝试恢复（面板位置 & 记忆目录仅在使用时读取）
  restorePanelState();
})();

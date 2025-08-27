// ==UserScript==
// @name         小窗净读器（极简/目录分页/多页拼合）
// @namespace    https://jx.local/clean-reader
// @version      0.5.0
// @description  Alt+L 输入链接→抽正文；Alt+T 打开目录（每页50条，可跳页）；←/→ 翻页/跳章；↑/↓ 平滑滚动；Ctrl+Alt+X 显示/隐藏；捕获阶段接管方向键；跨域抓取含 GBK；极简无标题无按钮。
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
    position: fixed; left: 16px; bottom: 16px; width: 300px; height: 400px;
    background: #fff; color:#222; border:1px solid #ddd; border-radius:10px;
    box-shadow:0 6px 24px rgba(0,0,0,.15); z-index: 2147483646;
    display:none; overflow:hidden; font:14px/1.7 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  }
  #cr-content{ height:100%; overflow:auto; padding:12px 14px; }
  #cr-content p{ margin:0 0 12px 0; }

  /* URL 输入弹窗 */
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
  panel.innerHTML = `<div id="cr-content"><div style="color:#888">Alt+L 输入链接；Alt+T 打开目录；←/→ 翻页或跳章；↑/↓ 平滑滚动；Ctrl+Alt+X 显示/隐藏。</div></div>`;
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

  // ========== 状态 ==========
  const state = {
    visible: false,
    modalOpen: false,    // URL弹窗或目录弹窗打开时为 true（屏蔽键盘接管）
    seriesId: null,      // 当前章节ID（不含 _2）
    pages: [],
    pageIndex: 0,
    nextChapterUrl: null,
    prevChapterUrl: null,
    loading: false,

    tocUrl: null,
    tocItems: [],        // [{title, href, id}]
    tocPage: 0,
    tocPageSize: 50,
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
      // 兜底：去掉文件名
      return new URL(u.pathname.replace(/[^/]+$/, ''), u.origin).href;
    } catch { return null; }
  }
  function chapterIdFromHref(href) {
    try { const m = href.match(/\/(\d+)(?:_(\d+))?\.html$/); return m ? m[1] : null; } catch { return null; }
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
    // 兜底：按 book_xxx/ 目录推断
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
      // 目录 URL 记下来
      state.tocUrl = getInfoUrl(firstDoc, entryUrl, entryUrl);

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
    if (!state.tocItems.length) {
      tocListEl.innerHTML = `<div style="padding:8px;color:#666">正在加载目录…</div>`;
      let tocUrl = state.tocUrl;
      if (!tocUrl) {
        // 若没有章节上下文，尝试用当前页推断
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
      // 已有目录，直接渲染（定位到当前章节所在页）
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
    // 规则：收集所有 href 指向本书目录下 /book_<id>/数字.html 的链接
    const bookBase = deriveBookBase(baseUrl) || '';
    const anchors = Array.from(doc.querySelectorAll('a'));
    const out = [];
    const seen = new Set();

    anchors.forEach(a => {
      const raw = safeHref(a.getAttribute('href') || '');
      if (!raw) return;
      const abs = absolutize(baseUrl, raw);
      if (!abs.startsWith(bookBase)) return;
      if (!/\/\d+(?:_\d+)?\.html(?:[#?].*)?$/.test(abs)) return; // 必须是具体章节页
      if (seen.has(abs)) return;
      seen.add(abs);
      const title = (a.textContent || a.getAttribute('title') || '').trim().replace(/\s+/g,' ');
      const id = chapterIdFromHref(abs);
      out.push({ title: title || (id ? `章节 ${id}` : abs), href: abs, id });
    });

    // 有些目录页会包含前后推荐或公告，过滤可能的“回目录/上一页/下一页”等文案
    const blacklist = /(上一[页章]|下一[页章]|返回|顶|底|最新|目录)/;
    const filtered = out.filter(it => !blacklist.test(it.title));

    return filtered;
  }

  function renderTOC() {
    const total = state.tocItems.length;
    const size = state.tocPageSize;
    const page = Math.max(0, Math.min(state.tocPage, Math.floor((total-1)/size) || 0));
    const start = page * size;
    const end = Math.min(start + size, total);
    const slice = state.tocItems.slice(start, end);

    // 列表
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

    // 区间显示：形如 “1-50”
    tocRangeEl.textContent = total ? `${start+1}-${end}` : '—';

    // 页码输入最大值提示
    const maxPage = Math.max(1, Math.ceil(total / size));
    tocGotoEl.setAttribute('max', String(maxPage));
    tocGotoEl.setAttribute('placeholder', `1~${maxPage}`);

    // 事件绑定
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
  function showPanel(){ state.visible = true; panel.style.display = 'block'; }
  function hidePanel(){ state.visible = false; panel.style.display = 'none'; }
  function togglePanel(){ state.visible ? hidePanel() : showPanel(); }

  // ========== URL 弹窗 ==========
  function openUrlModal(defaultUrl) {
    state.modalOpen = true;
    showPanel();
    modal.style.display = 'flex';
    urlInput.value = defaultUrl || location.href;
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
    state.tocPage = p - 1; // 输入为 1 基
    renderTOC();
  });
  tocGotoEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#cr-toc-go', toc).click(); }
    if (e.key === 'Escape') { e.preventDefault(); closeTOC(); }
  });

  // 支持 PageUp/PageDown 快捷页翻
  toc.addEventListener('keydown', (e) => {
    if (!state.modalOpen) return;
    if (e.key === 'PageDown') { e.preventDefault(); $('#cr-toc-next', toc).click(); }
    if (e.key === 'PageUp')   { e.preventDefault(); $('#cr-toc-prev', toc).click(); }
    if (e.key === 'Escape')   { e.preventDefault(); closeTOC(); }
  });

  // ========== 键盘捕获（仅面板可见且无弹窗时） ==========
  const SCROLL_STEP = 80;
  function handleKey(e) {
    // Alt+L：打开链接输入
    if (e.altKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault(); e.stopPropagation();
      openUrlModal(location.href);
      return;
    }
    // Alt+T：打开目录
    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault(); e.stopPropagation();
      openTOC();
      return;
    }
    // Ctrl+Alt+X：显示/隐藏面板
    if (e.ctrlKey && e.altKey && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault(); e.stopPropagation();
      togglePanel(); return;
    }

    // 弹窗打开时不拦截其它键
    if (state.modalOpen) return;

    if (!state.visible) return;
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;

    // 捕获阶段阻断站点热键
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

  // 默认不显示；Alt+L / Alt+T 呼出
})();

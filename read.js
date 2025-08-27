// ==UserScript==
// @name         小窗净读器（极简/强容错/多页拼合）
// @namespace    https://jx.local/clean-reader
// @version      0.4.1
// @description  Alt+L 弹窗粘贴链接→抽正文；←/→ 先翻分页再跳章；↑/↓ 平滑滚动；Ctrl+Alt+X 显示/隐藏；捕获阶段接管方向键；GM_xmlhttpRequest 跨域含 GBK；极简无标题无按钮。
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

  // ========== 样式（极简面板） ==========
  GM_addStyle(`
  #cr-panel {
    position: fixed; left: 16px; bottom: 16px; width: 300px; height: 400px;
    background: #fff; color: #222; border: 1px solid #ddd; border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0,0,0,.15); z-index: 2147483646;
    display: none; overflow: hidden; font: 14px/1.7 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  }
  #cr-content { height: 100%; overflow: auto; padding: 12px 14px; }
  #cr-content p{ margin: 0 0 12px 0; }

  /* 输入弹窗 */
  #cr-modal {
    position: fixed; inset: 0; background: rgba(0,0,0,.35); display: none; align-items: center; justify-content: center;
    z-index: 2147483647;
  }
  #cr-modal .cr-box {
    width: min(520px, 92vw); background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 16px;
  }
  #cr-modal h3 { margin: 0 0 10px 0; font-size: 16px; }
  #cr-url {
    width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 14px;
    border: 1px solid #ddd; border-radius: 8px; outline: none;
  }
  #cr-modal .ops { margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end; }
  #cr-modal button {
    border: 1px solid #ddd; background:#fff; border-radius: 8px; padding: 6px 12px; cursor:pointer;
  }
  #cr-modal button.primary { background: #111; color:#fff; border-color:#111; }
  `);

  // ========== DOM ==========
  const panel = document.createElement('div');
  panel.id = 'cr-panel';
  panel.innerHTML = `<div id="cr-content"><div style="color:#888">Alt+L 打开输入弹窗；贴入章节链接开始阅读。←/→ 翻页或跳章，↑/↓ 平滑滚动。Ctrl+Alt+X 显示/隐藏。</div></div>`;
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

  const $ = (sel, root = document) => root.querySelector(sel);
  const contentEl = $('#cr-content', panel);
  const urlInput = $('#cr-url', modal);

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
  };

  // ========== 工具 ==========
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  function absolutize(base, href) { try { return new URL(href, base).href; } catch { return href; } }
  function getSeriesIdFromUrl(url) { try { const m = new URL(url).pathname.match(/(\d+)(?:_(\d+))?\.html$/); return m ? m[1] : null; } catch { return null; } }
  function isSameChapterPage(u1, u2) { const a = getSeriesIdFromUrl(u1), b = getSeriesIdFromUrl(u2); return a && b && a === b; }
  function safeHref(href) {
    if (!href) return null;
    if (/^\s*javascript:/i.test(href)) return null;
    if (href.trim() === '#') return null;
    return href;
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

  // ========== 更稳的正文抽取 ==========
  function extractMain(doc, baseUrl) {
    let node = doc.querySelector('#content')
             || doc.querySelector('#chaptercontent, #chapterContent, .content, .read-content, #contentTxt, #BookText, #txtContent');

    if (!node) {
      const body = doc.body.cloneNode(true);
      try {
        body.querySelectorAll('script,style,ins,.adsbygoogle,.ad,.advert,[id^="hm_t_"],.recommend,.toolbar').forEach(e=>e.remove());
      } catch (_) {}
      const txt = (body.textContent || '').trim().replace(/\n{2,}/g, '</p><p>');
      return txt ? `<p>${txt}</p>` : '<p>（未找到正文容器）</p>';
    }

    try {
      node.querySelectorAll('script,style,ins,.adsbygoogle,.ad,.advert,[id^="hm_t_"],.recommend,.toolbar').forEach(e=>e.remove());
    } catch (_) {}

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

    if (!prev) {
      const cand = Array.from(doc.querySelectorAll('a')).find(a => /上[一页一章]/.test((a.textContent || '').trim()));
      if (cand) prev = safeHref(cand.getAttribute('href') || '');
    }
    if (!next) {
      const anchors = Array.from(doc.querySelectorAll('a'));
      const cand = anchors.reverse().find(a => /下[一页一章]/.test((a.textContent || '').trim()));
      if (cand) next = safeHref(cand.getAttribute('href') || '');
    }

    return { prev: prev ? norm(prev) : null, next: next ? norm(next) : null };
  }

  // ========== 抓取主流程 ==========
  async function fetchChapterSeries(entryUrl) {
    const visited = new Set();
    state.loading = true;
    state.pages = []; state.pageIndex = 0;
    state.seriesId = getSeriesIdFromUrl(entryUrl);
    state.nextChapterUrl = null; state.prevChapterUrl = null;

    renderInfo('正在抓取章节…');

    try {
      // 页1
      const first = await gmFetch(entryUrl);
      const firstDoc = parseHTML(first.html);
      const { prev: prev0, next: next0 } = getNavUrls(firstDoc, entryUrl);
      state.prevChapterUrl = (prev0 && !isSameChapterPage(prev0, entryUrl)) ? prev0 : null;

      state.pages.push({ url: entryUrl, html: extractMain(firstDoc, entryUrl) });
      visited.add(new URL(entryUrl, location.href).href);

      // 连抓分页
      let cursor = next0;
      let step = 0;
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

      // 下一章
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

  // ========== URL 输入弹窗 ==========
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

  // ========== 键盘捕获（仅面板可见时） ==========
  const SCROLL_STEP = 80;
  function handleKey(e) {
    // Alt+L：打开输入弹窗
    if (e.altKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault(); e.stopPropagation();
      openUrlModal(location.href);
      return;
    }
    // Ctrl+Alt+X：显示/隐藏面板
    if (e.ctrlKey && e.altKey && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault(); e.stopPropagation();
      togglePanel(); return;
    }
    // 弹窗打开时不拦
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

  // 默认不显示；按 Alt+L 呼出
})();

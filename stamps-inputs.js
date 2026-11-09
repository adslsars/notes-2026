/* stamps-inputs.js — 通用輸入元件：text（含看板樣式）、choice、sequence、counter（含零件組合小圖）、
   draw、clock、textChoice。只往 window.FJStampsKit.inputs 註冊，載入時不碰 DOM。沒有任何音效。
   介面：Kit.inputs[kind].mount(host, cfg, ctx) → handle { value, ready, setEnabled, onWrong, onSolved,
   answerText, precheck?, refresh?, destroy }。判定、次數、閘門都是引擎的事，這裡只管畫面和值。
   這個檔案裡沒有任何題目內容；所有字、圖都從 cfg（加密資料）來。 */
(function () {
  'use strict';
  const Kit = (window.FJStampsKit = window.FJStampsKit || { inputs: {}, figure: null });
  Kit.inputs = Kit.inputs || {};

  // ─────────── 共用小工具 ───────────
  const REDUCE = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(label, cls) { const b = h('button', 'btn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; return b; }
  function link(label) { const b = h('button', 'st-in-link', label); b.type = 'button'; return b; }
  const tmin = (t) => (t == null ? null : +t.slice(0, 2) * 60 + +t.slice(3, 5));
  const pad2 = (n) => String(n).padStart(2, '0');
  function artInfo(ctx, ref) { try { return ref && ctx.art ? ctx.art(ref) : null; } catch (e) { return null; } }
  function artRatio(ctx, ref) { const a = artInfo(ctx, ref); return a && a.w && a.h ? a.w / a.h : 1; }
  /** 把 el 設成這張圖的遮罩（墨色 var(--ink)）。回傳圖現在有沒有 url（沒有＝照片還沒解好，之後 refresh 再試）。 */
  function maskInto(ctx, el, ref, ink) { const a = artInfo(ctx, ref); if (!a) return true; ctx.mask(el, ref, ink); return !!a.url; }
  function flashEl(el) { if (REDUCE() || !el.animate) return; el.animate([{ backgroundColor: 'var(--accent-soft)' }, { backgroundColor: 'var(--accent-soft)', offset: .4 }, { backgroundColor: 'transparent' }], { duration: 360, easing: 'ease-out' }); }
  function setOff(root, off) { root.classList.toggle('st-in-off', off); }
  /** 標籤列（cfg.label）。沒有就不放。 */
  function labelEl(cfg) { return cfg.label ? h('div', 'st-in-label', cfg.label) : null; }
  function textInput(cfg) {
    const i = h('input', 'st-in-input');
    i.type = 'text';
    i.setAttribute('autocapitalize', 'off'); i.setAttribute('autocorrect', 'off'); i.setAttribute('autocomplete', 'off');
    i.setAttribute('spellcheck', 'false'); i.setAttribute('enterkeyhint', 'done');
    if (cfg.maxlength) i.maxLength = cfg.maxlength;
    if (cfg.lang) i.lang = cfg.lang;
    if (cfg.parse === 'int') i.inputMode = 'numeric';
    return i;
  }
  /** Enter 送出（日文輸入法組字中不送）。 */
  function onEnter(input, ctx) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault(); input.blur(); ctx.submit();
    });
  }
  /** 單選／多選格子（choice 和 textChoice 共用）。 */
  function optionGrid(ctx, cfg, state) {
    const grid = h('div', 'st-choice');
    grid.style.setProperty('--cols', String(cfg.cols || 4));
    const pick = Math.max(1, cfg.pick || 1);
    const ordered = !!cfg.ordered;
    const buttons = new Map();
    const missing = [];
    for (const o of cfg.options || []) {
      const b = h('button', 'st-choice-opt'); b.type = 'button'; b.dataset.stOpt = o.id; b.setAttribute('aria-pressed', 'false');
      if (o.icon) {
        const ic = h('div', 'st-choice-icon'); ic.style.aspectRatio = String(artRatio(ctx, o.icon));
        if (!maskInto(ctx, ic, o.icon)) missing.push([ic, o.icon]);
        b.appendChild(ic); b.classList.add('st-has-icon');
      }
      const t = h('span', 'st-choice-text', o.label || ''); if (cfg.lang) t.lang = cfg.lang; b.appendChild(t);
      b.appendChild(h('span', 'st-choice-mark'));
      grid.appendChild(b); buttons.set(o.id, b);
    }
    function paint() {
      for (const [id, b] of buttons) {
        const k = state.sel.indexOf(id);
        b.setAttribute('aria-pressed', k >= 0 ? 'true' : 'false');
        b.lastChild.textContent = k < 0 ? '' : (ordered && pick > 1 ? String(k + 1) : '✓');
      }
    }
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('.st-choice-opt'); if (!b || grid.classList.contains('st-in-off')) return;
      const id = b.dataset.stOpt; const k = state.sel.indexOf(id);
      if (k >= 0) state.sel.splice(k, 1);
      else if (pick === 1) state.sel = [id];
      else if (state.sel.length >= pick) { flashEl(b); if (cfg.flashMsg) ctx.msg(cfg.flashMsg); return; }
      else state.sel.push(id);
      paint(); state.onChange();
    });
    paint();
    return { el: grid, paint, buttons, missing, labelOf(id) { const o = (cfg.options || []).find((x) => x.id === id); return o ? o.label : id; } };
  }

  // ─────────── text ───────────
  Kit.inputs.text = {
    mount(host, cfg, ctx) {
      const wrap = h('div', 'st-in st-in-text'); host.appendChild(wrap);
      const lab = labelEl(cfg); if (lab) wrap.appendChild(lab);
      const row = h('div', 'st-in-row'); wrap.appendChild(row);
      let icon = null, iconMissing = false;
      if (cfg.icon) { icon = h('div', 'st-in-icon'); icon.style.aspectRatio = String(artRatio(ctx, cfg.icon)); iconMissing = !maskInto(ctx, icon, cfg.icon); row.appendChild(icon); }
      const field = h('div', 'st-in-field'); row.appendChild(field);
      const input = textInput(cfg);
      input.value = String(ctx.draft.get('text', '') || '');
      const board = cfg.style === 'board';
      let plain = board ? !!ctx.draft.get('plain', false) : true;
      const led = h('div', 'st-board');
      const prefix = h('span', 'st-board-prefix', cfg.boardPrefix || ''); prefix.lang = 'ja'; led.appendChild(prefix);
      let toggle = null;
      function layout() {
        field.innerHTML = '';
        if (board && !plain) { input.classList.add('st-board-in'); led.appendChild(input); field.appendChild(led); }
        else { input.classList.remove('st-board-in'); field.appendChild(input); }
        if (toggle) toggle.textContent = plain ? (cfg.boardLabel || '回到看板') : (cfg.plainLabel || '用一般輸入框');
      }
      if (board && cfg.plainLabel) {
        toggle = link(''); toggle.addEventListener('click', () => { plain = !plain; ctx.draft.set('plain', plain); layout(); });
        wrap.appendChild(toggle);
      }
      layout();
      input.addEventListener('input', () => { ctx.draft.set('text', input.value); ctx.changed(); });
      onEnter(input, ctx);
      function placeholder() { for (const p of cfg.placeholderAt || []) if (p.until && !ctx.isAfter(p.until)) return p.text || ''; return cfg.placeholder || ''; }
      function refresh() {
        const ph = placeholder(); if (input.placeholder !== ph) input.placeholder = ph;
        if (iconMissing) iconMissing = !maskInto(ctx, icon, cfg.icon);
      }
      refresh();
      return {
        value: () => input.value,
        ready: () => true,
        setEnabled(b) { input.disabled = !b; if (toggle) toggle.disabled = !b; setOff(wrap, !b); },
        onWrong() { ctx.shake(host); if (cfg.clearOnWrong) { input.value = ''; ctx.draft.set('text', ''); ctx.changed(); } },
        onSolved() { wrap.classList.add('st-in-solved'); },
        answerText: () => input.value.trim(),
        refresh,
        focus() { input.focus(); },
        destroy() { wrap.remove(); },
      };
    },
  };

  // ─────────── choice ───────────
  Kit.inputs.choice = {
    mount(host, cfg, ctx) {
      const wrap = h('div', 'st-in st-in-choice'); host.appendChild(wrap);
      const lab = labelEl(cfg); if (lab) wrap.appendChild(lab);
      const pick = Math.max(1, cfg.pick || 1);
      const valid = new Set((cfg.options || []).map((o) => o.id));
      const state = { sel: (ctx.draft.get('sel', []) || []).filter((id) => valid.has(id)).slice(0, pick), onChange() { ctx.draft.set('sel', state.sel.slice()); ctx.changed(); } };
      const grid = optionGrid(ctx, cfg, state); wrap.appendChild(grid.el);
      const full = () => state.sel.length === pick;
      function code() { if (!full()) return ''; if (pick === 1) return state.sel[0]; return (cfg.ordered ? state.sel : state.sel.slice().sort()).join(','); }
      function clear() { state.sel = []; grid.paint(); state.onChange(); }
      return {
        value: code,
        ready: full,
        setEnabled(b) { setOff(wrap, !b); setOff(grid.el, !b); grid.buttons.forEach((x) => { x.disabled = !b; }); },
        onWrong() { ctx.shake(host); if (cfg.clearOnWrong) clear(); },
        onSolved() { wrap.classList.add('st-in-solved'); },
        answerText: () => state.sel.map(grid.labelOf).join('、'),
        refresh() { for (let i = grid.missing.length - 1; i >= 0; i--) if (maskInto(ctx, grid.missing[i][0], grid.missing[i][1])) grid.missing.splice(i, 1); },
        destroy() { wrap.remove(); },
      };
    },
  };

  // ─────────── sequence（字母塊） ───────────
  Kit.inputs.sequence = {
    mount(host, cfg, ctx) {
      const wrap = h('div', 'st-in st-in-seq'); host.appendChild(wrap);
      const lab = labelEl(cfg); if (lab) wrap.appendChild(lab);
      const tiles = cfg.tiles || [], slots = cfg.slots || tiles.length;
      let filled = (ctx.draft.get('seq', []) || []).filter((k) => Number.isInteger(k) && k >= 0 && k < tiles.length);
      filled = filled.filter((k, i) => filled.indexOf(k) === i).slice(0, slots);
      const slotRow = h('div', 'st-seq-slots'); wrap.appendChild(slotRow);
      const slotEls = [];
      for (let i = 0; i < slots; i++) { const s = h('button', 'st-seq-slot'); s.type = 'button'; s.dataset.stSlot = String(i); s.setAttribute('aria-label', '第 ' + (i + 1) + ' 格'); slotRow.appendChild(s); slotEls.push(s); }
      const grid = h('div', 'st-seq-tiles'); grid.style.setProperty('--cols', String(cfg.cols || 6)); wrap.appendChild(grid);
      const tileEls = tiles.map((t, k) => { const b = h('button', 'st-seq-tile', t); b.type = 'button'; b.dataset.stTile = String(k); grid.appendChild(b); return b; });
      const foot = h('div', 'st-seq-foot'); const reset = btn(cfg.resetLabel || '重來', 'ghost'); foot.appendChild(reset); wrap.appendChild(foot);
      function paint() {
        slotEls.forEach((s, i) => { const k = filled[i]; s.textContent = k == null ? '' : tiles[k]; s.classList.toggle('st-filled', k != null); });
        tileEls.forEach((b, k) => { const used = filled.includes(k); b.classList.toggle('st-used', used); b.setAttribute('aria-disabled', used ? 'true' : 'false'); });
        reset.disabled = filled.length === 0 || wrap.classList.contains('st-in-off');
      }
      function save() { ctx.draft.set('seq', filled.slice()); ctx.changed(); }
      grid.addEventListener('click', (e) => { const b = e.target.closest('.st-seq-tile'); if (!b || b.classList.contains('st-used')) return; if (filled.length >= slots) { flashEl(b); return; } filled.push(+b.dataset.stTile); paint(); save(); });
      slotRow.addEventListener('click', (e) => { const s = e.target.closest('.st-seq-slot'); if (!s) return; const i = +s.dataset.stSlot; if (filled[i] == null) return; filled.splice(i, 1); paint(); save(); });
      reset.addEventListener('click', () => { filled = []; paint(); save(); });
      paint();
      const text = () => filled.map((k) => tiles[k]).join('');
      return {
        value: () => (filled.length === slots ? text() : ''),
        ready: () => filled.length === slots,
        setEnabled(b) { setOff(wrap, !b); slotEls.concat(tileEls).forEach((x) => { x.disabled = !b; }); paint(); },
        onWrong() { ctx.shake(host); if (cfg.clearOnWrong) { filled = []; paint(); save(); } },
        onSolved() { wrap.classList.add('st-in-solved'); },
        answerText: text,
        destroy() { wrap.remove(); },
      };
    },
  };

  // ─────────── counter（計數積木） ───────────
  function rot(x, y, cx, cy, deg) { if (!deg) return [x, y]; const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), dx = x - cx, dy = y - cy; return [cx + dx * c - dy * s, cy + dx * s + dy * c]; }
  /** 用 GPT 零件組出 n 的小圖（只複製、旋轉、排列像素）。規則見 content/1220-notes.md §6-3。 */
  function buildIcon(ctx, ic, n) {
    const bw = ic.box[0], bh = ic.box[1];
    const root = h('div', 'st-counter-icon'); root.style.width = bw + 'px'; root.style.height = bh + 'px';
    const inner = h('div', 'st-counter-icon-in'); root.appendChild(inner);
    const pts = []; let missing = false;
    function part(p, ex) {
      const r = p.rect; let x0 = r[0] * bw, y0 = r[1] * bh; const x1 = r[2] * bw, y1 = r[3] * bh;
      if (p.grow && ex.growDy) y0 += ex.growDy;
      const rw = x1 - x0, rh = y1 - y0, ratio = artRatio(ctx, p.art);
      let w, hh;
      if (p.grow) { w = rw; hh = rh; } else if (rw / rh > ratio) { hh = rh; w = rh * ratio; } else { w = rw; hh = rw / ratio; }
      const cx = (x0 + x1) / 2 + (ex.dx || 0), cy = (y0 + y1) / 2 + (ex.dy || 0);
      const el = h('div', 'st-counter-part');
      el.style.left = (cx - w / 2) + 'px'; el.style.top = (cy - hh / 2) + 'px'; el.style.width = w + 'px'; el.style.height = hh + 'px';
      if (!maskInto(ctx, el, p.art)) missing = true;
      el.style.aspectRatio = 'auto';
      if (p.rotate) el.style.transform = 'rotate(' + p.rotate + 'deg)';
      let holder = el;
      if (ex.fan != null) { const f = h('div', 'st-counter-fan'); f.style.transformOrigin = (ex.pivot[0] * bw) + 'px ' + (ex.pivot[1] * bh) + 'px'; f.style.transform = 'rotate(' + ex.fan + 'deg)'; f.appendChild(el); holder = f; }
      inner.appendChild(holder);
      for (const [x, y] of [[cx - w / 2, cy - hh / 2], [cx + w / 2, cy - hh / 2], [cx + w / 2, cy + hh / 2], [cx - w / 2, cy + hh / 2]]) {
        let q = rot(x, y, cx, cy, p.rotate || 0);
        if (ex.fan != null) q = rot(q[0], q[1], ex.pivot[0] * bw, ex.pivot[1] * bh, ex.fan);
        pts.push(q);
      }
    }
    const rep = ic.repeat, step = rep && rep.step ? [rep.step[0] * bw, rep.step[1] * bh] : [0, 0];
    const stack = rep && rep.layout === 'stack';
    const off = stack ? [(n - 1) * step[0], (n - 1) * step[1]] : [0, 0];
    for (const p of ic.before || []) part(p, { growDy: p.grow ? off[1] : 0 });
    if (rep) for (let i = 0; i < n; i++) {
      if (rep.layout === 'fan') part(rep, { fan: n === 1 ? 0 : -rep.spread / 2 + rep.spread * i / (n - 1), pivot: rep.pivot || [.5, 1] });
      else part(rep, { dx: i * step[0], dy: i * step[1] });
    }
    for (const p of ic.after || []) part(p, stack ? { dx: off[0], dy: off[1] } : {});
    if (ic.fit) {
      let s = 1; const cx = bw / 2, cy = bh;
      for (const [x, y] of pts) { const dx = Math.abs(x - cx); if (dx > cx) s = Math.min(s, cx / dx); if (y < 0) s = Math.min(s, cy / (cy - y)); }
      if (s < .999) { inner.style.transformOrigin = '50% 100%'; inner.style.transform = 'scale(' + s.toFixed(4) + ')'; }
    }
    return { root, missing };
  }
  Kit.inputs.counter = {
    mount(host, cfg, ctx) {
      const wrap = h('div', 'st-in st-in-counter'); host.appendChild(wrap);
      const lab = labelEl(cfg); if (lab) wrap.appendChild(lab);
      const min = cfg.min == null ? 0 : cfg.min, max = cfg.max == null ? 99 : cfg.max;
      // start: null＝一開始是「？」；沒寫＝min
      const initial = () => (cfg.start === null ? null : (cfg.start == null ? min : cfg.start));
      let n = ctx.draft.get('n', initial());
      if (n != null && (typeof n !== 'number' || n < min || n > max)) n = initial();
      const row = h('div', 'st-counter'); wrap.appendChild(row);
      const minus = btn('－', 'st-counter-btn'); minus.setAttribute('aria-label', '減一');
      const plus = btn('＋', 'st-counter-btn'); plus.setAttribute('aria-label', '加一');
      const mid = h('div', 'st-counter-mid'); const iconHolder = h('div', 'st-counter-iconbox'); const num = h('div', 'st-counter-num');
      if (cfg.icon) mid.appendChild(iconHolder); mid.appendChild(num);
      row.appendChild(minus); row.appendChild(mid); row.appendChild(plus);
      let enabled = true, iconMissing = false;
      function paint() {
        num.textContent = n == null ? '？' : String(n);
        num.classList.toggle('st-unknown', n == null);
        minus.disabled = !enabled || n == null || n <= min;
        plus.disabled = !enabled || (n != null && n >= max);
        if (cfg.icon) { iconHolder.innerHTML = ''; if (n != null && n >= 1) { const r = buildIcon(ctx, cfg.icon, n); iconHolder.appendChild(r.root); iconMissing = r.missing; } else iconMissing = false; }
      }
      function set(v) { n = v; ctx.draft.set('n', n); paint(); ctx.changed(); }
      minus.addEventListener('click', () => { if (n != null && n > min) set(n - 1); });
      plus.addEventListener('click', () => { if (n == null) set(cfg.firstValue == null ? Math.max(min, 1) : cfg.firstValue); else if (n < max) set(n + 1); });
      paint();
      return {
        value: () => (n == null ? '' : String(n)),
        ready: () => n != null,
        setEnabled(b) { enabled = b; setOff(wrap, !b); paint(); },
        onWrong() { ctx.shake(host); if (cfg.clearOnWrong) set(initial()); },
        onSolved() { wrap.classList.add('st-in-solved'); },
        answerText: () => (n == null ? '？' : String(n)),
        refresh() { if (iconMissing) paint(); },
        destroy() { wrap.remove(); },
      };
    },
  };

  // ─────────── draw（描線） ───────────
  Kit.inputs.draw = {
    mount(host, cfg, ctx) {
      const wrap = h('div', 'st-in st-in-draw'); host.appendChild(wrap);
      const lab = labelEl(cfg); if (lab) wrap.appendChild(lab);
      const box = h('div', 'st-draw'); wrap.appendChild(box);
      const canvas = h('canvas', 'st-draw-canvas'); canvas.setAttribute('aria-label', '畫布'); box.appendChild(canvas);
      const foot = h('div', 'st-draw-foot'); const redraw = btn(cfg.redrawLabel || '重畫', 'ghost'); foot.appendChild(redraw); box.appendChild(foot);
      const grid = cfg.grid || 3, minFrac = cfg.minFrac == null ? .08 : cfg.minFrac, tinyMax = cfg.tinyMax == null ? 2 : cfg.tinyMax;
      let strokes = (ctx.draft.get('strokes', []) || []).filter((s) => Array.isArray(s) && s.length);   // 每筆：[[x,y],…]，0–1 相對座標
      let cur = null, size = 0, enabled = true;
      const ctx2 = canvas.getContext('2d');
      function fit() {
        const w = Math.max(120, Math.min(320, (host.clientWidth || wrap.clientWidth || 328) - 8));
        if (w === size) return false;
        size = w; const dpr = Math.min(3, window.devicePixelRatio || 1);
        canvas.style.width = canvas.style.height = w + 'px'; canvas.width = canvas.height = Math.round(w * dpr);
        ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
        return true;
      }
      function ink() { return getComputedStyle(canvas).color || '#000'; }
      let lastInk = '';
      function render() {
        ctx2.clearRect(0, 0, size, size);
        lastInk = ink();
        ctx2.lineWidth = 6; ctx2.lineCap = 'round'; ctx2.lineJoin = 'round'; ctx2.strokeStyle = lastInk;
        for (const s of strokes.concat(cur ? [cur] : [])) {
          if (s.length === 1) { ctx2.beginPath(); ctx2.arc(s[0][0] * size, s[0][1] * size, 3, 0, Math.PI * 2); ctx2.fillStyle = ctx2.strokeStyle; ctx2.fill(); continue; }
          ctx2.beginPath(); ctx2.moveTo(s[0][0] * size, s[0][1] * size);
          for (let i = 1; i < s.length; i++) ctx2.lineTo(s[i][0] * size, s[i][1] * size);
          ctx2.stroke();
        }
        redraw.disabled = !enabled || strokes.length === 0;
      }
      /** 筆畫經過的格子（0–8，左上到右下）：每筆各算每格的長度，≥ 這筆總長 × minFrac 的格子才算；所有筆取聯集。 */
      function cells() {
        const out = new Set();
        for (const s of strokes) {
          const len = new Array(grid * grid).fill(0); let total = 0;
          const cellOf = (x, y) => Math.min(grid - 1, Math.max(0, Math.floor(y * grid))) * grid + Math.min(grid - 1, Math.max(0, Math.floor(x * grid)));
          if (s.length === 1) { len[cellOf(s[0][0], s[0][1])] = total = 1; }
          for (let i = 1; i < s.length; i++) {
            const [ax, ay] = s[i - 1], [bx, by] = s[i]; const d = Math.hypot(bx - ax, by - ay); if (!d) continue;
            const k = Math.max(1, Math.ceil(d / .004));
            for (let j = 0; j < k; j++) { const t = (j + .5) / k; len[cellOf(ax + (bx - ax) * t, ay + (by - ay) * t)] += d / k; }
            total += d;
          }
          len.forEach((v, c) => { if (total && v >= total * minFrac) out.add(c); });
        }
        return Array.from(out).sort((a, b) => a - b);
      }
      function save() { ctx.draft.set('strokes', strokes); ctx.changed(); }
      function clear() { strokes = []; cur = null; render(); save(); }
      const pos = (e) => { const r = canvas.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
      canvas.addEventListener('pointerdown', (e) => { if (!enabled) return; e.preventDefault(); canvas.setPointerCapture(e.pointerId); const p = pos(e); cur = [[+p[0].toFixed(4), +p[1].toFixed(4)]]; render(); });
      canvas.addEventListener('pointermove', (e) => { if (!cur) return; e.preventDefault(); const p = pos(e); const last = cur[cur.length - 1]; if (Math.hypot(p[0] - last[0], p[1] - last[1]) < .004) return; cur.push([+p[0].toFixed(4), +p[1].toFixed(4)]); render(); });
      const end = () => { if (!cur) return; strokes.push(cur); cur = null; render(); save(); };
      canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
      canvas.addEventListener('gesturestart', (e) => e.preventDefault());
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      redraw.addEventListener('click', clear);
      fit(); render();
      const ro = window.ResizeObserver ? new ResizeObserver(() => { if (fit()) render(); }) : null; if (ro) ro.observe(host);
      // 深淺色切換時筆跡要跟著換色（canvas 不會自己跟 CSS 變）：聽系統主題和 <html data-theme>
      const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
      const onTheme = () => { if (ink() !== lastInk) render(); };
      if (mq) { if (mq.addEventListener) mq.addEventListener('change', onTheme); else if (mq.addListener) mq.addListener(onTheme); }
      const mo = window.MutationObserver ? new MutationObserver(onTheme) : null; if (mo) mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return {
        value: () => (strokes.length ? cells().join(',') : ''),
        ready: () => strokes.length > 0,
        setEnabled(b) { enabled = b; setOff(wrap, !b); render(); },
        onWrong() { ctx.shake(host); if (cfg.clearOnWrong) clear(); },
        onSolved() { wrap.classList.add('st-in-solved'); },
        answerText: () => '描的圖案',
        precheck() {
          if (!strokes.length) return null;
          const c = cells();
          if (c.length >= grid * grid && cfg.fullMsg) { clear(); return { msg: cfg.fullMsg, clear: true }; }
          if (c.length <= tinyMax && cfg.tinyMsg) { clear(); return { msg: cfg.tinyMsg, clear: true }; }
          return null;
        },
        refresh() { if (fit()) render(); else onTheme(); },
        destroy() { if (ro) ro.disconnect(); if (mo) mo.disconnect(); if (mq) { if (mq.removeEventListener) mq.removeEventListener('change', onTheme); else if (mq.removeListener) mq.removeListener(onTheme); } wrap.remove(); },
      };
    },
  };

  // （音階鍵盤元件已拿掉：旅人規則「這個 app 不放任何音效」，12/20 備案改用文字框。）

  // ─────────── clock（撥時刻，無圖版） ───────────
  Kit.inputs.clock = {
    mount(host, cfg, ctx) {
      const wrap = h('div', 'st-in st-in-clock'); host.appendChild(wrap);
      const lab = labelEl(cfg); if (lab) wrap.appendChild(lab);
      const base = tmin(cfg.start || '12:00');   // 顯示從 12:00 起算（12:00–23:59 繞回）
      const wrapM = (m) => ((m % 720) + 720) % 720;
      let m = ctx.draft.get('m', null); if (typeof m !== 'number') m = wrapM(base - 720);
      const time = h('div', 'st-clock-time'); time.setAttribute('role', 'status'); wrap.appendChild(time);
      const steps = cfg.steps || [];
      const rows = [steps.filter((s) => Math.abs(s.min) >= 60), steps.filter((s) => Math.abs(s.min) < 60)].filter((r) => r.length);
      const btns = [];
      for (const r of rows) { const row = h('div', 'st-clock-row'); for (const s of r) { const b = btn(s.label || (s.min > 0 ? '＋' + s.min : '−' + -s.min)); b.addEventListener('click', () => set(wrapM(m + s.min))); row.appendChild(b); btns.push(b); } wrap.appendChild(row); }
      const text = () => pad2(12 + Math.floor(m / 60)) + ':' + pad2(m % 60);
      function paint() { time.textContent = text(); }
      function set(v) { m = v; ctx.draft.set('m', m); paint(); ctx.changed(); }
      paint();
      return {
        value: () => 'dial:' + m,
        ready: () => true,
        setEnabled(b) { setOff(wrap, !b); btns.forEach((x) => { x.disabled = !b; }); },
        onWrong() { ctx.shake(host); if (cfg.clearOnWrong) set(wrapM(base - 720)); },
        onSolved() { wrap.classList.add('st-in-solved'); },
        answerText: text,
        destroy() { wrap.remove(); },
      };
    },
  };

  // ─────────── textChoice（名字＋選項） ───────────
  Kit.inputs.textChoice = {
    mount(host, cfg, ctx) {
      const wrap = h('div', 'st-in st-in-tc'); host.appendChild(wrap);
      const lab = labelEl(cfg); if (lab) wrap.appendChild(lab);
      const input = textInput(cfg); input.placeholder = cfg.placeholder || ''; input.value = String(ctx.draft.get('text', '') || '');
      wrap.appendChild(input);
      if (cfg.optionsLabel) wrap.appendChild(h('div', 'st-in-sub', cfg.optionsLabel));
      const valid = new Set((cfg.options || []).map((o) => o.id));
      const state = { sel: (ctx.draft.get('sel', []) || []).filter((id) => valid.has(id)).slice(0, 1), onChange() { ctx.draft.set('sel', state.sel.slice()); ctx.changed(); } };
      const grid = optionGrid(ctx, Object.assign({}, cfg, { pick: 1, cols: cfg.cols || 5 }), state); grid.el.classList.add('st-choice-compact'); wrap.appendChild(grid.el);
      input.addEventListener('input', () => { ctx.draft.set('text', input.value); ctx.changed(); });
      onEnter(input, ctx);
      const both = () => input.value.trim() !== '' && state.sel.length === 1;
      return {
        value: () => (both() ? input.value.trim() + '@' + state.sel[0] : ''),
        ready: both,
        setEnabled(b) { setOff(wrap, !b); setOff(grid.el, !b); input.disabled = !b; grid.buttons.forEach((x) => { x.disabled = !b; }); },
        onWrong() { ctx.shake(host); if (cfg.clearOnWrong) { input.value = ''; ctx.draft.set('text', ''); state.sel = []; grid.paint(); state.onChange(); } },
        onSolved() { wrap.classList.add('st-in-solved'); },
        answerText: () => input.value.trim() + (state.sel.length ? '（' + grid.labelOf(state.sel[0]) + '）' : ''),
        destroy() { wrap.remove(); },
      };
    },
  };
})();

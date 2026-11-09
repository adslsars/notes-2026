/* 圖像元件（通用）：figure（圖層、疊字、亮區、點邊）、dial（轉盤）、drag（拖曳）。
   只往 window.FJStampsKit 註冊，載入時不碰 DOM。所有看得到的圖都來自加密資料（ctx.art），程式只做遮罩上色、定位、動畫。這個 App 沒有任何音效。 */
(function () {
  'use strict';
  const Kit = (window.FJStampsKit = window.FJStampsKit || { inputs: {}, figure: null });
  Kit.inputs = Kit.inputs || {};

  // ───────────────────────── 小工具 ─────────────────────────
  const mk = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
  const pct = (v) => (v * 100).toFixed(4) + '%';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduce = (ctx) => !!(ctx && typeof ctx.reduce === 'function' && ctx.reduce());
  const cond = (ctx, when) => (when == null ? true : (ctx && typeof ctx.cond === 'function' ? !!ctx.cond(when) : true));
  const isAfter = (ctx, t) => (t == null ? true : (ctx && typeof ctx.isAfter === 'function' ? !!ctx.isAfter(t) : true));
  const stageSolved = (ctx) => !!(ctx && ctx.stageId && cond(ctx, { solved: ctx.stageId }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const addCls = (e, cls) => { if (cls) String(cls).split(/\s+/).forEach((c) => c && e.classList.add('st-' + c)); };

  function setMask(node, url, color) {
    const m = url ? 'url("' + url + '")' : 'none';
    node.style.webkitMaskImage = m; node.style.maskImage = m;
    node.style.webkitMaskSize = '100% 100%'; node.style.maskSize = '100% 100%';
    node.style.webkitMaskRepeat = 'no-repeat'; node.style.maskRepeat = 'no-repeat';
    node.style.webkitMaskPosition = 'center'; node.style.maskPosition = 'center';
    if (color) node.style.backgroundColor = color;
  }
  function setGradMask(node, grads) {
    node.style.webkitMaskImage = grads; node.style.maskImage = grads;
    node.style.webkitMaskSize = '100% 100%'; node.style.maskSize = '100% 100%';
    node.style.webkitMaskRepeat = 'no-repeat'; node.style.maskRepeat = 'no-repeat';
  }
  function art(ctx, ref) { try { return ref ? (ctx.art(ref) || null) : null; } catch (e) { return null; } }

  /* 畫一個「有實心剪影就先墊底色，再疊墨線」的圖層內容 */
  function inkFill(node, a, ink, withSil) {
    node.textContent = '';
    if (withSil && a.sil) { const s = mk('div', 'st-ink st-sil', node); setMask(s, a.sil, 'var(--st-paper, var(--surface))'); }
    const i = mk('div', 'st-ink', node); setMask(i, a.url, ink || 'var(--ink)');
  }

  /* 把 rect（0–1，以整張底圖為準）內 contain 一張比例 ratio 的圖；rotate 90 時先用寬高對調的尺寸放，再轉。回傳 0–1 的框（元素本身、轉之前） */
  function fitRect(rect, ratio, W, H, rotate) {
    const rw = (rect[2] - rect[0]) * W, rh = (rect[3] - rect[1]) * H;
    const r = rotate === 90 || rotate === -90 || rotate === 270 ? 1 / ratio : ratio;   // 轉完以後佔的框的比例
    let w, h;
    if (rw / rh > r) { h = rh; w = rh * r; } else { w = rw; h = rw / r; }
    const cx = (rect[0] + rect[2]) / 2 * W, cy = (rect[1] + rect[3]) / 2 * H;
    if (rotate === 90 || rotate === -90 || rotate === 270) { const t = w; w = h; h = t; }   // 元素轉之前的尺寸
    return { x: (cx - w / 2) / W, y: (cy - h / 2) / H, w: w / W, h: h / H };
  }
  function placeBox(node, b) { node.style.left = pct(b.x); node.style.top = pct(b.y); node.style.width = pct(b.w); node.style.height = pct(b.h); }
  const anchorT = { c: 'translate(-50%,-50%)', l: 'translate(0,-50%)', r: 'translate(-100%,-50%)' };

  function animate(el, frames, opts, ctx) {
    if (reduce(ctx) || !el.animate) { return Promise.resolve(); }
    const a = el.animate(frames, Object.assign({ fill: 'none', easing: 'cubic-bezier(.22,.8,.3,1)' }, opts));
    const timeout = sleep((opts.duration || 300) + 200).then(() => { try { a.finish(); } catch (e) { /* 已結束 */ } });
    return Promise.race([a.finished.catch(() => {}), timeout]);
  }

  /* 用 ResizeObserver 把容器寬度寫進 --st-w（px），字級和 px 尺寸都用它算 */
  function watchWidth(node, onSize) {
    const apply = () => { const w = node.getBoundingClientRect().width; if (w > 0) { node.style.setProperty('--st-w', w + 'px'); if (onSize) onSize(w); } };
    apply();
    let ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(apply); ro.observe(node); }
    else window.addEventListener('resize', apply);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', apply); };
  }

  // ───────────────────────── 底圖＋圖層＋疊字（figure 和 drag 共用） ─────────────────────────
  /* host 裡建立：.st-fig-box（裁成 view）> .st-fig-img（整張圖的框，座標 0–1 都以它為準）> .st-ink（底圖）＋ 圖層、字、亮區 */
  class Stage {
    constructor(host, ctx, ref, opts) {
      this.ctx = ctx; this.ref = ref; this.opts = opts || {};
      this.a = art(ctx, ref);
      this.box = mk('div', 'st-fig-box', host);
      this.img = mk('div', 'st-fig-img', this.box);
      this.base = mk('div', 'st-ink st-fig-base', this.img);
      const v = this.view = (this.opts.view && this.opts.view.length === 4) ? this.opts.view.slice() : [0, 0, 1, 1];
      this.vw = v[2] - v[0]; this.vh = v[3] - v[1];
      this.W = this.a ? this.a.w : 1000; this.H = this.a ? this.a.h : 1000;
      this.box.style.aspectRatio = (this.W * this.vw) + ' / ' + (this.H * this.vh);
      this.img.style.left = pct(-v[0] / this.vw); this.img.style.top = pct(-v[1] / this.vh);
      this.img.style.width = pct(1 / this.vw); this.img.style.height = pct(1 / this.vh);
      if (this.opts.alt) { this.box.setAttribute('role', 'img'); this.box.setAttribute('aria-label', this.opts.alt); }
      this.iw = 0;
      this.unwatch = watchWidth(this.box, (w) => { this.iw = w / this.vw; this.img.style.setProperty('--st-iw', this.iw + 'px'); if (this.opts.onSize) this.opts.onSize(this.iw); });
      this.paint();
    }
    get ready() { return !!(this.a && this.a.url); }
    paint() {
      if (!this.a) { this.box.classList.add('st-fig-none'); return; }
      if (!this.a.url) { this.a = art(this.ctx, this.ref); }
      if (this.a && this.a.url) { setMask(this.base, this.a.url, 'var(--ink)'); this.box.classList.remove('st-fig-wait'); }
      else this.box.classList.add('st-fig-wait');
    }
    refreshArt() { if (!this.ready) { this.paint(); return this.ready; } return false; }
    /* 容器內的 px → 整張圖的 0–1 座標 */
    toImg(clientX, clientY) {
      const r = this.img.getBoundingClientRect();
      return [(clientX - r.left) / r.width, (clientY - r.top) / r.height];
    }
    /* 0–1 → 相對 .st-fig-img 左上角的 px */
    toPx(x, y) { const r = this.img.getBoundingClientRect(); return [x * r.width, y * r.height]; }

    layer(cfg, parent, solved) {
      const a = art(this.ctx, cfg.art);
      if (!a) return null;
      const node = mk('div', 'st-lay', parent || this.img);
      node.dataset.stLayer = cfg.art;
      const ratio = a.w / a.h;
      const rot = cfg.rotate || 0;
      const b0 = fitRect(cfg.rect, ratio, this.W, this.H, rot);
      const b1 = cfg.rectSolved ? fitRect(cfg.rectSolved, ratio, this.W, this.H, rot) : null;
      placeBox(node, solved && b1 ? b1 : b0);
      if (rot) node.style.transform = 'rotate(' + rot + 'deg)';
      if (a.url) inkFill(node, a, cfg.ink || 'var(--ink)', cfg.sil !== false);
      else node.classList.add('st-lay-wait');
      node._st = { cfg, a, b0, b1, solvedPos: !!(solved && b1) };
      return node;
    }
    label(cfg, parent, solved, anim) {
      const node = mk('div', 'st-lab', parent || this.img);
      addCls(node, cfg.cls);
      const anchor = cfg.anchor || 'c';
      node.style.transform = anchorT[anchor] || anchorT.c;
      node.style.fontSize = 'calc(var(--st-iw, 342px) * ' + (cfg.size || 0.04) + ')';
      if (cfg.lang) node.lang = cfg.lang;
      const at = solved && cfg.atSolved ? cfg.atSolved : cfg.at;
      node.style.left = pct(at[0]); node.style.top = pct(at[1]);
      const span = mk('span', 'st-lab-t', node);
      span.textContent = cfg.text == null ? '' : String(cfg.text);
      node._st = { cfg, solvedPos: !!(solved && cfg.atSolved) };
      if (anim && cfg.from && !reduce(this.ctx)) {
        const dx = 'calc(var(--st-iw, 342px) * ' + cfg.from[0] + ')', dy = 'calc(var(--st-iw, 342px) * ' + cfg.from[1] + ')';
        animate(span, [{ transform: 'translate(' + dx + ',' + dy + ')', opacity: 0 }, { transform: 'translate(0,0)', opacity: 1 }], { duration: 450 }, this.ctx);
      }
      return node;
    }
    rect(cfg, parent) {
      const node = mk('div', 'st-rect', parent || this.img);
      node.dataset.stRect = cfg.id;
      placeBox(node, { x: cfg.rect[0], y: cfg.rect[1], w: cfg.rect[2] - cfg.rect[0], h: cfg.rect[3] - cfg.rect[1] });
      return node;
    }
    /* 答對動畫：有 rectSolved 的圖層、有 atSolved 的字移過去（700 ms） */
    solveMove(root, ctx) {
      const ps = [];
      root.querySelectorAll('.st-lay').forEach((n) => {
        const s = n._st; if (!s || !s.b1 || s.solvedPos) return;
        s.solvedPos = true;
        const from = { left: pct(s.b0.x), top: pct(s.b0.y), width: pct(s.b0.w), height: pct(s.b0.h) };
        const to = { left: pct(s.b1.x), top: pct(s.b1.y), width: pct(s.b1.w), height: pct(s.b1.h) };
        placeBox(n, s.b1);
        ps.push(animate(n, [from, to], { duration: 700, easing: 'cubic-bezier(.3,.7,.2,1)' }, ctx));
      });
      root.querySelectorAll('.st-lab').forEach((n) => {
        const s = n._st; if (!s || !s.cfg.atSolved || s.solvedPos) return;
        s.solvedPos = true;
        const from = { left: pct(s.cfg.at[0]), top: pct(s.cfg.at[1]) }, to = { left: pct(s.cfg.atSolved[0]), top: pct(s.cfg.atSolved[1]) };
        n.style.left = to.left; n.style.top = to.top;
        ps.push(animate(n, [from, to], { duration: 700, easing: 'cubic-bezier(.3,.7,.2,1)' }, ctx));
      });
      return Promise.all(ps);
    }
    destroy() { this.unwatch(); }
  }

  // ───────────────────────── 點和多邊形 ─────────────────────────
  function inPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  const inRect = (p, r) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];
  const inShape = (p, z) => (z.poly ? inPoly(p, z.poly) : (z.rect ? inRect(p, z.rect) : false));

  // ───────────────────────── figure ─────────────────────────
  const figRegistry = [];
  const figKey = (ctx) => [ctx && ctx.day, ctx && ctx.variant, ctx && ctx.stageId].join('|');

  class Figure {
    constructor(host, cfg, ctx) {
      this.host = host; this.cfg = cfg; this.ctx = ctx; this.key = figKey(ctx);
      host.classList.add('st-fig');
      if (cfg.width && cfg.width !== 1) host.style.width = pct(cfg.width);
      this.stage = new Stage(host, ctx, cfg.art, { view: cfg.view, alt: cfg.alt });
      this.solved = stageSolved(ctx);
      this.zoneState = new Set();
      this.zonesOn = {};
      const z = cfg.zones;
      if (z) {
        const saved = z.save && ctx.draft ? ctx.draft.get('zones', null) : null;
        if (Array.isArray(saved)) saved.forEach((id) => this.zoneState.add(id));
        if (this.solved && Array.isArray(z.solvedOn)) { this.zoneState = new Set(z.solvedOn); }
        this.bindZones();
      }
      this.sig = null;
      this.render();
      figRegistry.push(this);
    }
    signature() {
      const c = this.ctx, out = [];
      (this.cfg.layers || []).forEach((l) => out.push(cond(c, l.when) ? 1 : 0));
      (this.cfg.labels || []).forEach((l) => out.push(cond(c, l.when) ? 1 : 0));
      if (this.cfg.zones) (this.cfg.zones.items || []).forEach((it) => {
        ((it.on && it.on.layers) || []).forEach((l) => out.push(cond(c, l.when) ? 1 : 0));
        ((it.on && it.on.labels) || []).forEach((l) => out.push(cond(c, l.when) ? 1 : 0));
      });
      out.push(stageSolved(c) ? 1 : 0);
      return out.join('');
    }
    render() {
      const s = this.stage, c = this.ctx, cfg = this.cfg;
      s.img.querySelectorAll('.st-lay, .st-lab, .st-rect, .st-zone-on').forEach((n) => n.remove());
      this.zonesOn = {};
      (cfg.layers || []).forEach((l) => { if (cond(c, l.when)) s.layer(l, null, this.solved); });
      (cfg.rects || []).forEach((r) => s.rect(r));
      (cfg.labels || []).forEach((l) => { if (cond(c, l.when)) s.label(l, null, this.solved, false); });
      if (cfg.zones) {
        (cfg.zones.items || []).forEach((it) => { if (this.zoneState.has(it.id)) this.zoneOn(it, false); });
        this.updateZonesEnabled();
      }
      this.updateDim();
      this.sig = this.signature();
    }
    updateDim() {
      const dim = !!(this.cfg.dimUntil && !isAfter(this.ctx, this.cfg.dimUntil));
      this.stage.box.classList.toggle('st-dim', dim);
      return dim;
    }
    zonesEnabled() {
      const z = this.cfg.zones;
      if (!z) return false;
      if (this.cfg.dimUntil && !isAfter(this.ctx, this.cfg.dimUntil)) return false;
      if (z.from && !isAfter(this.ctx, z.from)) return false;
      if (stageSolved(this.ctx)) return false;
      return true;
    }
    updateZonesEnabled() { const on = this.zonesEnabled(); this.stage.box.classList.toggle('st-zones-live', on); }
    bindZones() {
      const box = this.stage.box;
      box.classList.add('st-zones');
      let down = null;
      box.addEventListener('pointerdown', (e) => { if (!this.zonesEnabled()) return; down = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
      box.addEventListener('pointerup', (e) => {
        if (!down || down.id !== e.pointerId) { down = null; return; }
        const d = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        down = null;
        const limit = 10 * (this.stage.iw || 360) / 360;   // 超過 10 單位（圖寬 360 換算）當成捲動
        if (d > limit || !this.zonesEnabled()) return;
        this.tapZone(this.stage.toImg(e.clientX, e.clientY));
      });
      box.addEventListener('pointercancel', () => { down = null; });
    }
    tapZone(p) {
      const z = this.cfg.zones;
      for (const d of (z.dead || [])) if (inPoly(p, d)) return;
      const it = (z.items || []).find((x) => inShape(p, x));
      if (!it) return;
      if (this.zoneState.has(it.id)) { this.zoneState.delete(it.id); this.zoneOff(it, true); }
      else { this.zoneState.add(it.id); this.zoneOn(it, true); }
      if (z.save && this.ctx.draft) this.ctx.draft.set('zones', Array.from(this.zoneState));
      if (typeof this.ctx.changed === 'function') this.ctx.changed();
    }
    zoneOn(it, anim) {
      if (this.zonesOn[it.id]) return;
      const g = mk('div', 'st-zone-on', this.stage.img);
      g.dataset.stZone = it.id;
      if (it.label) g.setAttribute('aria-label', it.label);
      const on = it.on || {};
      (on.layers || []).forEach((l) => { if (cond(this.ctx, l.when)) { const n = this.stage.layer(l, g, this.solved); if (n && anim) animate(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 450 }, this.ctx); } });
      (on.labels || []).forEach((l) => { if (cond(this.ctx, l.when)) this.stage.label(l, g, this.solved, anim); });
      this.zonesOn[it.id] = g;
    }
    zoneOff(it, anim) {
      const g = this.zonesOn[it.id];
      if (!g) return Promise.resolve();
      delete this.zonesOn[it.id];
      const done = () => g.remove();
      if (!anim) { done(); return Promise.resolve(); }
      return animate(g, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 }, this.ctx).then(done);
    }
    // ── 對外 ──
    refresh() {
      this.stage.refreshArt();
      this.stage.img.querySelectorAll('.st-lay-wait').forEach((n) => { const a = art(this.ctx, n._st.cfg.art); if (a && a.url) { n._st.a = a; n.classList.remove('st-lay-wait'); inkFill(n, a, n._st.cfg.ink || 'var(--ink)', n._st.cfg.sil !== false); } });
      const sig = this.signature();
      if (sig !== this.sig) { this.solved = stageSolved(this.ctx); this.render(); return; }
      this.updateDim();
      if (this.cfg.zones) this.updateZonesEnabled();
    }
    flash(ids, ms) {
      ids = Array.isArray(ids) ? ids : [ids];
      ms = ms || 250;
      const list = ids.map((id) => this.stage.img.querySelector('.st-rect[data-st-rect="' + String(id).replace(/"/g, '') + '"]')).filter(Boolean);
      if (!list.length) return Promise.resolve();
      return list.reduce((p, n) => p.then(() => { n.classList.add('st-on'); return sleep(ms).then(() => n.classList.remove('st-on')); }), Promise.resolve());
    }
    async solvedAnim() {
      this.solved = true;
      const z = this.cfg.zones;
      if (z && Array.isArray(z.solvedOn)) {
        const want = new Set(z.solvedOn);
        const ps = [];
        (z.items || []).forEach((it) => {
          if (want.has(it.id) && !this.zoneState.has(it.id)) { this.zoneState.add(it.id); this.zoneOn(it, true); }
          else if (!want.has(it.id) && this.zoneState.has(it.id)) { this.zoneState.delete(it.id); ps.push(this.zoneOff(it, true)); }
        });
        if (z.save && this.ctx.draft) this.ctx.draft.set('zones', Array.from(this.zoneState));
        if (ps.length && !reduce(this.ctx)) { ps.push(sleep(450)); }   // 有 zone 要淡掉才等；沒有就直接往下走
        await Promise.all(ps);
      }
      // 這一段答對後 notSolved 的字、圖層淡出
      const gone = [];
      this.stage.img.querySelectorAll('.st-lay, .st-lab').forEach((n) => { const w = n._st && n._st.cfg.when; if (w && w.notSolved === this.ctx.stageId) gone.push(n); });
      await Promise.all(gone.map((n) => animate(n, [{ opacity: 1 }, { opacity: 0 }], { duration: 250 }, this.ctx).then(() => n.remove())));
      await this.stage.solveMove(this.stage.img, this.ctx);
      // 這一段答對後才出現的字、圖層（when.solved＝這一段）淡入；引擎之後 refresh() 時 signature 相同就不會重畫
      const sid = this.ctx.stageId, s = this.stage, fresh = [];
      const have = new Set(); s.img.querySelectorAll('.st-lay, .st-lab').forEach((n) => { if (n._st) have.add(n._st.cfg); });
      const rest = (w) => { const o = {}; Object.keys(w).forEach((k) => { if (k !== 'solved') o[k] = w[k]; }); return Object.keys(o).length ? o : null; };   // 除了 solved 以外的條件
      const due = (l) => l.when && l.when.solved === sid && !have.has(l) && cond(this.ctx, rest(l.when));
      (this.cfg.layers || []).forEach((l) => { if (due(l)) { const n = s.layer(l, null, true); if (n) fresh.push(n); } });
      (this.cfg.labels || []).forEach((l) => { if (due(l)) fresh.push(s.label(l, null, true, true)); });
      await Promise.all(fresh.map((n) => animate(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 450 }, this.ctx)));
      this.stage.box.classList.remove('st-zones-live');
      this.sig = this.signature();
    }
    destroy() {
      const i = figRegistry.indexOf(this); if (i >= 0) figRegistry.splice(i, 1);
      this.stage.destroy();
    }
  }

  Kit.figure = {
    mount(host, cfg, ctx) { return new Figure(host, cfg, ctx); },
    /* 同一題同一段裡所有的圖（引擎的 solveFx.flash 可以用） */
    find(ctx) { const k = figKey(ctx); return figRegistry.filter((f) => f.key === k); },
    flash(ctx, ids, ms) { return Promise.all(Kit.figure.find(ctx).map((f) => f.flash(ids, ms))); },
  };

  // ───────────────────────── dial 轉盤 ─────────────────────────
  const norm180 = (a) => { a = ((a % 360) + 540) % 360 - 180; return a === -180 ? 180 : a; };
  const ringCenters = (ring) => (Array.isArray(ring.centers) && ring.centers.length ? ring.centers.slice() : Array.from({ length: ring.cells || (ring.labels || []).length }, (_, k) => (ring.firstDeg || 0) + k * 360 / (ring.cells || (ring.labels || []).length)));

  class Dial {
    constructor(host, cfg, ctx) {
      this.host = host; this.cfg = cfg; this.ctx = ctx;
      host.classList.add('st-dial');
      this.a = cfg.art ? art(ctx, cfg.art) : null;
      this.rings = (cfg.rings || []).map((r) => ({ cfg: r, centers: ringCenters(r), n: (r.labels || []).length || r.cells || 0 }));
      this.rot = this.rings.map(() => 0);
      this.target = this.rot.slice();
      this.enabled = true;
      this.anim = null;
      // 起點：草稿 → cfg.start → 0
      let idx = (ctx.draft && ctx.draft.get) ? ctx.draft.get('dial', null) : null;
      if (!Array.isArray(idx) || idx.length !== this.rings.length) idx = Array.isArray(cfg.start) ? cfg.start : this.rings.map(() => 0);
      this.rings.forEach((r, i) => { const k = clamp(+idx[i] || 0, 0, Math.max(0, r.n - 1)); this.rot[i] = this.target[i] = -r.centers[k]; });
      if (this.a) this.buildFace(); else this.buildRows();
      this.read = mk('div', 'st-dial-read', host);
      this.read.setAttribute('aria-live', 'polite');
      this.update();
    }
    // ── 有圖：盤面 ──
    buildFace() {
      const c = this.cfg, a = this.a, cx = c.center ? c.center[0] : 0.5, cy = c.center ? c.center[1] : 0.5;
      this.cx = cx; this.cy = cy;
      const face = this.face = mk('div', 'st-dial-face', this.host);
      face.style.aspectRatio = a.w + ' / ' + a.h;
      face.setAttribute('role', 'group');
      if (c.label) face.setAttribute('aria-label', c.label);
      const at = pct(cx) + ' ' + pct(cy);
      const ell = (r) => 'ellipse ' + pct(r) + ' ' + pct(r * a.w / a.h) + ' at ' + at;   // 半徑以圖寬為單位；y 方向換成圖高的比例
      const edge = 0.004;   // 柔邊（避免鋸齒），約 1.4 px
      const outer = Math.max.apply(null, this.rings.map((r) => r.cfg.r[1]));
      const inner = Math.min.apply(null, this.rings.map((r) => r.cfg.r[0]));
      // 固定層：最外圈以外（外框、箭頭）＋ 最內圈以內（中心）
      const fix = mk('div', 'st-dial-fix', face);
      setGradMask(fix, 'radial-gradient(' + ell(outer + edge) + ', transparent ' + pct(outer / (outer + edge)) + ', #000 100%), radial-gradient(' + ell(inner) + ', #000 ' + pct(1 - edge / inner) + ', transparent 100%)');
      setMask(mk('div', 'st-ink', fix), a.url, 'var(--ink)');
      // 每一圈一層（環形），轉動就轉這一層
      this.ringEls = this.rings.map((r) => {
        const r0 = r.cfg.r[0], r1 = r.cfg.r[1];
        const ring = mk('div', 'st-dial-ring', face);
        setGradMask(ring, 'radial-gradient(' + ell(r1 + edge) + ', transparent ' + pct((r0 - edge) / (r1 + edge)) + ', #000 ' + pct(r0 / (r1 + edge)) + ', #000 ' + pct(r1 / (r1 + edge)) + ', transparent 100%)');
        ring.style.transformOrigin = at;
        setMask(mk('div', 'st-ink', ring), a.url, 'var(--ink)');
        return ring;
      });
      // 格子裡的字和小圖（一直是正的，只移位置）
      this.cells = this.rings.map((r, i) => {
        const rc = r.cfg, out = [];
        const showText = rc.cellText !== false && (rc.labelSize == null || rc.labelSize > 0);
        for (let k = 0; k < r.n; k++) {
          const cell = mk('div', 'st-dial-cell', face);
          cell.dataset.ring = i; cell.dataset.k = k;
          if (showText) {
            const t = mk('span', 'st-dial-txt', cell);
            const txt = String((rc.labels || [])[k] == null ? '' : rc.labels[k]);
            t.textContent = txt;
            const sz = (rc.labelSize || 0.045) * (Array.from(txt).length >= 2 ? 0.88 : 1);   // 兩字的格小一號
            t.style.fontSize = 'calc(var(--st-w, 342px) * ' + sz + ')';
          }
          const icon = rc.icons && rc.icons[k] ? art(this.ctx, rc.icons[k]) : null;
          if (icon) {
            const ic = mk('div', 'st-dial-icon', cell);
            const w = rc.iconSize || 0.12;
            ic.style.width = 'calc(var(--st-w, 342px) * ' + w + ')';
            ic.style.height = 'calc(var(--st-w, 342px) * ' + (w * icon.h / icon.w) + ')';
            if (icon.url) setMask(ic, icon.url, 'var(--ink)'); else ic.classList.add('st-lay-wait');
            ic.dataset.ref = rc.icons[k];
          }
          out.push(cell);
        }
        return out;
      });
      if (c.hub != null && c.hub !== '') {
        const hub = mk('div', 'st-dial-hub', face);
        hub.textContent = String(c.hub);
        hub.style.left = pct(cx); hub.style.top = pct(cy);
        hub.style.fontSize = 'calc(var(--st-w, 342px) * ' + (inner * 1.1) + ')';
      }
      this.unwatch = watchWidth(face, () => this.layoutCells());
      this.bindGesture(face);
      // 每圈一組 ◀ ▶
      this.ctls = this.rings.map((r, i) => this.buildCtl(r, i));
    }
    buildCtl(r, i) {
      const row = mk('div', 'st-dial-ctl', this.host);
      const prev = mk('button', 'btn st-dial-btn', row); prev.type = 'button'; prev.textContent = '◀'; prev.setAttribute('aria-label', (r.cfg.name || '') + ' 上一格');
      const mid = mk('div', 'st-dial-mid', row);
      if (r.cfg.name) mk('span', 'st-dial-name', mid).textContent = r.cfg.name;
      const cur = mk('span', 'st-dial-cur', mid);
      const next = mk('button', 'btn st-dial-btn', row); next.type = 'button'; next.textContent = '▶'; next.setAttribute('aria-label', (r.cfg.name || '') + ' 下一格');
      prev.addEventListener('click', () => this.step(i, -1));
      next.addEventListener('click', () => this.step(i, +1));
      return { row, prev, next, cur };
    }
    // ── 沒有圖：每圈一列 ──
    buildRows() {
      this.host.classList.add('st-dial-plain');
      this.ctls = this.rings.map((r, i) => this.buildCtl(r, i));
    }
    // ── 幾何 ──
    layoutCells() {
      if (!this.cells) return;
      this.rings.forEach((r, i) => {
        const rc = r.cfg, rot = this.rot[i];
        const sel = this.selected(i);
        r.centers.forEach((cdeg, k) => {
          const cell = this.cells[i][k]; if (!cell) return;
          const ang = (cdeg + rot) * Math.PI / 180;
          const R = rc.labelR != null ? rc.labelR : (rc.r[0] + rc.r[1]) / 2;
          const Ri = rc.iconR != null ? rc.iconR : R;
          const txt = cell.querySelector('.st-dial-txt'), ic = cell.querySelector('.st-dial-icon');
          // 字和小圖各自的半徑；格子容器放在字的位置，小圖用 translate 修正差距
          cell.style.left = pct(this.cx + R * Math.sin(ang));
          cell.style.top = pct(this.cy - R * Math.cos(ang) * this.a.w / this.a.h);
          if (ic) {
            const dx = (Ri - R) * Math.sin(ang), dy = -(Ri - R) * Math.cos(ang);
            ic.style.transform = 'translate(calc(var(--st-w, 342px) * ' + dx.toFixed(5) + '), calc(var(--st-w, 342px) * ' + dy.toFixed(5) + '))';
            if (!txt) { cell.style.left = pct(this.cx + Ri * Math.sin(ang)); cell.style.top = pct(this.cy - Ri * Math.cos(ang) * this.a.w / this.a.h); ic.style.transform = ''; }
          }
          cell.classList.toggle('st-sel', k === sel);
        });
      });
    }
    applyRot() {
      if (this.ringEls) this.rings.forEach((r, i) => { this.ringEls[i].style.transform = 'rotate(' + this.rot[i].toFixed(3) + 'deg)'; });
      this.layoutCells();
    }
    /* 目前（目標轉角）箭頭下的格子 */
    selected(i, rot) {
      const r = this.rings[i], a = rot == null ? this.target[i] : rot;
      let best = 0, bd = 1e9;
      r.centers.forEach((c, k) => { const d = Math.abs(norm180(c + a)); if (d < bd) { bd = d; best = k; } });
      return best;
    }
    snapTarget(i, rot) {
      const k = this.selected(i, rot);
      return rot - norm180(this.rings[i].centers[k] + rot);
    }
    /* 動畫轉到 target（180 ms，ease-out） */
    settle(i) {
      const from = this.rot[i], to = this.target[i];
      if (this.anim && this.anim[i]) cancelAnimationFrame(this.anim[i]);
      this.anim = this.anim || {};
      if (reduce(this.ctx) || Math.abs(to - from) < 0.01) { this.rot[i] = to; this.applyRot(); return; }
      const t0 = performance.now(), dur = 180 + Math.min(220, Math.abs(to - from) * 1.2);
      const tick = (now) => {
        const p = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 3);
        this.rot[i] = from + (to - from) * e;
        this.applyRot();
        if (p < 1) this.anim[i] = requestAnimationFrame(tick); else this.anim[i] = null;
      };
      this.anim[i] = requestAnimationFrame(tick);
    }
    step(i, dir) {
      if (!this.enabled) return;
      const r = this.rings[i];
      const k = this.selected(i);
      const k2 = ((k + dir) % r.n + r.n) % r.n;
      // 從「要去的那一格」累加：target 以目前 target 為準，往 dir 方向走到 k2 的最近一個角度
      let delta = norm180(-r.centers[k2] - this.target[i]);
      if (dir > 0 && delta > 0) delta -= 360;        // ▶：整圈逆時針（角度變小）
      if (dir < 0 && delta < 0) delta += 360;        // ◀：順時針
      this.target[i] += delta;
      this.settle(i);
      this.update();
    }
    update() {
      const labs = this.rings.map((r, i) => String((r.cfg.labels || [])[this.selected(i)] == null ? '' : r.cfg.labels[this.selected(i)]));
      if (this.ctls) this.ctls.forEach((c, i) => { c.cur.textContent = labs[i]; });
      if (this.cfg.readout) this.read.textContent = String(this.cfg.readout).replace(/\{(\d+)\}/g, (_, n) => labs[+n] == null ? '' : labs[+n]);
      else this.read.textContent = labs.join(' ／ ');
      if (this.ctx.draft && this.ctx.draft.set) this.ctx.draft.set('dial', this.rings.map((r, i) => this.selected(i)));
      if (this.cells) this.layoutCells();
      if (typeof this.ctx.changed === 'function') this.ctx.changed();
    }
    // ── 手勢 ──
    bindGesture(face) {
      let g = null;
      const angleAt = (e) => {
        const r = face.getBoundingClientRect();
        const dx = (e.clientX - r.left) / r.width - this.cx, dy = (e.clientY - r.top) / r.height - this.cy;
        const dyw = dy * this.a.h / this.a.w;   // 換成以圖寬為單位
        return { ang: Math.atan2(dx, -dyw) * 180 / Math.PI, dist: Math.hypot(dx, dyw) };
      };
      face.addEventListener('pointerdown', (e) => {
        if (!this.enabled || g) return;
        const p = angleAt(e);
        const i = this.rings.findIndex((r) => p.dist >= r.cfg.r[0] && p.dist <= r.cfg.r[1]);
        if (i < 0) return;
        if (this.anim && this.anim[i]) { cancelAnimationFrame(this.anim[i]); this.anim[i] = null; }
        g = { id: e.pointerId, i, last: p.ang, moved: false };
        try { face.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        face.classList.add('st-grab');
        e.preventDefault();
      });
      face.addEventListener('pointermove', (e) => {
        if (!g || e.pointerId !== g.id) return;
        const p = angleAt(e);
        const d = norm180(p.ang - g.last);
        g.last = p.ang;
        if (Math.abs(d) > 0.2) g.moved = true;
        this.rot[g.i] += d;
        this.applyRot();
      });
      const end = (e) => {
        if (!g || e.pointerId !== g.id) return;
        const i = g.i; g = null;
        face.classList.remove('st-grab');
        this.target[i] = this.snapTarget(i, this.rot[i]);
        this.settle(i);
        this.update();
      };
      face.addEventListener('pointerup', end);
      face.addEventListener('pointercancel', end);
      face.addEventListener('gesturestart', (e) => e.preventDefault());
    }
    // ── handle 介面 ──
    value() {
      const c = this.cfg, sep = c.sep == null ? '-' : c.sep;
      if (!this.ready()) return '';
      return this.rings.map((r, i) => { const k = this.selected(i); return c.encode === 'value' && r.cfg.values ? String(r.cfg.values[k]) : String(k); }).join(sep);
    }
    ready() {
      const b = this.cfg.blankIndex;
      if (b == null) return true;
      return !this.rings.some((r, i) => { const k = this.selected(i); return Array.isArray(b) ? (b[i] != null && +b[i] === k) : +b === k; });
    }
    setEnabled(on) {
      this.enabled = !!on;
      this.host.classList.toggle('st-off', !on);
      if (this.ctls) this.ctls.forEach((c) => { c.prev.disabled = !on; c.next.disabled = !on; });
    }
    onWrong() { if (typeof this.ctx.shake === 'function') this.ctx.shake(this.face || this.host); }
    onSolved() { this.host.classList.add('st-solved'); }
    /* 結果卡「你的答案」：各圈對準的字用「／」接（和 reveal.answer、parts 的寫法一致；不帶 readout 的前綴字） */
    answerText() { const labs = this.rings.map((r, i) => { const k = this.selected(i); const l = (r.cfg.labels || [])[k]; return l == null ? String(k) : String(l); }); return labs.join('／'); }
    refresh() {
      if (this.cells) this.cells.forEach((cs) => cs.forEach((cell) => { const ic = cell.querySelector('.st-dial-icon.st-lay-wait'); if (ic) { const a = art(this.ctx, ic.dataset.ref); if (a && a.url) { setMask(ic, a.url, 'var(--ink)'); ic.classList.remove('st-lay-wait'); } } }));
      if (this.face && this.a && !this.a.url) { const a = art(this.ctx, this.cfg.art); if (a && a.url) { this.a = a; this.face.querySelectorAll('.st-ink').forEach((n) => setMask(n, a.url, 'var(--ink)')); } }
    }
    destroy() { if (this.unwatch) this.unwatch(); if (this.anim) Object.values(this.anim).forEach((id) => id && cancelAnimationFrame(id)); }
  }
  Kit.inputs.dial = { mount(host, cfg, ctx) { return new Dial(host, cfg, ctx); } };

  // ───────────────────────── drag 拖曳到圖上 ─────────────────────────
  class Drag {
    constructor(host, cfg, ctx) {
      this.host = host; this.cfg = cfg; this.ctx = ctx;
      host.classList.add('st-drag');
      this.enabled = true; this.solved = false;
      this.wrap = mk('div', 'st-drag-wrap', host);
      const mapHost = mk('div', 'st-drag-map', this.wrap);
      this.stage = new Stage(mapHost, ctx, cfg.art, { view: cfg.view, alt: cfg.alt, onSize: () => this.layout() });
      (cfg.labels || []).forEach((l) => { if (cond(ctx, l.when)) this.stage.label(l, null, false, false); });
      this.buildZones();
      // 原位那一排
      this.homeRow = mk('div', 'st-drag-home', this.wrap);
      this.tokens = (cfg.tokens || []).map((t) => this.buildToken(t));
      // 位置：草稿
      const saved = ctx.draft && ctx.draft.get ? ctx.draft.get('drag', null) : null;
      this.tokens.forEach((t) => { const z = saved && saved[t.cfg.id]; t.zone = z && this.zoneById(z) ? z : null; });
      this.unwatch = watchWidth(this.wrap, () => this.layout());
      this.layout();
    }
    zoneById(id) { return (this.cfg.zones || []).find((z) => z.id === id) || null; }
    buildZones() {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'st-drag-zones');
      svg.setAttribute('viewBox', '0 0 ' + this.stage.W + ' ' + this.stage.H);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      this.zoneEls = {};
      (this.cfg.zones || []).forEach((z) => {
        let sh;
        if (z.poly) { sh = document.createElementNS('http://www.w3.org/2000/svg', 'polygon'); sh.setAttribute('points', z.poly.map((p) => (p[0] * this.stage.W).toFixed(1) + ',' + (p[1] * this.stage.H).toFixed(1)).join(' ')); }
        else { sh = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); sh.setAttribute('x', (z.rect[0] * this.stage.W).toFixed(1)); sh.setAttribute('y', (z.rect[1] * this.stage.H).toFixed(1)); sh.setAttribute('width', ((z.rect[2] - z.rect[0]) * this.stage.W).toFixed(1)); sh.setAttribute('height', ((z.rect[3] - z.rect[1]) * this.stage.H).toFixed(1)); sh.setAttribute('rx', (this.stage.W * 0.012).toFixed(1)); }
        sh.setAttribute('class', 'st-zone');
        sh.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.appendChild(sh);
        this.zoneEls[z.id] = sh;
      });
      this.stage.img.appendChild(svg);
    }
    buildToken(cfg) {
      const el = mk('div', 'st-tok', this.wrap);
      el.dataset.stToken = cfg.id;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', cfg.label || cfg.id);
      const a = art(this.ctx, cfg.art);
      const body = mk('div', 'st-tok-body', el);
      if (a && a.url) inkFill(body, a, 'var(--ink)', true);
      const lab = mk('span', 'st-tok-lab', el);
      lab.textContent = cfg.label == null ? '' : String(cfg.label);
      // 原位
      const home = mk('div', 'st-home', this.homeRow);
      const ha = art(this.ctx, cfg.homeArt);
      if (ha && ha.url) setMask(mk('div', 'st-ink', home), ha.url, 'var(--ink-3)');
      const t = { cfg, el, home, a, zone: null, drag: null };
      this.bindToken(t);
      return t;
    }
    /* 尺寸和位置（px，相對 .st-drag-wrap） */
    layout() {
      if (!this.stage || !this.tokens) return;   // Stage 建立時會先回呼一次 onSize，那時還沒有棋子
      const iw = this.stage.iw || this.stage.box.getBoundingClientRect().width / this.stage.vw;
      if (!iw) return;
      const wr = this.wrap.getBoundingClientRect(), ir = this.stage.img.getBoundingClientRect();
      const ox = ir.left - wr.left, oy = ir.top - wr.top;
      this.tokens.forEach((t) => {
        const d = (t.cfg.size || 0.15) * iw;
        t.d = d;
        t.el.style.width = t.el.style.height = d + 'px';
        t.home.style.width = t.home.style.height = d + 'px';
        t.el.querySelector('.st-tok-lab').style.fontSize = (d * 0.5) + 'px';   // 字級＝棋子直徑的 0.5 倍（briefs/61 §5）
      });
      // 同區的棋子左右錯開
      const byZone = {};
      this.tokens.forEach((t) => { if (t.zone) (byZone[t.zone] = byZone[t.zone] || []).push(t); });
      this.tokens.forEach((t) => {
        if (t.drag) return;
        let cx, cy;
        if (t.zone) {
          const z = this.zoneById(t.zone);
          const snap = z.snap || [(z.rect[0] + z.rect[2]) / 2, (z.rect[1] + z.rect[3]) / 2];
          const group = byZone[t.zone], n = group.length, j = group.indexOf(t);
          // 同區的棋子左右錯開：至少錯開棋子直徑的 0.8 倍，不然小的會被大的蓋住大半
          const avgD = group.reduce((s, x) => s + (x.d || 0), 0) / n;
          const stepPx = Math.max((this.cfg.sameZoneOffset || 0.04) * iw * 2, avgD * 0.8);
          const off = stepPx * (j - (n - 1) / 2);
          cx = ox + snap[0] * ir.width + off; cy = oy + snap[1] * ir.height;
        } else {
          const hr = t.home.getBoundingClientRect();
          cx = hr.left - wr.left + hr.width / 2; cy = hr.top - wr.top + hr.height / 2;
        }
        t.el.style.transform = 'translate(' + (cx - t.d / 2).toFixed(1) + 'px,' + (cy - t.d / 2).toFixed(1) + 'px)';
        t.el.classList.toggle('st-placed', !!t.zone);
        t.home.classList.toggle('st-empty', !!t.zone);
      });
    }
    hitZone(clientX, clientY) {
      const p = this.stage.toImg(clientX, clientY);
      return (this.cfg.zones || []).find((z) => inShape(p, z)) || null;
    }
    bindToken(t) {
      const el = t.el;
      el.addEventListener('pointerdown', (e) => {
        if (!this.enabled || this.solved || t.drag) return;
        const r = el.getBoundingClientRect(), wr = this.wrap.getBoundingClientRect();
        t.drag = { id: e.pointerId, offX: e.clientX - (r.left + r.width / 2), offY: e.clientY - (r.top + r.height / 2), startX: e.clientX, startY: e.clientY, moved: false, wr, hover: null, lift: 0 };
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        el.classList.add('st-lift');
        e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => {
        const g = t.drag; if (!g || e.pointerId !== g.id) return;
        if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 3) g.moved = true;
        if (g.moved) g.lift = Math.min(this.cfg.lift == null ? 36 : +this.cfg.lift, g.lift + 6);   // 拿起來時慢慢浮到手指上方
        const cx = e.clientX - g.offX, cy = e.clientY - g.offY - g.lift;
        el.style.transform = 'translate(' + (cx - g.wr.left - t.d / 2).toFixed(1) + 'px,' + (cy - g.wr.top - t.d / 2).toFixed(1) + 'px)';
        const z = this.hitZone(cx, cy);
        const id = z ? z.id : null;
        if (id !== g.hover) { if (g.hover && this.zoneEls[g.hover]) this.zoneEls[g.hover].classList.remove('st-hover'); if (id && this.zoneEls[id]) this.zoneEls[id].classList.add('st-hover'); g.hover = id; }
      });
      const end = (e, cancel) => {
        const g = t.drag; if (!g || e.pointerId !== g.id) return;
        t.drag = null;
        el.classList.remove('st-lift');
        if (g.hover && this.zoneEls[g.hover]) this.zoneEls[g.hover].classList.remove('st-hover');
        if (cancel || !g.moved) { this.layout(); return; }
        const cx = e.clientX - g.offX, cy = e.clientY - g.offY - g.lift;
        const z = this.hitZone(cx, cy);
        t.zone = z ? z.id : null;
        if (z && this.zoneEls[z.id]) { const sh = this.zoneEls[z.id]; sh.classList.add('st-hit'); setTimeout(() => sh.classList.remove('st-hit'), 1000); }
        el.classList.add('st-settle');
        this.layout();
        setTimeout(() => el.classList.remove('st-settle'), 260);
        this.save();
        if (typeof this.ctx.changed === 'function') this.ctx.changed();
      };
      el.addEventListener('pointerup', (e) => end(e, false));
      el.addEventListener('pointercancel', (e) => end(e, true));
      el.addEventListener('gesturestart', (e) => e.preventDefault());
    }
    save() { if (this.ctx.draft && this.ctx.draft.set) { const o = {}; this.tokens.forEach((t) => { o[t.cfg.id] = t.zone || ''; }); this.ctx.draft.set('drag', o); } }
    // ── handle 介面 ──
    value() { return this.tokens.map((t) => t.zone || '').join(','); }
    ready() { return this.cfg.requireAll ? this.tokens.every((t) => !!t.zone) : this.tokens.some((t) => !!t.zone); }
    setEnabled(on) { this.enabled = !!on; this.host.classList.toggle('st-off', !on); }
    onWrong() {
      if (typeof this.ctx.shake === 'function') this.ctx.shake(this.wrap);
      sleep(reduce(this.ctx) ? 0 : 240).then(() => {
        this.tokens.forEach((t) => { t.zone = null; t.el.classList.add('st-settle'); });
        this.layout();
        setTimeout(() => this.tokens.forEach((t) => t.el.classList.remove('st-settle')), 420);
        this.save();
        if (typeof this.ctx.changed === 'function') this.ctx.changed();
      });
    }
    onSolved() {
      this.solved = true; this.host.classList.add('st-solved');
      // 整顆棋子（圈和字）變印泥色：墨線的 background-color 是 setMask 寫在行內的，CSS 蓋不過，這裡直接改行內
      this.tokens.forEach((t) => { t.el.classList.add('st-solved'); t.el.querySelectorAll('.st-tok-body > .st-ink:not(.st-sil)').forEach((n) => { n.style.backgroundColor = 'var(--st-day-ink, var(--accent))'; }); });
    }
    /* 結果卡「你的答案」：zones 沒有 label 時回空字串（引擎就不顯示那一行），不給她看 p4／p2 這種代碼 */
    answerText() {
      if (!(this.cfg.zones || []).some((z) => z.label)) return '';
      return this.tokens.map((t) => { const z = t.zone ? this.zoneById(t.zone) : null; return (t.cfg.label || t.cfg.id) + '：' + (z ? (z.label || z.id) : '—'); }).join('　');
    }
    refresh() {
      if (this.stage.refreshArt()) this.layout();
      this.tokens.forEach((t) => {
        if (!t.a || !t.a.url) { const a = art(this.ctx, t.cfg.art); if (a && a.url) { t.a = a; inkFill(t.el.querySelector('.st-tok-body'), a, 'var(--ink)', true); } }
        if (!t.home.firstChild) { const ha = art(this.ctx, t.cfg.homeArt); if (ha && ha.url) setMask(mk('div', 'st-ink', t.home), ha.url, 'var(--ink-3)'); }
      });
    }
    destroy() { this.unwatch(); this.stage.destroy(); }
  }
  Kit.inputs.drag = { mount(host, cfg, ctx) { return new Drag(host, cfg, ctx); } };
})();

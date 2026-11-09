/* 告別之旅 App — 集章分頁引擎（stamps.js）
 * 只定義 window.FJStamps（對外介面見 stamps/impl/spec.md §8.1）和 window.FJStampsKit（元件註冊，§61-impl-run2 第 3 節）。
 * 載入順序：stamps-inputs.js、stamps-art.js、stamps.js、app.js。這支在載入時不碰 DOM，等 app.js 的 boot() 呼叫 init(api)。
 * 所有題目文字、答案、提示、印章名都在加密資料 data.stamps；這裡只有通用的元件邏輯和通用字。
 * 時間一律真實 JST；只有 localhost 吃模擬時鐘（?now=、測試面板、設定頁模擬）。
 */
(function () {
  'use strict';

  const Kit = window.FJStampsKit = window.FJStampsKit || { inputs: {}, figure: null };
  Kit.inputs = Kit.inputs || {};

  // ───────────────────────── 常數、小工具 ─────────────────────────
  const KEYS = { prog: 'fj.stamps', ctl: 'fj.stampsCtl', sim: 'fj.stampsSim', appSim: 'fj.sim' };
  const DOW = ['日', '一', '二', '三', '四', '五', '六'];
  const DEFAULT_WRONG = { waits: [0, 0, 30], repeat: 'cycle' };
  const DRAFT_THROTTLE = 300;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tmin = (t) => (t == null ? null : +String(t).slice(0, 2) * 60 + +String(t).slice(3, 5));
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtMin = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  const REDUCE = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const clsList = (c) => (c ? String(c).split(/\s+/).filter(Boolean) : []);
  const ALLOWED = /^(b|strong|br|small|span|ruby|rt|rp|u|sup|sub)$/i;
  // 內容檔的 html 只允許一小組標籤（編譯時已檢查）；這裡再過一次，不認得的標籤去掉
  function safeHtml(h) { return String(h == null ? '' : h).replace(/<\s*\/?\s*([a-zA-Z0-9]+)([^>]*)>/g, (m, t) => (ALLOWED.test(t) ? m.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '') : '')); }

  let api = null;          // app.js 給的介面
  let ST = null;           // data.stamps
  let C = null;            // ST.common
  let prog = null, ctl = null;
  let photosDone = false, photosState = 'none';
  let loadedAt = Date.now();
  let urlNow = null;       // ?now=（只在 localhost）
  let appSimBase = null, appSimAt = 0;
  let sheetState = null;   // 目前開著的 stamp sheet
  let secTimer = null;
  let lastTabSig = null, lastBadge = null;
  let testPanel = null;

  // ───────────────────────── 判定（spec §5.6，和 tools/stamps_hash.py 逐字對照） ─────────────────────────
  const VARIANTS = { '嚴': '厳', '廣': '広', '圓': '円', '寫': '写', '濱': '浜', '藏': '蔵', '龍': '竜', '櫻': '桜', '國': '国', '氣': '気', '澤': '沢', '瀧': '滝', '鐵': '鉄', '壽': '寿', '佛': '仏', '觀': '観', '舊': '旧', '彌': '弥', '燒': '焼', '會': '会', '體': '体', '驛': '駅', '縣': '県', '灣': '湾', '發': '発', '實': '実', '嶋': '島', '嶌': '島', '邊': '辺', '邉': '辺', '條': '条', '聲': '声', '黑': '黒', '歲': '歳', '號': '号', '靜': '静', '來': '来', '兩': '両', '萬': '万', '與': '与', '惠': '恵', '點': '点', '燈': '灯', '靈': '霊', '藝': '芸', '藥': '薬', '醫': '医', '轉': '転', '傳': '伝', '戰': '戦', '乘': '乗', '聽': '聴', '讀': '読', '續': '続', '豐': '豊' };
  const STRIP_FULL = /[\p{Z}\p{P}\p{S}\p{Cc}\p{Cf}]/gu;
  const STRIP_LIGHT = /[\p{Z}\p{Cc}\p{Cf}]/gu;
  const KANA = /[ァ-ヶ]/g;
  function normalize(s, mode = 'full') {
    s = s == null ? '' : String(s);
    if (mode === 'none') return s;
    if (mode === 'tc') { const i = s.lastIndexOf('@'); return i >= 0 ? normalize(s.slice(0, i), 'full') + '@' + s.slice(i + 1) : normalize(s, 'full'); }
    s = s.normalize('NFKC').toLowerCase().replace(KANA, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
    if (mode === 'full') return Array.from(s, (c) => VARIANTS[c] || c).join('').replace(STRIP_FULL, '');
    if (mode === 'light') return s.replace(STRIP_LIGHT, '');
    throw new Error('norm ' + mode);
  }
  async function sha(salt, v) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '\n' + v)); return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join(''); }
  const grams = (s, n) => { const a = Array.from(s), out = []; for (let i = 0; i + n <= a.length; i++) out.push(a.slice(i, i + n).join('')); return out; };
  const cpLen = (s) => Array.from(s).length;
  const KNUM = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  function kanjiRun(run) { if (!run.includes('十')) return run.length === 1 ? KNUM[run] : +Array.from(run, (c) => KNUM[c]).join(''); const i = run.indexOf('十'), a = run.slice(0, i), b = run.slice(i + 1); if (b.includes('十') || a.length > 1 || b.length > 1) return null; return (a ? KNUM[a] : 1) * 10 + (b ? KNUM[b] : 0); }
  function kanjiToDigits(s) { let ok = true; const out = s.replace(/[〇零一二三四五六七八九十]+/g, (m) => { const v = kanjiRun(m); if (v == null) { ok = false; return m; } return String(v); }); return ok ? out : null; }
  function parseValue(v, mode) {
    if (mode === 'int') { const s = kanjiToDigits(v); if (s == null || !/^\d{1,3}$/.test(s)) return null; return String(parseInt(s, 10)); }
    if (mode === 'clock12') {
      let s = v; for (const w of ['午後', '下午', 'ごご', '午前', '上午', 'ごぜん', 'afternoon', 'pm', 'am']) s = s.split(w).join('');
      s = s.split('半').join('30'); s = kanjiToDigits(s); if (s == null) return null;
      let m = /^(\d{1,2})(?:時|点|點|h|じ)(\d{1,2})?(?:分|ふん|ぷん)?(?:(\d{1,2})秒?)?$/.exec(s); if (!m) m = /^(\d{1,2})(\d{2})(\d{2})?$/.exec(s); if (!m) return null;
      let hh = +m[1]; const mm = +(m[2] || 0); if (mm > 59 || hh > 23) return null; if (hh < 12) hh += 12; return 'dial:' + ((hh - 12) * 60 + mm);
    }
    throw new Error('parse ' + mode);
  }
  function stripOnce(v, sufs) { for (const s of [...sufs].sort((a, b) => cpLen(b) - cpLen(a))) if (s && v.endsWith(s) && cpLen(v) > cpLen(s)) return v.slice(0, v.length - s.length); return null; }
  async function nearHit(r, salt, raw, atMin) {
    if (r.from && atMin < tmin(r.from)) return false;
    const v = normalize(raw, r.norm || 'full');
    if (r.match === 'exact') { const hs = new Set(r.h); if (hs.has(await sha(salt, v))) return true; if (r.strip) { const w = stripOnce(v, r.strip); return w != null && hs.has(await sha(salt, w)); } return false; }
    if (r.match === 'gram') { const hs = new Set(r.h); for (const n of r.lens) for (const g of grams(v, n)) if (hs.has(await sha(salt, g))) return true; return false; }
    if (r.match === 'affix') { if (!r.pre && !r.suf) return false; for (const side of ['pre', 'suf']) { const sp = r[side]; if (!sp) continue; const hs = new Set(sp.h), a = Array.from(v); let hit = false; for (const n of sp.lens) { if (a.length < n) continue; const c = side === 'pre' ? a.slice(0, n).join('') : a.slice(a.length - n).join(''); if (hs.has(await sha(salt, c))) { hit = true; break; } } if (!hit) return false; } return true; }
    if (r.match === 'len') return cpLen(v) < r.lt;
    if (r.match === 'head') { const it = v.split(','); if (it.length < r.n) return false; return new Set(r.h).has(await sha(salt, it.slice(0, r.n).join(','))); }
    throw new Error('near ' + r.match);
  }
  async function evaluate(check, raw, at = '23:59', parse = null) {
    const salt = check.salt, norm = check.norm || 'full', atMin = tmin(at);
    if (raw == null || String(raw).trim() === '') return { status: 'blank', msg: null, counts: false };
    if (parse) { const code = parseValue(normalize(raw, 'full'), parse); if (code == null) return { status: 'parsefail', msg: null, counts: false }; raw = code; }
    const v = normalize(raw, norm);
    if (new Set(check.ok || []).has(await sha(salt, v))) return { status: 'ok', msg: null, counts: false };
    const near = check.near || [];
    for (const r of near) if (r.match === 'exact' && await nearHit(r, salt, raw, atMin)) return { status: 'near', msg: r.msg, counts: !!r.counts };
    if (v === '') return { status: 'empty', msg: check.emptyMsg == null ? null : check.emptyMsg, counts: false };
    if (check.deny) { const hs = new Set(check.deny.h); for (const n of check.deny.lens) for (const g of grams(v, n)) if (hs.has(await sha(salt, g))) return { status: 'wrong', msg: null, counts: true }; }
    if (check.okGrams) { const hs = new Set(check.okGrams.h); for (const n of check.okGrams.lens) for (const g of grams(v, n)) if (hs.has(await sha(salt, g))) return { status: 'ok', msg: null, counts: false }; }
    for (const r of near) if (r.match !== 'exact' && await nearHit(r, salt, raw, atMin)) return { status: 'near', msg: r.msg, counts: !!r.counts };
    return { status: 'wrong', msg: null, counts: true };
  }
  function* perms(arr, k) { if (k === 0) { yield []; return; } for (let i = 0; i < arr.length; i++) { const rest = arr.slice(0, i).concat(arr.slice(i + 1)); for (const p of perms(rest, k - 1)) yield [arr[i], ...p]; } }
  async function evaluateParts(spec, values, at = '23:59') {
    const items = spec.items;
    if ((spec.match || 'all') === 'all') {
      const res = []; for (let i = 0; i < items.length; i++) res.push(await evaluate(items[i].check, values[i], at, items[i].parse || null));
      const each = res.map((r) => r.status);
      if (each.every((s) => s === 'ok')) return { status: 'ok', msg: null, counts: false, each };
      for (let i = 0; i < res.length; i++) if (res[i].status === 'near') return { status: 'near', msg: res[i].msg, counts: res[i].counts, each, item: i };
      for (let i = 0; i < res.length; i++) { const st = res[i].status; if (st === 'blank' || st === 'empty' || st === 'parsefail') return { status: st, msg: (st === 'blank' ? items[i].blankMsg : st === 'empty' ? res[i].msg : items[i].parseMsg) ?? null, counts: false, each, item: i }; }
      return { status: 'wrong', msg: null, counts: true, each };
    }
    const groups = spec.groups, n = items.length;
    const bi = values.findIndex((x, i) => i < n && (x == null || String(x).trim() === '')); if (bi >= 0) return { status: 'blank', msg: items[bi].blankMsg ?? null, counts: false, each: null, item: bi };
    const table = []; for (let i = 0; i < n; i++) { const row = []; for (const g of groups) row.push(await evaluate(g, values[i], at, items[i].parse || null)); table.push(row); }
    // 某一格只有符號（正規化後是空的）或數字看不懂：提醒、不算答錯（spec §2.7；和 match=all 一致）
    for (let i = 0; i < n; i++) { for (const st of ['empty', 'parsefail']) if (table[i].every((r) => r.status === st)) return { status: st, msg: (st === 'empty' ? table[i][0].msg : items[i].parseMsg) ?? null, counts: false, each: null, item: i }; }
    let best = null;
    for (const p of perms([...Array(groups.length).keys()], n)) { const rs = p.map((g, i) => table[i][g]); const sc = [rs.filter((r) => r.status === 'ok').length, rs.filter((r) => r.status === 'near').length]; if (!best || sc[0] > best.sc[0] || (sc[0] === best.sc[0] && sc[1] > best.sc[1])) best = { sc, rs }; }
    if (best.sc[0] === n) return { status: 'ok', msg: null, counts: false, each: Array(n).fill('ok') };
    if (best.sc[0] + best.sc[1] === n) { const r = best.rs.find((x) => x.status === 'near'); return { status: 'near', msg: r.msg, counts: r.counts, each: best.rs.map((x) => x.status) }; }
    return { status: 'wrong', msg: null, counts: true, each: best.rs.map((x) => x.status) };
  }

  // ───────────────────────── 儲存 ─────────────────────────
  function loadStore() {
    prog = api.store.get(KEYS.prog, null);
    if (!prog || typeof prog !== 'object' || !prog.days) prog = { v: 1, rulesSeen: false, bonus: { pressed: false, seen: false }, days: {} };
    if (!prog.bonus) prog.bonus = { pressed: false, seen: false };
    ctl = api.store.get(KEYS.ctl, null);
    if (!ctl || typeof ctl !== 'object') ctl = { variant: {}, allowLate: {}, flags: {} };
    ctl.variant = ctl.variant || {}; ctl.allowLate = ctl.allowLate || {}; ctl.flags = ctl.flags || {};
  }
  const saveProg = () => api.store.set(KEYS.prog, prog);
  const saveCtl = () => api.store.set(KEYS.ctl, ctl);
  function dayRec(d, create) {
    let r = prog.days[d];
    if (!r && create) { r = prog.days[d] = { seen: '', answerViewed: false, pressed: false, stamp: null, v: {} }; }
    return r || null;
  }
  function vRec(d, v, create) {
    const dr = dayRec(d, create); if (!dr) return null;
    let r = dr.v[v];
    if (!r && create) { r = dr.v[v] = { wrong: 0, lockUntil: 0, stages: {} }; }
    return r || null;
  }
  function sRec(d, v, sid, create) {
    const vr = vRec(d, v, create); if (!vr) return null;
    let r = vr.stages[sid];
    if (!r && create) { r = vr.stages[sid] = { solved: 0, wrong: 0, lockUntil: 0, near: 0, hints: 0, input: 0, draft: {}, answer: '', parts: {} }; }
    return r || null;
  }
  // 段落紀錄：一般從 prog 讀；試玩（env.preview）只放在記憶體，關掉就沒了
  function stageRec(env, sid, create) {
    if (!env.preview) return sRec(env.d, env.v, sid, create);
    if (!env.pv[sid] && create) env.pv[sid] = { solved: 0, wrong: 0, lockUntil: 0, near: 0, hints: 0, input: 0, draft: {}, answer: '', parts: {} };
    return env.pv[sid] || null;
  }
  function pRec(sr, i) { let r = sr.parts[i]; if (!r) r = sr.parts[i] = { solved: 0, wrong: 0, lockUntil: 0, answer: '' }; return r; }

  // ───────────────────────── 時鐘（spec §2.1） ─────────────────────────
  const jstMs = (iso) => Date.parse(String(iso).length <= 16 ? iso + ':00+09:00' : iso + '+09:00');
  function jstOf(ms) {
    const o = api.jstParts(new Date(ms));
    return { date: `${o.year}-${o.month}-${o.day}`, hhmm: `${o.hour}:${o.minute}`, min: +o.hour * 60 + +o.minute, sec: +o.second };
  }
  function simInfo() {
    if (!api.IS_LOCAL) return null;
    const s = api.store.get(KEYS.sim, null);
    if (s && s.base && s.setAt) { const b = jstMs(s.base); if (!Number.isNaN(b)) return { base: b, setAt: s.setAt, src: 'panel' }; }
    if (urlNow) return { base: urlNow, setAt: loadedAt, src: 'url' };
    const a = api.store.get(KEYS.appSim, null);
    if (a) { if (a !== appSimBase) { appSimBase = a; appSimAt = Date.now(); } const b = jstMs(a); if (!Number.isNaN(b)) return { base: b, setAt: appSimAt, src: 'app' }; }
    return null;
  }
  function stNow() { const s = simInfo(); return s ? s.base + (Date.now() - s.setAt) : Date.now(); }
  const isSim = () => !!simInfo();
  function setSim(iso) {   // 測試面板：iso 'YYYY-MM-DDTHH:MM[:SS]'；null＝關掉
    if (!api.IS_LOCAL) return;
    if (iso) api.store.set(KEYS.sim, { base: iso, setAt: Date.now() }); else api.store.del(KEYS.sim);
    afterTimeChange();
  }
  function afterTimeChange() { lastTabSig = null; try { api.render(false); } catch (e) { /* ignore */ } api.syncTabs(); refreshSheet(true); }
  function simIso() {      // 給 app.js 的 simValue()：有模擬時回會走的 "YYYY-MM-DDTHH:MM"
    const s = simInfo(); if (!s || s.src === 'app') return null;
    const j = jstOf(stNow()); return `${j.date}T${j.hhmm}`;
  }

  // ───────────────────────── 一天的狀態（spec §2.2–2.4） ─────────────────────────
  const DAYS = () => (C ? C.days : []);
  const dayInfo = (d) => DAYS().find((x) => x.day === d) || null;
  const dateOf = (d) => `2026-${d.slice(0, 2)}-${d.slice(2)}`;
  const openMs = (d) => jstMs(dateOf(d) + 'T09:00');
  const closeMs = (d) => openMs(d) + 15 * 3600e3;
  const lateUntilMs = () => jstMs(C.lateUntil);
  const dayData = (d) => (ST && ST.days[d]) || null;
  const dowOf = (d) => { const i = dayInfo(d); return i ? i.dow : DOW[new Date(openMs(d)).getUTCDay()]; };
  const fmtMD = (d, dow = true) => `${+d.slice(0, 2)}/${+d.slice(2)}${dow ? `（${dowOf(d)}）` : ''}`;
  function variantName(d) {
    const dr = dayRec(d); if (dr && dr.stamp && dr.stamp.variant) return dr.stamp.variant;
    const dd = dayData(d); return ctl.variant[d] || (dd && dd.use) || 'main';
  }
  const variantData = (d, v) => { const dd = dayData(d); return dd ? dd.variants[v || variantName(d)] || null : null; };
  function dayState(d, now) {
    now = now == null ? stNow() : now;
    const dr = dayRec(d);
    if (dr && dr.stamp) return 'stamped';
    if (now < openMs(d)) return 'future';
    if (now < closeMs(d)) return 'open';
    if (ctl.allowLate[d] && now < lateUntilMs() && !(dr && dr.answerViewed)) return 'late';
    return 'missed';
  }
  const todayKey = () => { const j = jstOf(stNow()); const m = /^2026-12-(\d\d)$/.exec(j.date); return m ? '12' + m[1] : null; };
  const isToday = (d) => jstOf(stNow()).date === dateOf(d);
  // 「當天的鐘」：今天→現在；過去（延長、錯過、回看）→ 23:59；預覽→ 23:59
  function clockOf(d, preview) {
    if (preview) return '23:59';
    const now = stNow();
    if (now >= closeMs(d)) return '23:59';
    const j = jstOf(now);
    if (j.date === dateOf(d)) return j.hhmm;
    return now < openMs(d) ? '00:00' : '23:59';
  }
  const tabVisible = () => !!(ST && C && stNow() >= jstMs(C.openAt));
  const stampedCount = () => DAYS().filter((x) => dayState(x.day) === 'stamped').length;
  function bonusVisible() {
    if (!C) return false;
    if (stNow() < jstMs(C.bonus.at)) return false;
    return DAYS().every((x) => { const s = dayState(x.day); return s === 'stamped' || s === 'missed'; });
  }

  // ───────────────────────── 條件（spec §4.12）、段落 ─────────────────────────
  function makeEnv(d, v, preview) {
    const vd = variantData(d, v);
    const env = { d, v, vd, preview: !!preview, clock: clockOf(d, preview), pv: {} };
    env.solved = (sid) => { const r = stageRec(env, sid); return !!(r && r.solved); };
    env.missed = !preview && dayState(d) === 'missed';
    env.flags = ctl.flags[d] || [];
    env.finalSolvedAt = () => { const stages = vd ? vd.stages : []; const last = stages[stages.length - 1]; const r = last ? stageRec(env, last.id) : null; const dr = preview ? null : dayRec(d); return (dr && dr.stamp && dr.stamp.at) || (r && r.solved) || 0; };
    return env;
  }
  function cond(when, env) {
    if (!when) return true;
    for (const k of Object.keys(when)) {
      const val = when[k];
      if (k === 'flag') { if (!env.flags.includes(val)) return false; }
      else if (k === 'notFlag') { if (env.flags.includes(val)) return false; }
      else if (k === 'solved') { if (!env.solved(val)) return false; }
      else if (k === 'notSolved') { if (env.solved(val)) return false; }
      else if (k === 'solvedBefore' || k === 'solvedFrom') {
        const at = env.finalSolvedAt(); let before = false;
        if (at) { const j = jstOf(at); before = j.date === dateOf(env.d) && j.min < tmin(val); }
        if (k === 'solvedBefore' ? !before : before) return false;
      } else if (k === 'variantOf') { for (const dd of Object.keys(val)) if (variantName(dd) !== val[dd]) return false; }
      else if (k === 'missed') { if (!!val !== !!env.missed) return false; }
    }
    return true;
  }
  const timeOk = (b, clock) => (!b.at || tmin(clock) >= tmin(b.at)) && (!b.until || tmin(clock) < tmin(b.until));
  function stageVisible(s, env) { return (!s.after || env.solved(s.after)) && (!s.showAt || tmin(env.clock) >= tmin(s.showAt)); }
  function titleOf(vd, clock) {
    let t = vd.title;
    (vd.titleAt || []).forEach((x) => { if (tmin(clock) >= tmin(x.at)) t = x.title; });
    return t;
  }
  function latestPing(d) {
    const vd = variantData(d); if (!vd) return '09:00';
    const clock = clockOf(d); let best = '09:00';
    (vd.pings || []).forEach((p) => { if (tmin(p) <= tmin(clock) && tmin(p) > tmin(best)) best = p; });
    return best;
  }
  function badge() {
    if (!tabVisible()) return false;
    const t = todayKey();
    if (t && dayData(t) && dayState(t) === 'open') { const dr = dayRec(t); const seen = dr ? dr.seen || '' : ''; if (tmin(latestPing(t)) > (seen ? tmin(seen) : -1)) return true; }
    if (bonusVisible() && !prog.bonus.seen) return true;
    return false;
  }
  function markSeen(d) { const dr = dayRec(d, true); const lp = latestPing(d); if (dr.seen !== lp) { dr.seen = lp; saveProg(); api.syncTabs(); } }

  // ───────────────────────── 素材 ─────────────────────────
  const assetId = (ref) => 'st-a-' + String(ref).replace('#', '_');
  function assetSize(id) { const a = ST && ST.assets && ST.assets[id]; return a ? { w: a[0], h: a[1] } : null; }
  function artInfo(ref, vd) {
    if (!ref) return null;
    const base = String(ref).split('#')[0];
    if (vd && (vd.missingArt || []).includes(base)) return null;
    const id = assetId(ref); const sz = assetSize(id); if (!sz) return null;
    const silId = id + '_sil', sil = ST.assets[silId] ? (api.photoUrl(silId) || null) : null;
    return { id, url: api.photoUrl(id) || null, w: sz.w, h: sz.h, ratio: sz.w / sz.h, sil };
  }
  function maskEl(e, id, ink) {
    const sz = assetSize(id), u = api.photoUrl(id);
    e.classList.add('st-mask');
    if (sz) e.style.aspectRatio = `${sz.w} / ${sz.h}`;
    if (u) { e.style.webkitMaskImage = `url("${u}")`; e.style.maskImage = `url("${u}")`; e.style.backgroundColor = ink || 'var(--ink)'; e.classList.remove('st-noimg'); }
    else { e.style.webkitMaskImage = ''; e.style.maskImage = ''; e.style.backgroundColor = 'transparent'; e.classList.add('st-noimg'); }
    e.dataset.stAsset = id;
    return e;
  }
  const maskHtml = (id, ink, cls, extraStyle) => {
    const sz = assetSize(id), u = api.photoUrl(id);
    // 注意：這段會放進 style="…" 屬性裡，url 裡面只能用單引號
    const st = [sz ? `aspect-ratio:${sz.w} / ${sz.h}` : '', u ? `-webkit-mask-image:url('${u}');mask-image:url('${u}');background-color:${ink || 'var(--ink)'}` : 'background-color:transparent', extraStyle || ''].filter(Boolean).join(';');
    return `<span class="st-mask${u ? '' : ' st-noimg'}${cls ? ' ' + cls : ''}" data-st-asset="${esc(id)}" style="${st}"></span>`;
  };
  const inkOf = (name) => (C.inks[name] || C.inks.sumi).light;
  const dayInk = (d) => inkOf((dayInfo(d) || {}).ink || 'sumi');
  const loadingNote = () => (photosDone ? '' : `<p class="st-loading muted">${esc(C.card.loading)}</p>`);
  // 旅人規則（2026-11-08）：這個 App 不放任何音效。沒有 audio()、沒有 sound 區塊。

  // ───────────────────────── 動畫（WAAPI，照 app.js 的寫法） ─────────────────────────
  function anim(target, kf, opts) {
    if (!target || REDUCE() || !target.animate) return Promise.resolve();
    const a = target.animate(kf, opts);
    const p = a.finished.catch(() => {});
    setTimeout(() => { if (a.playState !== 'finished') { try { a.finish(); } catch (e) { /* ignore */ } } }, (opts.duration || 0) + (opts.delay || 0) + 400);
    return p;
  }
  const shake = (e) => anim(e, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 220, easing: 'ease-out' });
  const slideDown = (e) => anim(e, [{ transform: 'translateY(-14px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  // 蓋章（card-preview.html 的 press()）：章從上方落下、壓住、抬起；紙輕輕一震
  function press(img, paper) {
    if (!img) return Promise.resolve();
    const p = anim(img, [
      { transform: 'translateY(-26px) scale(1.28) rotate(-3deg)', opacity: 0, filter: 'blur(2px)' },
      { transform: 'translateY(0) scale(.96) rotate(0)', opacity: .9, filter: 'blur(0)', offset: .55 },
      { transform: 'scale(1.01)', opacity: 1, offset: .75 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 620, easing: 'cubic-bezier(.3,.7,.2,1)' });
    if (paper) anim(paper, [{ transform: 'translateY(0)' }, { transform: 'translateY(1.5px)', offset: .5 }, { transform: 'translateY(0)' }], { duration: 180, delay: 330 });
    return p;
  }

  // ───────────────────────── 元件 ctx ─────────────────────────
  function makeCtx(env, stageId, draftGet, draftSet, hooks) {
    const vd = env.vd;
    return {
      day: env.d, variant: env.v, stageId, preview: env.preview,
      clock: () => clockOf(env.d, env.preview),
      isAfter: (hhmm) => tmin(clockOf(env.d, env.preview)) >= tmin(hhmm),
      cond: (when) => cond(when, env),
      draft: { get: draftGet, set: draftSet },
      changed: () => hooks.changed && hooks.changed(),
      submit: () => hooks.submit && hooks.submit(),
      msg: (t) => hooks.msg && hooks.msg(t),
      art: (ref) => artInfo(ref, vd),
      mask: (e, ref, ink) => { const a = artInfo(ref, vd); if (a) maskEl(e, a.id, ink); else { e.classList.add('st-mask', 'st-noimg'); } return e; },
      esc, reduce: REDUCE, shake, toast: (m) => api.toast(m),
    };
  }

  // 元件還沒交時的備援（只有文字框；其他種類顯示提示）—— 正式版由 stamps-inputs.js、stamps-art.js 提供
  const Fallback = {
    text: { mount(host, cfg, ctx) {
      const inp = el('input', 'st-text'); inp.type = 'text'; inp.placeholder = cfg.placeholder || ''; inp.maxLength = cfg.maxlength || 60;
      inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('autocorrect', 'off'); inp.spellcheck = false; inp.enterKeyHint = 'done'; if (cfg.lang) inp.lang = cfg.lang;
      inp.value = ctx.draft.get('text', '') || '';
      inp.addEventListener('input', () => { ctx.draft.set('text', inp.value); ctx.changed(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ctx.submit(); } });
      host.appendChild(inp);
      return { value: () => inp.value, ready: () => true, setEnabled: (b) => { inp.disabled = !b; }, onWrong() { shake(host); if (cfg.clearOnWrong) { inp.value = ''; ctx.draft.set('text', ''); } }, onSolved() {}, answerText: () => inp.value, refresh() {}, destroy() {} };
    } },
    other(kind) { return { mount(host, cfg, ctx) { host.innerHTML = `<p class="st-fallback muted">（${esc(kind)} 元件尚未載入）</p>`; const t = Fallback.text.mount(host, Object.assign({ placeholder: '' }, cfg.placeholder ? { placeholder: cfg.placeholder } : {}), ctx); return t; } }; },
  };
  const inputKit = (kind) => Kit.inputs[kind] || (kind === 'text' ? Fallback.text : Fallback.other(kind));
  const FigureFallback = { mount(host, cfg, ctx) {
    const a = ctx.art(cfg.art);
    const box = el('div', 'st-fig-fallback');
    if (a) { const m = maskEl(el('div'), a.id); box.appendChild(m); } else box.innerHTML = `<p class="muted">（${esc(cfg.alt || '圖')}）</p>`;
    host.appendChild(box);
    return { refresh() {}, solvedAnim: () => Promise.resolve(), flash: () => Promise.resolve(), destroy() {} };
  } };
  const figureKit = () => Kit.figure || FigureFallback;

  // ───────────────────────── 區塊（spec §4.8） ─────────────────────────
  // 回傳 { frag, mounts:[handle…] }；opts.pauseFn：遇到 pause 時後面的區塊先藏起來
  function renderBlocks(blocks, env, ctx, opts = {}) {
    const frag = document.createDocumentFragment(); const mounts = [];
    let afterPause = null;
    (blocks || []).forEach((b) => {
      if (!b || !timeOk(b, env.clock) || !cond(b.when, env)) return;
      const node = blockNode(b, env, ctx, mounts, opts);
      if (!node) return;
      if (afterPause) afterPause.appendChild(node); else frag.appendChild(node);
      if (b.type === 'pause' && !opts.noPause) {
        const wrap = el('div', 'st-after-pause'); wrap.hidden = true; frag.appendChild(wrap); afterPause = wrap;
        node.addEventListener('click', () => { node.remove(); wrap.hidden = false; slideDown(wrap); });
      }
    });
    return { frag, mounts };
  }
  function blockNode(b, env, ctx, mounts, opts) {
    const extra = clsList(b.cls).map((c) => 'st-' + c).join(' ');
    const lang = b.lang ? ` lang="${esc(b.lang)}"` : '';
    switch (b.type) {
      case 'p': { const p = el('p', 'st-p ' + extra, safeHtml(b.html)); if (b.lang) p.lang = b.lang; return p; }
      case 'h': return el('h4', 'st-h ' + extra, safeHtml(b.text || b.html));
      case 'note': return el('div', 'st-note ' + extra, safeHtml(b.html));
      case 'quote': { const q = el('blockquote', 'st-quote ' + extra, safeHtml(b.html)); if (b.lang) q.lang = b.lang; return q; }
      case 'list': return el('ul', 'st-list ' + extra, (b.items || []).map((x) => `<li${lang}>${safeHtml(x)}</li>`).join(''));
      case 'pending': return el('div', 'st-pending ' + extra, esc(b.text));
      case 'pause': { const btn = el('button', 'btn ghost st-pause', esc(b.label || '…')); btn.type = 'button'; return btn; }
      case 'fold': {
        const d = el('details', 'st-fold ' + extra); d.innerHTML = `<summary>${esc(b.label || '')}</summary>`;
        const body = el('div', 'st-fold-body'); const r = renderBlocks(b.blocks, env, ctx, opts); body.appendChild(r.frag); mounts.push(...r.mounts); d.appendChild(body);
        return d;
      }
      case 'figure': {
        const host = el('div', 'st-figure ' + extra); if (b.width && b.width < 1) host.style.width = Math.round(b.width * 100) + '%';
        host.setAttribute('role', 'img'); if (b.alt) host.setAttribute('aria-label', b.alt);
        try { mounts.push(figureKit().mount(host, b, ctx)); } catch (e) { console.error('[stamps] figure', e); host.innerHTML = `<p class="muted">（${esc(b.alt || '圖')}）</p>`; }
        return host;
      }
      default: return null;   // 不認得的類型（含舊的 sound）不顯示
    }
  }

  // ───────────────────────── 送出鈕狀態、冷卻、提示 ─────────────────────────
  function waitAfter(k, cfg) {   // 第 k 次答錯後等幾秒
    const w = (cfg && cfg.waits) || DEFAULT_WRONG.waits, rep = (cfg && cfg.repeat) || 'last';
    if (!w.length) return 0;
    if (k <= w.length) return w[k - 1] || 0;
    return rep === 'cycle' ? (w[(k - 1) % w.length] || 0) : (w[w.length - 1] || 0);
  }
  const lockLabel = (ms) => { const left = Math.ceil((ms - stNow()) / 1000); return left < 60 ? `${left} 秒後可以再試` : `${jstOf(ms).hhmm} 後可以再試`; };

  // ───────────────────────── 任務頁 ─────────────────────────
  // sheetState = { entry, root(.sheet-scroll), env, stages:[stageUI], sig, timer }
  // stageUI = { s, sr, host, inputIdx, handle, kind, parts:[{item, handle, btn, note, reply}], btn, note, reply, hintBtn, hintList, mounts }
  function sheetHtml(entry) {
    const title = entry.view === 'admin' ? '設定（旅人）' : entry.view === 'cardPreview' ? '卡片（試看）' : entry.view === 'bonus' ? '' : (entry.day ? fmtMD(entry.day) : '');
    return `<header class="sheet-bar"><button class="sheet-back" type="button">‹ 返回</button><span class="sheet-bar-title">${esc(title)}</span></header><div class="sheet-scroll st-sheet" data-st-view="${esc(entry.view || 'task')}"></div>`;
  }
  function sheetMounted(elSheet, entry) {
    sheetUnmounted();
    const root = $('.st-sheet', elSheet); if (!root) return;
    sheetState = { entry, root, stages: [], sig: null, mounts: [] };
    if (entry.view === 'admin') renderAdmin(root);
    else if (entry.view === 'cardPreview') renderCardPreview(root);
    else if (entry.view === 'bonus') renderBonusSheet(root);
    else renderDaySheet(root, entry);
    if (entry.view !== 'admin') secTimer = setInterval(() => refreshSheet(false), 1000);
  }
  function sheetUnmounted() {
    if (secTimer) { clearInterval(secTimer); secTimer = null; }
    if (sheetState) { destroyStages(); sheetState = null; }
    // 回到卡片：卡片若過期（剛蓋章、換日）就重畫，蓋章動畫在這時播。
    // 等 sheet 滑出去（app.js 220 ms）再重畫，動畫才不會在 sheet 後面先播掉一半
    const redraw = () => { try { if (api && ST && api.getUi().tab === 'stamps' && $('#view') && tabSig() !== lastTabSig) renderTab($('#view')); } catch (e) { /* ignore */ } };
    if (REDUCE()) redraw(); else setTimeout(redraw, 260);
  }
  function destroyStages() {
    if (!sheetState) return;
    sheetState.stages.forEach((u) => { (u.mounts || []).forEach((m) => { try { m.destroy && m.destroy(); } catch (e) { /* ignore */ } }); try { u.handle && u.handle.destroy && u.handle.destroy(); } catch (e) { /* ignore */ } (u.parts || []).forEach((p) => { try { p.handle.destroy && p.handle.destroy(); } catch (e) { /* ignore */ } }); });
    (sheetState.mounts || []).forEach((m) => { try { m.destroy && m.destroy(); } catch (e) { /* ignore */ } });
    sheetState.stages = []; sheetState.mounts = [];
  }
  function renderDaySheet(root, entry) {
    const d = entry.day, preview = !!entry.preview;
    const v = entry.variant || variantName(d);
    const env = makeEnv(d, v, preview);
    sheetState.env = env;
    if (!env.vd) { root.innerHTML = '<p class="empty">這一天沒有內容。</p>'; return; }
    const state = preview ? 'open' : dayState(d);
    if (!preview && (state === 'open' || state === 'late')) markSeen(d);   // 9:00 前、錯過、蓋章都不記 seen（9:00 前記了會吃掉 9:00 的紅點）
    if (!preview && state === 'missed') { const dr = dayRec(d, true); if (!dr.answerViewed) { dr.answerViewed = true; saveProg(); api.syncTabs(); } renderAnswerPage(root, env); return; }
    if (!preview && state === 'stamped') { renderResult(root, env, false); return; }
    if (!preview && state === 'future') { root.innerHTML = `<p class="empty">${esc(fmtMD(d, false))} 09:00 開放。</p>`; return; }
    renderTask(root, env, state);
  }
  function renderTask(root, env, state) {
    const { d, vd, preview } = env;
    root.innerHTML = '';
    // 元件（drag 答對的棋子等）用當天的墨色：淺、深兩色都給，--st-day-ink 由 stamps.css 依模式挑（寫在行內的話深色模式蓋不掉）
    const inkPair = C.inks[(dayInfo(d) || {}).ink || 'sumi'] || C.inks.sumi;
    root.style.setProperty('--st-day-ink-light', inkPair.light); root.style.setProperty('--st-day-ink-dark', inkPair.dark || inkPair.light);
    if (preview) root.appendChild(el('p', 'st-preview-tag', '試玩：時刻都當成已到。會判定，也可以蓋章看結果；不留任何紀錄，關掉就沒了。'));
    root.appendChild(el('p', 'st-topline muted', esc(C.topLine)));
    if (!prog.rulesSeen && !preview) root.appendChild(rulesCard());
    root.insertAdjacentHTML('beforeend', loadingNote());
    root.appendChild(el('h2', 'sheet-title st-title', esc(titleOf(vd, env.clock))));
    if (state === 'late') root.appendChild(el('p', 'st-late-note muted', esc(C.card.lateNote)));
    const list = el('div', 'st-stages'); root.appendChild(list);
    buildStages(list, env);
    if (preview) {   // 試玩：答案和揭曉收在最下面，要看再打開
      const pd = el('details', 'st-more st-preview-more'); pd.innerHTML = '<summary>看答案和揭曉</summary>';
      const rv = el('section', 'st-reveal st-preview-reveal'); rv.innerHTML = `<p class="st-answer-line"><span class="st-k">${esc(C.card.answer)}</span>${esc(vd.reveal.answer)}</p>`;
      const r = renderBlocks(vd.reveal.blocks, env, makeCtx(env, 'reveal', () => null, () => {}, {}), { noPause: true }); rv.appendChild(r.frag); sheetState.mounts.push(...r.mounts);
      if (vd.reveal.more) { const dm = el('details', 'st-more'); dm.innerHTML = `<summary>${esc(vd.reveal.more.label || '再多一點')}</summary>`; const rr = renderBlocks(vd.reveal.more.blocks, env, makeCtx(env, 'reveal', () => null, () => {}, {}), { noPause: true }); dm.appendChild(rr.frag); sheetState.mounts.push(...rr.mounts); rv.appendChild(dm); }
      pd.appendChild(rv); root.appendChild(pd);
    }
    sheetState.sig = taskSig(env);
  }
  function taskSig(env) {
    const vd = env.vd; const parts = [env.clock >= '23:59' ? 'past' : '', titleOf(vd, env.clock)];
    vd.stages.forEach((s) => {
      const sr = stageRec(env, s.id);
      const vis = stageVisible(s, env);
      parts.push(`${s.id}:${vis ? 1 : 0}:${sr && sr.solved ? 1 : 0}:${sr ? sr.input || 0 : 0}`);
      if (vis && !(sr && sr.solved)) {
        parts.push(s.inputAt && tmin(env.clock) < tmin(s.inputAt) ? 'in0' : 'in1', s.answerAt && tmin(env.clock) < tmin(s.answerAt) ? 'an0' : 'an1');
        (s.blocks || []).forEach((b, i) => { parts.push(timeOk(b, env.clock) && cond(b.when, env) ? i : '-'); });
        parts.push((s.hints || []).map((h) => (cond(h.when, env) ? 1 : 0)).join(''), s.hintsAutoAt && tmin(env.clock) >= tmin(s.hintsAutoAt) ? 'auto' : '');
        parts.push((s.footNoteUntil && tmin(env.clock) >= tmin(s.footNoteUntil)) ? 'fn0' : 'fn1');
      }
    });
    return parts.join('|');
  }
  function buildStages(list, env, animateNew) {
    const vd = env.vd;
    let order = vd.stages.slice();
    const firstHidden = vd.stages.find((s) => !stageVisible(s, env));
    const nodes = [];
    vd.stages.forEach((s) => {
      if (!stageVisible(s, env)) {
        if (s === firstHidden && s.pending) {
          const text = (s.after && !env.solved(s.after)) ? s.pending.locked : s.pending.waiting;
          if (text) nodes.push({ s, node: el('div', 'st-pending st-stage-pending', esc(text)) });
        }
        return;
      }
      const sr = stageRec(env, s.id);
      if (sr && sr.solved && s !== vd.stages[vd.stages.length - 1]) nodes.push({ s, node: solvedStageNode(s, sr, env) });
      else { const ui = buildStageUI(s, env); sheetState.stages.push(ui); nodes.push({ s, node: ui.host, ui }); }
    });
    if (vd.stageOrder === 'up') nodes.reverse();
    nodes.forEach((n) => { list.appendChild(n.node); if (animateNew && n.ui && !n.ui.wasVisible) slideDown(n.node); });
    sheetState.stages.forEach((u) => { syncStage(u); });
  }
  function solvedStageNode(s, sr, env) {
    const sec = el('section', 'st-stage st-solved'); sec.dataset.stStage = s.id;
    if (s.label) sec.appendChild(el('h3', 'st-stage-label', esc(s.label)));
    sec.appendChild(el('p', 'st-solved-line', `<span class="st-check" aria-hidden="true">✓</span><span class="st-solved-answer">${esc(sr.answer || '')}</span>`));
    if (s.solvedText) sec.appendChild(el('p', 'st-solved-text muted', safeHtml(s.solvedText)));
    return sec;
  }
  function buildStageUI(s, env) {
    const { preview } = env;
    const sr = stageRec(env, s.id, true);
    const host = el('section', 'st-stage'); host.dataset.stStage = s.id;
    const ui = { s, sr, host, env, parts: [], mounts: [], wasVisible: false, busy: false };
    if (s.label) host.appendChild(el('h3', 'st-stage-label', esc(s.label)));
    // 區塊
    const draftGet = (k, f) => (sr.draft && k in sr.draft ? sr.draft[k] : f);
    const draftSet = (k, val) => { sr.draft[k] = val; scheduleSave(); };
    const ctx = makeCtx(env, s.id, draftGet, draftSet, { changed: () => { replyFade(ui, null); syncStage(ui); }, submit: () => submitStage(ui), msg: (t) => setReply(ui, t) });
    ui.ctx = ctx;
    const r = renderBlocks(s.blocks, env, ctx); host.appendChild(el('div', 'st-blocks')).appendChild(r.frag); ui.mounts = r.mounts;
    // 輸入方式
    const inputs = s.inputs || [];
    if (inputs.length) {
      ui.inputIdx = Math.min(sr.input || 0, inputs.length - 1);
      const wrap = el('div', 'st-input'); host.appendChild(wrap); ui.inputWrap = wrap;
      mountInput(ui);
    }
    // 提示
    const hints = (s.hints || []).filter((h) => cond(h.when, env));
    if (hints.length) {
      const hs = el('div', 'st-hints');
      ui.hintNote = el('p', 'st-hint-auto muted'); ui.hintNote.hidden = true; hs.appendChild(ui.hintNote);
      ui.hintList = el('ol', 'st-hint-list'); hs.appendChild(ui.hintList);
      ui.hintBtn = el('button', 'btn ghost st-hint-btn'); ui.hintBtn.type = 'button'; hs.appendChild(ui.hintBtn);
      ui.hintBtn.addEventListener('click', () => showHint(ui));
      ui.hints = hints; host.appendChild(hs);
    }
    if (preview) {   // 試玩：不用答也能往下看
      const isLast = s === env.vd.stages[env.vd.stages.length - 1];
      const sk = el('button', 'btn ghost st-preview-skip', isLast ? '直接蓋章（試玩）' : '跳過這段（試玩）'); sk.type = 'button';
      sk.addEventListener('click', () => { if (!ui.busy) stageSolved(ui); }); host.appendChild(sk);
    }
    return ui;
  }
  function scheduleSave() { if (sheetState && sheetState.env && sheetState.env.preview) return; clearTimeout(scheduleSave.t); scheduleSave.t = setTimeout(saveProg, DRAFT_THROTTLE); }

  function mountInput(ui) {
    const { s, sr, env } = ui;
    const cfg = s.inputs[ui.inputIdx];
    const wrap = ui.inputWrap; wrap.innerHTML = '';
    ui.parts = []; ui.handle = null; ui.cfg = cfg;
    const draftGet = (k, f) => (k in sr.draft ? sr.draft[k] : f), draftSet = (k, val) => { sr.draft[k] = val; scheduleSave(); };
    // 標題：parts 的整組標題由引擎畫；單一輸入方式的 label 元件自己會畫（.st-in-label），元件沒畫才由引擎補（見下）
    if (cfg.kind === 'parts' && cfg.label) wrap.appendChild(el('div', 'st-input-label', esc(cfg.label)));
    if (cfg.kind === 'parts') {
      cfg.items.forEach((item0, i) => {
        // parts 層的 clearOnWrong 帶給沒自己寫的子項目（答錯後各格一起清空）
        const item = (cfg.clearOnWrong != null && item0.clearOnWrong == null) ? Object.assign({}, item0, { clearOnWrong: cfg.clearOnWrong }) : item0;
        const pr = pRec(sr, i);
        const row = el('div', 'st-part'); row.dataset.stPart = i;
        const head = el('div', 'st-part-head'); row.appendChild(head);
        const phost = el('div', 'st-part-host'); row.appendChild(phost);
        const pctx = makeCtx(env, s.id, (k, f) => draftGet(`p${i}:${k}`, f), (k, val) => draftSet(`p${i}:${k}`, val), { changed: () => { replyFade(ui, cfg.separate ? i : null); syncStage(ui); }, submit: () => submitStage(ui, cfg.separate ? i : null), msg: (t) => setReply(ui, t, cfg.separate ? i : null) });
        const kit = inputKit(item.kind);
        let handle; try { handle = kit.mount(phost, item, pctx); } catch (e) { console.error('[stamps] input', item.kind, e); handle = Fallback.text.mount(phost, item, pctx); }
        // 標題列：元件自己已把小圖畫在輸入框旁（text 的 .st-in-icon）就不重複畫；沒有就由引擎放在標題列
        if (item.icon && !$('.st-in-icon', phost)) { const a = artInfo(item.icon, env.vd); const ic = el('span', 'st-part-icon'); if (a) maskEl(ic, a.id); head.appendChild(ic); }
        if (item.label && !$('.st-in-label', phost)) head.appendChild(el('span', 'st-part-label', esc(item.label)));
        if (!head.children.length) head.remove();
        const part = { item, handle, pr, row, idx: i };
        if (cfg.separate) {
          const srow = el('div', 'st-submit-row'); part.btn = el('button', 'btn primary st-submit'); part.btn.type = 'button'; part.btn.addEventListener('click', () => submitStage(ui, i)); srow.appendChild(part.btn);
          part.note = el('span', 'st-submit-note muted'); srow.appendChild(part.note); row.appendChild(srow);
          part.reply = el('p', 'st-reply'); part.reply.setAttribute('aria-live', 'polite'); row.appendChild(part.reply);
          if (pr.solved) { row.classList.add('st-part-solved'); }
        }
        if (cfg.feedback === 'each') { part.mark = el('span', 'st-part-mark'); row.appendChild(part.mark); }
        wrap.appendChild(row); ui.parts.push(part);
      });
      ui.handle = partsHandle(ui, cfg);
    } else {
      const host = el('div', 'st-input-host'); wrap.appendChild(host);
      const kit = inputKit(cfg.kind);
      try { ui.handle = kit.mount(host, cfg, ui.ctx); } catch (e) { console.error('[stamps] input', cfg.kind, e); ui.handle = Fallback.text.mount(host, cfg, ui.ctx); }
      if (cfg.label && !$('.st-in-label', host)) wrap.insertBefore(el('div', 'st-input-label', esc(cfg.label)), host);
    }
    if (!cfg.separate) {
      const srow = el('div', 'st-submit-row'); ui.btn = el('button', 'btn primary st-submit'); ui.btn.type = 'button'; ui.btn.addEventListener('click', () => submitStage(ui, null)); srow.appendChild(ui.btn);
      ui.note = el('span', 'st-submit-note muted'); srow.appendChild(ui.note); wrap.appendChild(srow);
      ui.reply = el('p', 'st-reply'); ui.reply.setAttribute('aria-live', 'polite'); wrap.appendChild(ui.reply);
    } else { ui.reply = el('p', 'st-reply'); wrap.appendChild(ui.reply); }
    ui.lockNote = el('p', 'st-locknote muted'); ui.lockNote.hidden = true; wrap.appendChild(ui.lockNote);
    if (s.footNote) { ui.footNote = el('p', 'st-footnote muted', safeHtml(s.footNote)); wrap.appendChild(ui.footNote); }
    if (s.inputs.length > 1) {
      const sw = el('div', 'st-switch-row');
      s.inputs.forEach((inp, i) => { if (i === ui.inputIdx) return; const b = el('button', 'st-switch', esc(inp.switchLabel || '換一種回答方式')); b.type = 'button'; b.addEventListener('click', () => { sr.input = i; ui.inputIdx = i; scheduleSave(); mountInput(ui); syncStage(ui); if (sheetState && sheetState.env === env) sheetState.sig = taskSig(env); /* 元件已自己換好，簽章同步，不要再整段重畫 */ }); sw.appendChild(b); });
      wrap.appendChild(sw);
    }
  }
  // parts 的合成 handle
  function partsHandle(ui, cfg) {
    const ps = ui.parts;
    return {
      value: () => ps.map((p) => p.handle.value()),
      ready: () => (cfg.requireAll ? ps.every((p) => p.handle.ready() && String(p.handle.value() ?? '').trim() !== '') : ps.some((p) => String(p.handle.value() ?? '').trim() !== '') && ps.every((p) => p.handle.ready() || String(p.handle.value() ?? '').trim() === '')),
      setEnabled: (b) => ps.forEach((p) => p.handle.setEnabled(b && !(cfg.separate && p.pr.solved))),
      onWrong: () => ps.forEach((p) => p.handle.onWrong()),
      onSolved: () => ps.forEach((p) => p.handle.onSolved()),
      answerText: () => ps.map((p) => p.handle.answerText()).filter(Boolean).join('／'),
      precheck: () => { for (const p of ps) { const r = p.handle.precheck && p.handle.precheck(); if (r) return r; } return null; },
      refresh: () => ps.forEach((p) => p.handle.refresh && p.handle.refresh()),
      destroy: () => {},
    };
  }
  // 冷卻、答錯計數所在
  function scopeRec(ui, partIdx) {
    const { s, sr, env } = ui;
    if (env.preview) return { wrong: 0, lockUntil: 0 };
    if (partIdx != null) return pRec(sr, partIdx);
    if (env.vd.wrongScope === 'variant') return vRec(env.d, env.v, true);
    return sr;
  }
  const hintWrong = (ui) => ui.sr.wrong + (ui.s.nearCountsForHints ? ui.sr.near : 0);
  function syncStage(ui) {
    const { s, env, sr } = ui; if (!ui.handle) return;
    const clock = clockOf(env.d, env.preview), now = stNow();
    const inputOpen = !s.inputAt || tmin(clock) >= tmin(s.inputAt);
    const answerAt = s.answerAt || s.inputAt || null;
    const answerOpen = !answerAt || tmin(clock) >= tmin(answerAt);
    const isLast = s === env.vd.stages[env.vd.stages.length - 1];
    const defaultLabel = s.submitLabel || (isLast ? '蓋章' : '確定');
    const setBtn = (btn, note, rec, handle, early, own, lockOwner, partIdx) => {
      if (!btn) return;
      const locked = rec.lockUntil && rec.lockUntil > now;
      if (lockOwner.wasLocked && !locked) setReply(ui, '', partIdx);   // 冷卻結束：她回來時不用先看到上一次的「還不是」
      lockOwner.wasLocked = !!locked;
      let label = defaultLabel, enabled = true, noteTxt = '';
      if (locked) { label = lockLabel(rec.lockUntil); enabled = false; }
      else if (!answerOpen) {
        const e = early || s.early || { mode: 'disabled' };
        if (e.mode === 'message') { label = defaultLabel; } else { label = e.text || `${answerAt} 開放`; enabled = false; }
      }
      if (enabled && !(handle.ready && handle.ready())) enabled = false;
      if (own && own.solved) { label = '✓'; enabled = false; }
      if (ui.busy) enabled = false;
      btn.textContent = label; btn.disabled = !enabled; btn.classList.toggle('st-locked', !!locked);
      if (note) note.textContent = noteTxt;
      if (ui.lockNote && s.lockNote && locked && (rec.lockUntil - now) / 1000 >= (s.lockNote.over || 0) - 1 && rec.lockWait >= (s.lockNote.over || 0)) { ui.lockNote.textContent = s.lockNote.text; ui.lockNote.hidden = false; }
      else if (ui.lockNote && !locked) ui.lockNote.hidden = true;
    };
    const cfg = ui.cfg;
    const cfgEarly = cfg && cfg.early;
    if (cfg && cfg.separate) {
      ui.parts.forEach((p) => { p.handle.setEnabled(inputOpen && !p.pr.solved && !ui.busy); setBtn(p.btn, p.note, p.pr, p.handle, p.item.early || cfgEarly, p.pr, p, p.idx); });
    } else {
      ui.handle.setEnabled(inputOpen && !ui.busy);
      setBtn(ui.btn, ui.note, scopeRec(ui, null), ui.handle, cfgEarly, null, ui, null);
    }
    if (ui.footNote && s.footNoteUntil) ui.footNote.hidden = tmin(clock) >= tmin(s.footNoteUntil);
    if (ui.handle.refresh) { try { ui.handle.refresh(); } catch (e) { /* ignore */ } }
    syncHints(ui);
  }
  function syncHints(ui) {
    if (!ui.hintBtn) return;
    const { s, sr, env } = ui, hints = ui.hints, clock = clockOf(env.d, env.preview);
    const auto = !!(s.hintsAutoAt && tmin(clock) >= tmin(s.hintsAutoAt));
    const seen = Math.min(sr.hints || 0, hints.length);
    // 已看過的提示一直留著
    if (ui.hintList.children.length !== seen) { ui.hintList.innerHTML = hints.slice(0, seen).map((h) => `<li class="st-hint">${safeHtml(h.html)}</li>`).join(''); }
    if (auto && s.hintsAutoNote) { ui.hintNote.textContent = s.hintsAutoNote; ui.hintNote.hidden = false; }
    let label, enabled = false;
    if (seen >= hints.length) label = '提示都看完了';
    else {
      const h = hints[seen];
      if (!auto && h.at && tmin(clock) < tmin(h.at)) label = `${h.at} 以後可以看`;
      else if (!auto && (h.afterWrong || 0) > hintWrong(ui)) label = '答錯以後才會亮';
      else { label = `看提示（${seen + 1}／${hints.length}）`; enabled = true; }
    }
    ui.hintBtn.textContent = label; ui.hintBtn.disabled = !enabled;
  }
  function showHint(ui) {
    const { sr, env } = ui;
    if (sr.hints >= ui.hints.length) return;
    sr.hints = (sr.hints || 0) + 1; if (!env.preview) saveProg();
    setReply(ui, ''); ui.parts.forEach((p) => { if (p.reply) setReply(ui, '', p.idx); });   // 打開提示：上一句回應收掉
    syncHints(ui);
    const li = ui.hintList.lastElementChild; if (li) slideDown(li);
  }
  function setReply(ui, text, partIdx) {
    const target = (partIdx != null && ui.parts[partIdx] && ui.parts[partIdx].reply) || ui.reply;
    if (!target) return;
    target.textContent = text || ''; target.classList.toggle('st-has', !!text);
    if (text) anim(target, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
  }
  // 她動了答案，上一句回應就收掉。剛送出的那一下不算（clearOnWrong、棋子歸位也會叫 changed）
  function replyFade(ui, partIdx) { if (Date.now() >= (ui.replyHold || 0)) setReply(ui, '', partIdx); }
  function wrongMsgOf(ui, partIdx) {
    const cfg = ui.cfg; const item = partIdx != null ? cfg.items[partIdx] : null;
    return (item && item.wrongMsg) || cfg.wrongMsg || ui.s.wrongMsg || '還不是';
  }
  async function submitStage(ui, partIdx) {
    const { s, sr, env } = ui;
    if (ui.busy || !ui.handle) return;
    const cfg = ui.cfg, separate = !!(cfg && cfg.separate);
    if (separate && partIdx == null) return;
    const part = separate ? ui.parts[partIdx] : null;
    const handle = separate ? part.handle : ui.handle;
    const rec = scopeRec(ui, separate ? partIdx : null);
    const clock = clockOf(env.d, env.preview);
    if (rec.lockUntil && rec.lockUntil > stNow()) { syncStage(ui); return; }
    const answerAt = s.answerAt || s.inputAt || null;
    if (answerAt && tmin(clock) < tmin(answerAt)) {
      const e = (part && part.item.early) || (cfg && cfg.early) || s.early || { mode: 'disabled' };
      if (e.mode === 'message') setReply(ui, e.text || `${answerAt} 開放`, partIdx);
      syncStage(ui); return;
    }
    if (!(handle.ready && handle.ready())) { setReply(ui, (part && part.item.blankMsg) || (cfg && cfg.blankMsg) || '先填好再送出', partIdx); return; }
    if (handle.precheck) { const pc = handle.precheck(); if (pc) { setReply(ui, pc.msg || '', partIdx); return; } }
    const save = () => { if (!env.preview) saveProg(); };
    ui.busy = true; syncStage(ui);
    let res;
    try {
      if (separate) res = await evaluate(part.item.check, handle.value(), clock, part.item.parse || null);
      else if (cfg.kind === 'parts') res = await evaluateParts(cfg, handle.value(), clock);
      else res = await evaluate(cfg.check, handle.value(), clock, cfg.parse || null);
    } catch (e) { console.error('[stamps] evaluate', e); res = { status: 'wrong', msg: null, counts: false }; }
    ui.busy = false;
    if (cfg.kind === 'parts' && cfg.feedback === 'each' && res.each) ui.parts.forEach((p, i) => { if (p.mark) p.mark.textContent = res.each[i] === 'ok' ? '✓' : res.status === 'ok' ? '' : '✗'; });
    const noPenalty = !!((part && part.item.noPenalty) || (cfg && cfg.noPenalty));
    const countWrong = () => {
      if (noPenalty) return;
      if (env.preview) { sr.wrong = (sr.wrong || 0) + 1; return; }   // 試玩：次數照算（答錯才開的提示會開），不鎖、不寫
      rec.wrong = (rec.wrong || 0) + 1; if (rec !== sr) sr.wrong = (sr.wrong || 0) + 1;
      const wait = waitAfter(rec.wrong, s.wrong || DEFAULT_WRONG); rec.lockWait = wait;
      if (wait > 0) rec.lockUntil = stNow() + wait * 1000;
      saveProg();
    };
    if (res.status === 'ok') {
      setReply(ui, '', partIdx);
      if (separate) {
        part.pr.solved = stNow(); part.pr.answer = handle.answerText(); part.row.classList.add('st-part-solved'); try { handle.onSolved(); } catch (e) { /* ignore */ }
        save();
        if (ui.parts.every((p) => p.pr.solved)) { sr.answer = ui.parts.map((p) => p.pr.answer).filter(Boolean).join('／'); await stageSolved(ui); } else syncStage(ui);
      } else { sr.answer = handle.answerText(); try { handle.onSolved(); } catch (e) { /* ignore */ } await stageSolved(ui); }
      return;
    }
    if (res.status === 'near') { sr.near = (sr.near || 0) + 1; setReply(ui, res.msg || '', partIdx); if (res.counts) countWrong(); else save(); syncStage(ui); return; }
    if (res.status === 'wrong') { ui.replyHold = Date.now() + 600; setReply(ui, wrongMsgOf(ui, partIdx), partIdx); try { handle.onWrong(); } catch (e) { /* ignore */ } countWrong(); syncStage(ui); return; }
    const dflt = { empty: '請用文字寫', blank: '先填好再送出', parsefail: '請寫數字' }[res.status] || '';
    let msg = res.msg;
    if (msg == null) { const src = part ? part.item : cfg; msg = res.status === 'empty' ? (src.check && src.check.emptyMsg) : res.status === 'blank' ? src.blankMsg : src.parseMsg; }
    setReply(ui, msg || dflt, partIdx); syncStage(ui);
  }
  async function stageSolved(ui) {
    const { s, sr, env } = ui;
    sr.solved = stNow(); if (!env.preview) saveProg();
    ui.busy = true; syncStage(ui);
    const fx = s.solveFx;
    if (fx) {
      try {
        const jobs = [];
        if (fx.flash && fx.flash.length) ui.mounts.forEach((m) => { if (m.flash) jobs.push(m.flash(fx.flash, fx.flashMs || 250)); });
        // 有答對動畫的元件由動畫自己走到最後狀態（先 refresh() 會直接跳到最後一幀，動畫就看不到了）
        ui.mounts.forEach((m) => { if (m.solvedAnim) jobs.push(m.solvedAnim()); else if (m.refresh) m.refresh(); });
        if (fx.delayMs && !REDUCE()) jobs.push(new Promise((r) => setTimeout(r, fx.delayMs)));
        await Promise.all(jobs.map((p) => Promise.resolve(p).catch(() => {})));
      } catch (e) { /* ignore */ }
    } else { ui.mounts.forEach((m) => { try { if (m.refresh) m.refresh(); } catch (e) { /* ignore */ } }); }
    ui.busy = false;
    const isLast = s === env.vd.stages[env.vd.stages.length - 1];
    if (!isLast) { rebuildStages(true); return; }
    if (env.preview) {   // 試玩：看得到結果卡，但什麼都不寫
      env.pvAnswer = env.vd.stages.map((x) => { const r = stageRec(env, x.id); return r && r.answer ? r.answer : ''; }).filter(Boolean).join('／');
      if (sheetState && sheetState.root) renderResult(sheetState.root, env, true);
      return;
    }
    // 蓋章
    const dr = dayRec(env.d, true);
    const now = stNow(), late = now >= closeMs(env.d);
    // 「你的答案」：各段她送出的內容，依段落順序用「／」接起來（和 reveal.answer 的寫法一致）
    const answers = env.vd.stages.map((x) => { const r = sRec(env.d, env.v, x.id); return r && r.answer ? r.answer : ''; }).filter(Boolean);
    dr.stamp = { variant: env.v, at: now, late, manual: false, answer: answers.join('／') || sr.answer || '' };
    dr.pressed = false; saveProg(); api.syncTabs();
    if (sheetState && sheetState.root) renderResult(sheetState.root, env, true);
  }
  function rebuildStages(animateNew) {
    if (!sheetState || !sheetState.env) return;
    const env = sheetState.env;
    const list = $('.st-stages', sheetState.root); if (!list) return;
    if (sheetState.stages.some((u) => u.busy)) return;   // 送出或答對動畫進行中：等它結束（每秒的 refreshSheet 會再來）
    const vis = new Set(sheetState.stages.map((u) => u.s.id));
    // 回應行的字留著（重畫不該把剛出現的「還不是」洗掉）
    const keep = {}; sheetState.stages.forEach((u) => { keep[u.s.id] = { reply: u.reply ? u.reply.textContent : '', parts: (u.parts || []).map((p) => (p.reply ? p.reply.textContent : '')) }; });
    destroyStages();
    list.innerHTML = '';
    buildStages(list, env, false);
    const restore = (node, text) => { if (node && text) { node.textContent = text; node.classList.add('st-has'); } };
    sheetState.stages.forEach((u) => { const k = keep[u.s.id]; if (!k) return; restore(u.reply, k.reply); (u.parts || []).forEach((p, i) => restore(p.reply, k.parts[i])); });
    if (!env.preview && dayState(env.d) === 'open') markSeen(env.d);   // 任務頁開著時出現的新段落，她正看著，紅點不用再亮
    if (animateNew) sheetState.stages.forEach((u) => { if (!vis.has(u.s.id)) slideDown(u.host); });
    sheetState.sig = taskSig(env);
    const t = $('.st-title', sheetState.root); if (t) t.textContent = titleOf(env.vd, env.clock);
  }
  // 每秒：局部更新；每 30 秒或時間跳動：看簽章決定要不要重畫
  function refreshSheet(force) {
    if (!sheetState || !sheetState.env) return;
    const env = sheetState.env;
    if (sheetState.entry.view !== 'task' && sheetState.entry.view) return;
    env.clock = clockOf(env.d, env.preview); env.missed = !env.preview && dayState(env.d) === 'missed';
    const focused = document.activeElement && sheetState.root.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    const sig = taskSig(env);
    const wasOpenView = !!$('.st-stages', sheetState.root);
    if (!env.preview) {
      const st = dayState(env.d);
      if (st === 'missed' && wasOpenView) { renderDaySheet(sheetState.root, sheetState.entry); return; }
    }
    const busy = sheetState.stages.some((u) => u.busy);
    if ((force || sig !== sheetState.sig) && wasOpenView && !focused && !busy) { rebuildStages(true); return; }
    // 有輸入框在焦點上：等 blur 以後再重畫。延遲放寬到 300 ms：她按「蓋章」那一下先 blur 再 click，重畫要排在 click 之後（送出中 busy 會再等）
    if (sig !== sheetState.sig && focused && !sheetState.blurWait) { sheetState.blurWait = true; const onBlur = () => { document.removeEventListener('focusout', onBlur, true); setTimeout(() => { if (sheetState) sheetState.blurWait = false; refreshSheet(false); }, 300); }; document.addEventListener('focusout', onBlur, true); }
    sheetState.stages.forEach(syncStage);
  }

  // ───────────────────────── 規則卡、結果卡、答案頁 ─────────────────────────
  function rulesCard(inSheet) {
    const r = C.rules;
    const sec = el('section', 'card st-rules'); sec.innerHTML = `<h3 class="card-h">${esc(r.title)}</h3><ol class="st-rule-lines">${r.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol><button class="btn st-rules-ok" type="button" data-st-act="rules-ok">${esc(r.ok)}</button>`;
    return sec;
  }
  function paperHtml(d, inner, cls) { return `<div class="st-paper${cls ? ' ' + cls : ''}" data-st-day="${esc(d)}">${inner}</div>`; }
  function renderResult(root, env, animate) {
    const { d, vd } = env; const dr = env.preview ? null : dayRec(d, true);
    const yours = env.preview ? env.pvAnswer : (dr.stamp && dr.stamp.answer);
    root.innerHTML = '';
    if (env.preview) root.appendChild(el('p', 'st-preview-tag', '試玩：這個印章不會留下紀錄。'));
    root.insertAdjacentHTML('beforeend', loadingNote());
    const paper = el('div', 'st-paper st-result-paper'); paper.dataset.stDay = d;
    const stamp = maskEl(el('div', 'st-stamp-img'), `st-s-${d}`, dayInk(d)); paper.appendChild(stamp);
    if (vd.reveal.stampCaption) paper.appendChild(el('p', 'st-stamp-caption', esc(vd.reveal.stampCaption)));
    root.appendChild(paper);
    const ans = el('section', 'st-reveal');
    ans.innerHTML = `<p class="st-answer-line"><span class="st-k">${esc(C.card.answer)}</span>${esc(vd.reveal.answer)}</p>` + (yours ? `<p class="st-answer-line st-yours"><span class="st-k">${esc(C.card.yourAnswer)}</span>${esc(yours)}</p>` : '');
    const rctx = makeCtx(env, 'reveal', () => null, () => {}, {});
    const r = renderBlocks(vd.reveal.blocks, env, rctx); const body = el('div', 'st-reveal-body'); body.appendChild(r.frag); ans.appendChild(body); sheetState.mounts.push(...r.mounts);
    if (vd.reveal.more) { const dm = el('details', 'st-more'); dm.innerHTML = `<summary>${esc(vd.reveal.more.label || '再多一點')}</summary>`; const rr = renderBlocks(vd.reveal.more.blocks, env, rctx, { noPause: true }); const mb = el('div', 'st-more-body'); mb.appendChild(rr.frag); dm.appendChild(mb); sheetState.mounts.push(...rr.mounts); ans.appendChild(dm); }
    root.appendChild(ans);
    root.appendChild(questionDetails(env, env.preview));
    if (animate) { press(stamp, paper); setTimeout(() => { try { paper.scrollIntoView({ block: 'start', behavior: REDUCE() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ } }, 50); }
    sheetState.sig = null;
  }
  // 「題目」收合區：各段落的最終樣子（spec §9.4／9.5）。每段用自己的 stageId 和草稿（她點過的邊、放好的棋子都在），
  // 錯過的答案頁把所有段落當成已解（時刻條件也都當已過），圖才會是完整的最後一幕。
  function questionDetails(env, allSolved) {
    const { vd } = env;
    const qenv = allSolved ? Object.assign({}, env, { solved: () => true }) : env;
    const det = el('details', 'st-question'); det.innerHTML = `<summary>${esc(C.card.question)}</summary>`;
    const body = el('div', 'st-question-body');
    vd.stages.forEach((s) => {
      const sec = el('section', 'st-stage st-readonly');
      if (s.label) sec.appendChild(el('h3', 'st-stage-label', esc(s.label)));
      const sr = stageRec(env, s.id);
      const rctx = makeCtx(qenv, s.id, (k, f) => (sr && sr.draft && k in sr.draft ? sr.draft[k] : f), () => {}, {});
      const r = renderBlocks(s.blocks, qenv, rctx, { noPause: true }); sec.appendChild(r.frag); sheetState.mounts.push(...r.mounts);
      if (sr && sr.answer) sec.appendChild(el('p', 'st-solved-line', `<span class="st-check" aria-hidden="true">✓</span><span class="st-solved-answer">${esc(sr.answer)}</span>`));
      body.appendChild(sec);
    });
    det.appendChild(body);
    return det;
  }
  function renderAnswerPage(root, env) {
    const { d, vd } = env;
    root.innerHTML = '';
    root.insertAdjacentHTML('beforeend', loadingNote());
    const paper = el('div', 'st-paper st-missed-paper'); paper.dataset.stDay = d;
    const stamp = maskEl(el('div', 'st-stamp-img st-dim'), `st-s-${d}`, dayInk(d)); paper.appendChild(stamp);
    const snow = maskEl(el('div', 'st-snow-over'), `st-c-snow-${(+d.slice(2)) % 6 + 1}`, inkOf(C.cardInks.snow)); paper.appendChild(snow);
    paper.appendChild(el('p', 'st-missed-word', esc(C.card.missed)));
    root.appendChild(paper);
    const ans = el('section', 'st-reveal');
    ans.innerHTML = `<p class="st-answer-line"><span class="st-k">${esc(C.card.answer)}</span>${esc(vd.reveal.answer)}</p>`;
    const rctx = makeCtx(env, 'reveal', () => null, () => {}, {});
    const r = renderBlocks(vd.reveal.blocks, env, rctx); const body = el('div', 'st-reveal-body'); body.appendChild(r.frag); ans.appendChild(body); sheetState.mounts.push(...r.mounts);
    if (vd.reveal.more) { const dm = el('details', 'st-more'); dm.innerHTML = `<summary>${esc(vd.reveal.more.label || '再多一點')}</summary>`; const rr = renderBlocks(vd.reveal.more.blocks, env, rctx, { noPause: true }); const mb = el('div', 'st-more-body'); mb.appendChild(rr.frag); dm.appendChild(mb); sheetState.mounts.push(...rr.mounts); ans.appendChild(dm); }
    root.appendChild(ans);
    root.appendChild(questionDetails(env, true));
    sheetState.sig = null;
  }
  function renderBonusSheet(root) {
    root.innerHTML = '';
    const paper = el('div', 'st-paper st-bonus-paper');
    paper.appendChild(maskEl(el('div', 'st-stamp-img'), 'st-c-bonus', inkOf(C.bonus.ink || 'sumi')));
    root.appendChild(paper);
  }

  // ───────────────────────── 卡片、分頁（spec §9.1、9.2） ─────────────────────────
  // 紙紋在 stamps.css 的 .st-card（background-image）
  let cardAllStamped = false;   // 只有旅人面板的「看卡片」會開：畫成全部蓋滿的樣子，不碰進度
  function slotHtml(d, i) {
    const info = dayInfo(d), st = cardAllStamped ? 'stamped' : dayState(d), md = `${d.slice(0, 2)}.${d.slice(2)}`, dr = dayRec(d);
    const last = i === DAYS().length - 1;
    const frame = (op) => maskHtml(`st-c-frame-${d}`, inkOf('sumi'), 'st-frame', `opacity:${op}`);
    let inner, cls = st;
    if (st === 'stamped') inner = maskHtml(`st-s-${d}`, dayInk(d), 'st-stamp') ;
    else {
      let inside;
      if (st === 'open') inside = `<span class="st-d">${md}</span><span class="st-go">${esc(C.card.today)}</span>`;
      else if (st === 'late') inside = `<span class="st-d">${md}</span><span class="st-go st-go-late">${esc(C.card.late)}</span>`;
      else if (st === 'missed') inside = `${maskHtml(`st-c-snow-${(+d.slice(2)) % 6 + 1}`, inkOf(C.cardInks.snow), 'st-snow')}<span class="st-m">${esc(C.card.missed)}</span>`;
      else if (isToday(d)) inside = `<span class="st-d">${md}</span><span class="st-w">${esc(C.card.open9)}</span>`;
      else inside = `<span class="st-d">${md}</span><span class="st-w">（${esc(info.dow)}）</span>`;
      const viewed = st === 'missed' && dr && dr.answerViewed;
      // 看過答案的格子放的是整張淡墨印章（圖裡已含框下的名稱、日期），和蓋章格一樣不再另外寫 .st-cap（spec §9.2）
      inner = `<div class="st-empty${viewed ? ' st-viewed' : ''}">${viewed ? maskHtml(`st-s-${d}`, dayInk(d), 'st-stamp st-dim') : frame(st === 'open' || st === 'late' ? .55 : .26)}<div class="st-inside">${inside}</div></div>` +
        (viewed ? '' : `<div class="st-cap"><span class="st-n">${esc(info.name)}</span><span class="st-dd">2026.${md}</span></div>`);
      if (viewed) cls += ' st-viewed';
    }
    return `<button class="st-slot ${cls}${last ? ' st-last' : ''}" type="button" data-st-slot="${d}" aria-label="${esc(fmtMD(d))} ${esc(info.name)}">${inner}</button>`;
  }
  function cardHtml() {
    const n = cardAllStamped ? DAYS().length : stampedCount(), snowInk = inkOf(C.cardInks.snow);
    const corner = (k) => maskHtml(`st-c-corner-${k}`, inkOf(C.cardInks['corner-' + k]), `st-corner st-${k}`);
    const bonusOn = cardAllStamped || bonusVisible();
    const bonus = bonusOn
      ? `<button class="st-bonus st-bonus-on" type="button" data-st-act="bonus" aria-label="第 14 枚">${maskHtml('st-c-bonus', inkOf(C.bonus.ink || 'sumi'), 'st-stamp')}</button>`
      : `<div class="st-bonus st-bonus-lock"><div class="st-slot st-lock"><div class="st-empty">${maskHtml('st-c-frame-1222', inkOf('sumi'), 'st-frame', 'opacity:.26')}<div class="st-inside"><span class="st-d st-q">？</span></div></div></div><p class="st-bonus-note">${esc(C.bonus.note)}</p></div>`;
    return `<section class="st-card st-paper" aria-label="${esc(C.card.title)}">` +
      corner('tl') + corner('tr') + corner('bl') + corner('br') +
      `<div class="st-card-title"><h2>${esc(C.card.title)}</h2><p>${esc(C.card.sub)}</p></div>` +
      maskHtml('st-c-header', inkOf(C.cardInks.header), 'st-header-img') +
      `<div class="st-progress">${maskHtml('st-c-snow-2', snowInk, 'st-snow-sm')}<span>${esc(C.card.progress).replace('{n}', `<b>${n}</b>`)}</span>${maskHtml('st-c-snow-2', snowInk, 'st-snow-sm')}</div>` +
      `<div class="st-grid">${DAYS().map((x, i) => slotHtml(x.day, i)).join('')}</div>` +
      `<div class="st-divider">${maskHtml('st-c-snow-4', snowInk, 'st-snow-sm')}${maskHtml('st-c-snow-5', snowInk, 'st-snow-md')}${maskHtml('st-c-snow-6', snowInk, 'st-snow-sm')}</div>` +
      bonus + '</section>';
  }
  function renderCardPreview(root) {
    cardAllStamped = true;
    try { root.innerHTML = `<p class="st-preview-tag">試看：全部蓋滿的樣子，不是目前的進度。</p>${loadingNote()}<div class="st-card-preview">${cardHtml()}</div>`; } finally { cardAllStamped = false; }
  }
  function renderTab(view) {
    if (!tabVisible()) { view.innerHTML = ''; return; }
    const t = todayKey(); if (t && dayData(t)) { const st0 = dayState(t); if (st0 === 'open' || st0 === 'late') markSeen(t); }   // 9:00 前看分頁不記 seen，9:00 的紅點才會亮
    if (bonusVisible() && !prog.bonus.seen) { prog.bonus.seen = true; saveProg(); api.syncTabs(); }
    let html = `<p class="st-topline muted">${esc(C.topLine)}</p>`;
    if (!prog.rulesSeen) html += rulesCard().outerHTML;
    html += loadingNote();
    html += cardHtml();
    const st = t && dayData(t) ? dayState(t) : null;
    if (st === 'open' || st === 'late') html += `<button class="btn primary st-open-today" type="button" data-st-act="open-today" data-st-day="${t}">${esc(C.card.openToday)}</button>`;
    else { const late = DAYS().find((x) => dayState(x.day) === 'late'); if (late) html += `<button class="btn primary st-open-today" type="button" data-st-act="open-today" data-st-day="${late.day}">${esc(C.card.late)}：${esc(fmtMD(late.day, false))}</button>`; }
    if (prog.rulesSeen) html += `<p class="st-rules-link"><button class="st-link" type="button" data-st-act="rules">${esc(C.rules.title)}</button></p>`;
    view.innerHTML = html;
    // 剛蓋章、第一次回到卡片：播蓋章動畫
    DAYS().forEach((x) => { const dr = dayRec(x.day); if (dr && dr.stamp && !dr.pressed) { const img = $(`.st-slot[data-st-slot="${x.day}"] .st-stamp`, view); dr.pressed = true; saveProg(); if (img) { const slot = img.closest('.st-slot'); slot.classList.add('st-pressing'); press(img, $('.st-card', view)).then(() => slot.classList.remove('st-pressing')); } } });
    if (bonusVisible() && !prog.bonus.pressed) { prog.bonus.pressed = true; saveProg(); const img = $('.st-bonus-on .st-stamp', view); if (img) anim(img, [{ transform: 'translateY(-30px) scale(1.3)', opacity: 0 }, { transform: 'scale(.96)', opacity: .9, offset: .6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 800, easing: 'cubic-bezier(.3,.7,.2,1)' }); }
    lastTabSig = tabSig();
    try { if (api.getUi().tab === 'stamps') api.renderTopbar(); } catch (e) { /* ignore */ }   // 標題列的「已集 n ／ 13」跟著更新
  }
  function tabSig() { return DAYS().map((x) => { const dr = dayRec(x.day); return dayState(x.day) + (dr && dr.answerViewed ? 'v' : ''); }).join(',') + '|' + (bonusVisible() ? 1 : 0) + '|' + (prog.rulesSeen ? 1 : 0) + '|' + (photosDone ? 1 : 0) + '|' + todayKey(); }
  function topbar() { return { title: C ? C.tabLabel : '', sub: C ? C.card.progress.replace('{n}', stampedCount()) : '' }; }
  const tabIcon = () => '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M8 9h8M8 12.5h8M8 16h5"/></svg>';

  // ───────────────────────── 「現在」頁任務卡（spec §9.6） ─────────────────────────
  function nowCardHtml() {
    if (!tabVisible()) return '';
    const t = todayKey(); if (!t || !dayData(t)) return '';
    const st = dayState(t); if (!(st === 'open' || st === 'late' || st === 'stamped')) return '';
    const vd = variantData(t); if (!vd) return '';
    const dr = dayRec(t);
    let line2;
    if (st === 'stamped') line2 = C.now.done;
    else { const lp = latestPing(t), seen = dr ? dr.seen || '' : ''; line2 = (tmin(lp) > tmin('09:00') && tmin(lp) > (seen ? tmin(seen) : -1)) ? C.now.new : C.now.tap; }
    return `<section class="card st-now-card" data-st-act="open-day" data-st-day="${t}"><button class="card-open" type="button" aria-label="${esc(C.now.title)}" data-st-act="open-day" data-st-day="${t}"></button><span class="card-chevron" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span><div class="card-h">${esc(C.now.title)}</div><div class="st-now-title">${esc(titleOf(vd, clockOf(t)))}</div><div class="st-now-sub${line2 === C.now.new ? ' st-new' : ''}">${esc(line2)}</div></section>`;
  }

  // ───────────────────────── 事件 ─────────────────────────
  function openDay(d, trigger, extra) {
    if (!d || !dayData(d)) return;
    const st = dayState(d);
    if (!extra && !tabVisible()) return;
    if (!extra && st === 'future') { api.toast(`${fmtMD(d, false)} 09:00 開放`); return; }
    api.openSheet(Object.assign({ type: 'stamp', day: d, view: 'task' }, extra || {}), trigger);
  }
  let adminTaps = [];
  function bindEvents() {
    document.addEventListener('click', (e) => {
      // 隱藏面板：3 秒內連點「App 版本」5 次（spec §10.1）
      const dt = e.target.closest && e.target.closest('dl.version dt');
      if (dt && dt === dt.parentElement.querySelector('dt')) {
        const now = Date.now(); adminTaps = adminTaps.filter((t) => now - t < 3000); adminTaps.push(now);
        if (adminTaps.length >= 5 && ST) { adminTaps = []; api.openSheet({ type: 'stamp', view: 'admin' }, dt); }
        return;
      }
      const t = e.target.closest && e.target.closest('[data-st-act], [data-st-slot]');
      if (!t || !ST) return;
      if (t.dataset.stSlot) { const d = t.dataset.stSlot; const st = dayState(d); if (st === 'future') { api.toast(`${fmtMD(d, false)} 09:00 開放`); return; } openDay(d, t); return; }
      const act = t.dataset.stAct;
      if (act === 'open-today' || act === 'open-day') { openDay(t.dataset.stDay, t); return; }
      if (act === 'rules-ok') { prog.rulesSeen = true; saveProg(); const c = t.closest('.st-rules'); if (c) { if (c.closest('#view')) { lastTabSig = null; api.render(false); } else c.remove(); } return; }
      if (act === 'rules') { const view = $('#view'); if (view) { const old = $('.st-rules', view); if (old) { old.remove(); return; } const card = rulesCard(); const anchor = $('.st-card', view); if (anchor) anchor.before(card); slideDown(card); } return; }
      if (act === 'bonus') { api.openSheet({ type: 'stamp', view: 'bonus' }, t); return; }
      if (act.startsWith('adm-')) { adminAction(act, t); return; }
      if (act.startsWith('t-')) { testAction(act, t); }
    });
  }

  // ───────────────────────── 隱藏的旅人面板（spec §10） ─────────────────────────
  function stateLabel(d) {
    const st = dayState(d), dr = dayRec(d);
    if (st === 'stamped') return `已蓋章 ${jstOf(dr.stamp.at).hhmm}${dr.stamp.manual ? '（補登）' : dr.stamp.late ? '（延長）' : ''}`;
    if (st === 'future') return '未開放';
    if (st === 'open') return '進行中';
    if (st === 'late') return '延長中';
    return dr && dr.answerViewed ? '已看答案' : C.card.missed;
  }
  function renderAdmin(root) {
    const rows = DAYS().map((x) => {
      const d = x.day, dd = dayData(d); if (!dd) return '';
      const v = variantName(d), st = dayState(d), dr = dayRec(d);
      const stamped = st === 'stamped', viewed = !!(dr && dr.answerViewed);
      const hasRec = !!(dr && (dr.stamp || dr.answerViewed || Object.keys(dr.v || {}).length));
      const vbtn = (k) => `<button class="btn${v === k ? ' primary' : ' ghost'}" type="button" data-st-act="adm-variant" data-st-day="${d}" data-st-v="${k}" aria-pressed="${v === k}"${stamped ? ' disabled' : ''}>${k === 'main' ? '主題' : '備案'}<small>${esc(dd.variants[k].title)}</small></button>`;
      const flags = (dd.flags || []).map((f) => `<label class="st-adm-flag"><input type="checkbox" data-st-act="adm-flag" data-st-day="${d}" data-st-flag="${esc(f.id)}"${(ctl.flags[d] || []).includes(f.id) ? ' checked' : ''}> ${esc(f.label)}</label>`).join('');
      return `<section class="card st-adm-day" data-st-day="${d}"><div class="card-h">${esc(fmtMD(d))} ${esc(x.name)}<span class="muted">${esc(stateLabel(d))}</span></div>` +
        `<div class="st-adm-row st-adm-variants">${vbtn('main')}${vbtn('alt')}</div>` +
        `<label class="st-adm-flag"><input type="checkbox" data-st-act="adm-late" data-st-day="${d}"${ctl.allowLate[d] ? ' checked' : ''}${viewed || stamped ? ' disabled' : ''}> 延長到 12/22 24:00${viewed ? '<span class="muted">（已看過答案）</span>' : ''}</label>` +
        (flags ? `<div class="st-adm-flags"><span class="muted">當天狀況</span>${flags}</div>` : '') +
        `<div class="st-adm-row"><button class="btn ghost" type="button" data-st-act="adm-preview" data-st-day="${d}" data-st-v="${v}">試玩這題</button>` +
        (stamped ? '' : `<button class="btn ghost" type="button" data-st-act="adm-manual" data-st-day="${d}">補登蓋章</button>`) +
        (hasRec ? `<button class="btn ghost" type="button" data-st-act="adm-clear" data-st-day="${d}">清除這天的紀錄</button>` : '') + '</div></section>';
    }).join('');
    root.innerHTML = `<h2 class="sheet-title">設定（旅人）</h2><p class="muted">這一頁只改這支手機。</p><div class="st-adm-row"><button class="btn ghost" type="button" data-st-act="adm-card">看卡片（全部蓋滿的樣子）</button></div>${rows}` + (api.IS_LOCAL ? `<section class="card st-adm-test"><div class="card-h">測試工具（只在本機）</div><p class="muted">畫面右邊的「測」。</p></section>` : '');
  }
  function adminAction(act, t) {
    const d = t.dataset.stDay;
    if (act === 'adm-variant') {
      const k = t.dataset.stV; if (variantName(d) === k) return;
      const vr = vRec(d, variantName(d)); const hasRec = vr && Object.values(vr.stages || {}).some((s) => s.solved || s.wrong || s.hints || (s.draft && Object.keys(s.draft).length));
      if (hasRec && !confirm('這天已經作答過，切換後從頭開始（原本的紀錄留著，切回來還在）。')) return;
      ctl.variant[d] = k; saveCtl(); const dr = dayRec(d); if (dr) { dr.seen = ''; saveProg(); }
      renderAdmin(sheetState.root); api.syncTabs(); lastTabSig = null; return;
    }
    if (act === 'adm-late') { if (t.checked) ctl.allowLate[d] = true; else delete ctl.allowLate[d]; saveCtl(); renderAdmin(sheetState.root); api.syncTabs(); lastTabSig = null; return; }
    if (act === 'adm-flag') { const f = t.dataset.stFlag; const arr = (ctl.flags[d] || []).filter((x) => x !== f); if (t.checked) arr.push(f); ctl.flags[d] = arr; saveCtl(); return; }
    if (act === 'adm-manual') { if (!confirm(`把 ${fmtMD(d, false)} 記成已蓋章？（補登）`)) return; const dr = dayRec(d, true); dr.stamp = { variant: variantName(d), at: stNow(), late: stNow() >= closeMs(d), manual: true, answer: '' }; dr.pressed = true; saveProg(); renderAdmin(sheetState.root); api.syncTabs(); lastTabSig = null; return; }
    if (act === 'adm-card') { api.openSheet({ type: 'stamp', view: 'cardPreview' }, t); return; }
    if (act === 'adm-clear') { if (!confirm(`清除 ${fmtMD(d, false)} 的作答和印章紀錄？清除後無法復原。`)) return; delete prog.days[d]; saveProg(); renderAdmin(sheetState.root); api.syncTabs(); lastTabSig = null; return; }
    if (act === 'adm-preview') { api.openSheet({ type: 'stamp', day: d, view: 'task', preview: true, variant: t.dataset.stV }, t); }
  }
  document.addEventListener('change', (e) => { const t = e.target.closest && e.target.closest('[data-st-act^="adm-"]'); if (t && t.type === 'checkbox') adminAction(t.dataset.stAct, t); });

  // ───────────────────────── 測試工具（只在 localhost；spec §11.2、11.3） ─────────────────────────
  function presetApply(name, dayArg, variantArg, nowArg) {
    const dayStr = (d, hhmmss) => `${dateOf(d)}T${hhmmss}`;
    const clear = () => { prog = { v: 1, rulesSeen: true, bonus: { pressed: false, seen: false }, days: {} }; };
    const stampDay = (d, at) => { const dr = dayRec(d, true); dr.stamp = { variant: variantName(d), at: jstMs(at), late: false, manual: false, answer: '（測試）' }; dr.pressed = true; dr.seen = '23:59'; };
    const missDay = (d, viewed) => { const dr = dayRec(d, true); dr.stamp = null; dr.answerViewed = !!viewed; };
    let now = nowArg || null;
    if (name === 'clean') { clear(); ctl = { variant: {}, allowLate: {}, flags: {} }; saveCtl(); api.store.del(KEYS.sim); }
    else if (name === 'before') { clear(); now = now || '2026-12-10T08:59:50'; }
    else if (name === 'day') {
      const d = dayArg && dayData(dayArg) ? dayArg : '1210'; clear();
      DAYS().forEach((x) => { if (x.day < d) stampDay(x.day, dayStr(x.day, '12:00')); });
      if (variantArg) { ctl.variant[d] = variantArg; saveCtl(); }
      now = now || dayStr(d, '08:59:50');
    } else if (name === 'mid' || name === 'viewed') { clear(); ['1210', '1211', '1212'].forEach((d) => stampDay(d, dayStr(d, '12:00'))); missDay('1213', name === 'viewed'); now = now || '2026-12-14T13:05:00'; }
    else if (name === 'late') { clear(); DAYS().forEach((x) => { if (x.day < '1216') stampDay(x.day, dayStr(x.day, '12:00')); }); ctl.allowLate['1216'] = true; saveCtl(); now = now || '2026-12-17T10:00:00'; }
    else if (name === 'allDone') { clear(); DAYS().forEach((x) => stampDay(x.day, dayStr(x.day, '12:00'))); now = now || '2026-12-22T17:39:50'; }
    else if (name === 'oneMissed') { clear(); DAYS().forEach((x) => { if (x.day !== '1216') stampDay(x.day, dayStr(x.day, '12:00')); }); missDay('1216', false); now = now || '2026-12-22T17:40:05'; }
    else if (name === 'cooldown') {
      const d = dayArg && dayData(dayArg) ? dayArg : (todayKey() || '1210'); clear();
      DAYS().forEach((x) => { if (x.day < d) stampDay(x.day, dayStr(x.day, '12:00')); });
      const vd = variantData(d); const s = vd.stages[0]; const w = s.wrong || DEFAULT_WRONG; const maxWait = Math.max(...w.waits);
      const at = s.answerAt || s.inputAt || '09:00'; const m = tmin(at) + 5; now = now || dayStr(d, `${fmtMin(m)}:00`);
      const nowMs = jstMs(now); const sr = sRec(d, variantName(d), s.id, true); const rec = vd.wrongScope === 'variant' ? vRec(d, variantName(d), true) : sr;
      rec.wrong = w.waits.indexOf(maxWait) + 1; rec.lockUntil = nowMs + maxWait * 1000; rec.lockWait = maxWait;
    } else return false;
    saveProg();
    if (now) setSim(now); else afterTimeChange();
    return true;
  }
  function keyTimes(d) {
    const vd = variantData(d); const set = new Set(['08:59:50']);
    const add = (t) => { if (!t) return; const m = tmin(t) - 1; set.add(`${fmtMin(m < 0 ? 0 : m)}:50`); };
    if (vd) {
      (vd.pings || []).forEach(add); (vd.titleAt || []).forEach((x) => add(x.at));
      vd.stages.forEach((s) => { ['showAt', 'inputAt', 'answerAt', 'hintsAutoAt', 'footNoteUntil'].forEach((k) => add(s[k])); (s.hints || []).forEach((h) => add(h.at)); (s.blocks || []).forEach((b) => { add(b.at); add(b.until); if (b.dimUntil) add(b.dimUntil); if (b.zones && b.zones.from) add(b.zones.from); }); (s.inputs || []).forEach((inp) => { const chk = (c) => (c && c.near || []).forEach((r) => add(r.from)); chk(inp.check); (inp.items || []).forEach((it) => chk(it.check)); (inp.groups || []).forEach(chk); (inp.placeholderAt || []).forEach((p) => add(p.until)); }); });
    }
    set.add('23:59:50');
    return [...set].sort();
  }
  function buildTestPanel() {
    if (!api.IS_LOCAL || testPanel) return;
    const btn = el('button', 'st-test-btn', '測'); btn.type = 'button'; btn.setAttribute('aria-label', '測試面板');
    const panel = el('div', 'st-test-panel'); panel.hidden = true;
    document.body.appendChild(btn); document.body.appendChild(panel);
    btn.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) renderTestPanel(); });
    testPanel = { btn, panel };
    setInterval(() => { if (!panel.hidden) { const c = $('.st-t-clock', panel); if (c) c.textContent = testClockText(); } }, 1000);
  }
  function testClockText() { const j = jstOf(stNow()); return `目前：${+j.date.slice(5, 7)}/${+j.date.slice(8)} ${j.hhmm}:${pad2(j.sec)}${isSim() ? '（模擬）' : ''}`; }
  function renderTestPanel() {
    const p = testPanel.panel; const d = (sheetState && sheetState.entry && sheetState.entry.day) || todayKey() || '1210';
    const j = jstOf(stNow());
    const times = keyTimes(d).map((t) => `<button class="btn ghost" type="button" data-st-act="t-time" data-st-time="${dateOf(d)}T${t}">${t.slice(0, 5)}</button>`).join('') + `<button class="btn ghost" type="button" data-st-act="t-time" data-st-time="${dateOf(d).replace(/(\d\d)$/, (m) => pad2(+m + 1))}T00:00:10">隔天 00:00</button>`;
    p.innerHTML = `<div class="st-t-head"><b>測試</b><span class="st-t-clock mono">${esc(testClockText())}</span><button class="btn ghost" type="button" data-st-act="t-close">關</button></div>` +
      `<div class="st-t-row"><input class="st-t-input mono" type="text" value="${j.date}T${j.hhmm}:${pad2(j.sec)}" aria-label="模擬時間"><button class="btn" type="button" data-st-act="t-apply">套用</button><button class="btn ghost" type="button" data-st-act="t-off">關掉模擬</button></div>` +
      `<div class="st-t-row st-t-times"><span class="muted">${esc(fmtMD(d))} 前 10 秒</span>${times}</div>` +
      `<div class="st-t-row"><button class="btn ghost" type="button" data-st-act="t-plus" data-st-min="1">＋1 分</button><button class="btn ghost" type="button" data-st-act="t-plus" data-st-min="10">＋10 分</button><button class="btn ghost" type="button" data-st-act="t-plus" data-st-min="60">＋1 小時</button><button class="btn ghost" type="button" data-st-act="t-skipcool">跳過冷卻</button></div>` +
      `<div class="st-t-row"><span class="muted">${esc(fmtMD(d, false))}：</span><button class="btn ghost" type="button" data-st-act="t-variant" data-st-day="${d}" data-st-v="main" aria-pressed="${variantName(d) === 'main'}">主題</button><button class="btn ghost" type="button" data-st-act="t-variant" data-st-day="${d}" data-st-v="alt" aria-pressed="${variantName(d) === 'alt'}">備案</button><button class="btn ghost" type="button" data-st-act="t-resetday" data-st-day="${d}">重設這天</button><button class="btn ghost" type="button" data-st-act="t-preset" data-st-preset="clean">全部清掉</button></div>` +
      `<div class="st-t-row st-t-presets"><span class="muted">一鍵</span>${['before', 'day', 'mid', 'viewed', 'late', 'allDone', 'oneMissed', 'cooldown'].map((n) => `<button class="btn ghost" type="button" data-st-act="t-preset" data-st-preset="${n}" data-st-day="${d}">${n}</button>`).join('')}</div>` +
      `<div class="st-t-row"><button class="btn ghost" type="button" data-st-act="t-selftest">跑判定測資</button><span class="st-t-selftest mono muted"></span></div>`;
  }
  function testAction(act, t) {
    const p = testPanel && testPanel.panel;
    if (act === 't-close') { p.hidden = true; return; }
    if (act === 't-apply') { const v = $('.st-t-input', p).value.trim(); if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) setSim(v); else api.toast('格式 YYYY-MM-DDTHH:MM:SS'); renderTestPanel(); return; }
    if (act === 't-off') { setSim(null); urlNow = null; renderTestPanel(); return; }
    if (act === 't-time') { setSim(t.dataset.stTime); renderTestPanel(); return; }
    if (act === 't-plus') { const j = jstOf(stNow() + (+t.dataset.stMin) * 60000); setSim(`${j.date}T${j.hhmm}:${pad2(j.sec)}`); renderTestPanel(); return; }
    if (act === 't-skipcool') { Object.values(prog.days).forEach((dr) => Object.values(dr.v || {}).forEach((vr) => { vr.lockUntil = 0; Object.values(vr.stages || {}).forEach((s) => { s.lockUntil = 0; Object.values(s.parts || {}).forEach((pp) => { pp.lockUntil = 0; }); }); })); saveProg(); refreshSheet(false); api.toast('冷卻已清掉'); return; }
    if (act === 't-variant') { const d = t.dataset.stDay; const dr = dayRec(d); if (dr && dr.stamp) { api.toast('已蓋章，先重設這天'); return; } ctl.variant[d] = t.dataset.stV; saveCtl(); afterTimeChange(); renderTestPanel(); return; }
    if (act === 't-resetday') { const d = t.dataset.stDay; delete prog.days[d]; saveProg(); afterTimeChange(); renderTestPanel(); api.toast(`${fmtMD(d, false)} 已重設`); return; }
    if (act === 't-preset') { const ok = presetApply(t.dataset.stPreset, t.dataset.stDay, null, null); if (ok) { api.toast(`已套用 ${t.dataset.stPreset}`); renderTestPanel(); } return; }
    if (act === 't-selftest') { const out = $('.st-t-selftest', p); out.textContent = '跑中…'; selftest().then((r) => { out.textContent = r.text; }); }
  }
  async function selftest() {
    let vec;
    try { const r = await fetch(new URL('../tools/stamps_vectors.json', location.href).href, { cache: 'no-store' }); vec = await r.json(); } catch (e) { return { ok: 0, total: 0, text: '抓不到 tools/stamps_vectors.json' }; }
    const diffs = []; let total = 0, ok = 0;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const chk = (name, got, exp) => { total++; if (same(got, exp)) ok++; else diffs.push(`${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`); };
    (vec.normalize || []).forEach((c) => { chk(`norm full ${c.in}`, normalize(c.in, 'full'), c.full); chk(`norm light ${c.in}`, normalize(c.in, 'light'), c.light); });
    (vec.tc || []).forEach((c) => chk(`tc ${c.in}`, normalize(c.in, 'tc'), c.out));
    for (const c of vec.hash || []) chk(`hash ${c.value}`, await sha(c.salt, c.value), c.hex);
    (vec.parse || []).forEach((c) => chk(`parse ${c.mode} ${c.in}`, parseValue(normalize(c.in, 'full'), c.mode), c.out));
    const checks = vec.checks || [];
    for (const c of vec.evaluate || []) { const inp = checks[c.input]; const r = await evaluate(inp.check, c.raw, c.at, c.parse || inp.parse || null); chk(`eval ${c.input} ${c.raw}`, r, c.expect); }
    for (const c of vec.parts || []) { const inp = checks[c.input]; const r = await evaluateParts(inp, c.values, c.at); chk(`parts ${c.input} ${JSON.stringify(c.values)}`, r, c.expect); }
    const text = `${ok}／${total} 相同${diffs.length ? '；不同：' + diffs.slice(0, 5).join(' | ') : ''}`;
    console.log(`[stamps selftest] ${ok}/${total}` + (diffs.length ? '\n' + diffs.join('\n') : ''));
    return { ok, total, diffs, text };
  }
  let pendingPreset = null;   // 網址的 stPreset 要等資料（天數、題目）到了才能套
  function applyUrlParams() {
    if (!api.IS_LOCAL) return;
    const P = api.params;
    const n = P.get('now'); if (n && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(n)) { const ms = jstMs(n); if (!Number.isNaN(ms)) urlNow = ms; }
    const preset = P.get('stPreset');
    if (preset) {
      const nowArg = n && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(n) ? n : null;
      pendingPreset = { name: preset, day: P.get('stDay'), variant: P.get('stVariant'), now: nowArg };
      ['stPreset', 'stDay', 'stVariant'].forEach(dropParam);
      if (ST) applyPendingPreset();
    } else if (urlNow) { api.store.del(KEYS.sim); }
    if (P.get('stSelftest')) setTimeout(() => selftest(), 300);
  }
  function applyPendingPreset() {
    if (!pendingPreset || !ST) return;
    const p = pendingPreset; pendingPreset = null;
    try { presetApply(p.name, p.day, p.variant, p.now); } catch (e) { console.error('[stamps] preset', e); }
  }
  function dropParam(name) {
    try { const parts = location.search.replace(/^\?/, '').split('&').filter(Boolean); const keep = parts.filter((kv) => decodeURIComponent(kv.split('=')[0]) !== name); if (keep.length === parts.length) return; history.replaceState(history.state, '', location.pathname + (keep.length ? '?' + keep.join('&') : '') + location.hash); } catch (e) { /* ignore */ }
  }

  // ───────────────────────── 對外介面（spec §8.1） ─────────────────────────
  window.FJStamps = {
    init(a) {
      api = a; loadStore(); bindEvents();
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }
      if (api.IS_LOCAL) { applyUrlParams(); buildTestPanel(); }
    },
    onData(st) {
      ST = st && st.days && st.common ? st : null; C = ST ? ST.common : null;
      lastTabSig = null;
      if (!ST && api) api.syncTabs();
      if (ST) applyPendingPreset();
    },
    onPhotos(status) {
      photosState = status || 'ready'; photosDone = true;
      // 已畫在畫面上的遮罩補上圖
      $$('.st-mask[data-st-asset]').forEach((e) => { const id = e.dataset.stAsset; const u = api.photoUrl(id); if (u && !e.style.maskImage) { e.style.webkitMaskImage = `url("${u}")`; e.style.maskImage = `url("${u}")`; e.classList.remove('st-noimg'); if (!e.style.backgroundColor || e.style.backgroundColor === 'transparent') e.style.backgroundColor = 'var(--ink)'; } });
      $$('.st-loading').forEach((e) => e.remove());
      if (sheetState && sheetState.stages.length) sheetState.stages.forEach((u) => { (u.mounts || []).forEach((m) => { try { m.refresh && m.refresh(); } catch (e) { /* ignore */ } }); if (u.handle && u.handle.refresh) { try { u.handle.refresh(); } catch (e) { /* ignore */ } } });
      if (api && api.getUi().tab === 'stamps' && $('#view')) { lastTabSig = null; renderTab($('#view')); }
    },
    photosReady: () => photosDone,
    tabVisible, badge, tabIcon, topbar, renderTab, nowCardHtml, sheetHtml, sheetMounted, sheetUnmounted, simIso,
    tabLabel: () => (C ? C.tabLabel : ''),
    tick() {
      if (!ST) return;
      // 分頁出現／紅點／「現在」頁任務卡有變（9:00 到了、ping、蓋章）→ 自己翻過去，不用重新整理
      const sig = `${tabVisible() ? 1 : 0}|${badge() ? 1 : 0}|${nowCardHtml()}`;
      if (sig !== lastBadge) {
        const first = lastBadge === null; lastBadge = sig;
        if (!first) { try { api.syncTabs(); if (api.getUi().tab === 'now') api.render(false); } catch (e) { /* ignore */ } }
      }
      if (api.getUi().tab === 'stamps' && $('#view')) { const ts = tabSig(); if (ts !== lastTabSig) renderTab($('#view')); }
      refreshSheet(false);
    },
    // 給測試與整合用
    _: { stNow, dayState, selftest, presetApply, setSim, normalize, evaluate, evaluateParts, get prog() { return prog; }, get ctl() { return ctl; }, get data() { return ST; } },
  };
})();

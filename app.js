/* 日本告別之旅 — iPhone 主畫面 App（PWA）主程式 v2
 * 純原生 JS、不用框架、不用 CDN。DOM 結構見 briefs/v2-common.md 第 3 節（v1 約定沿用）。
 * 測試參數：?now=2026-12-12T14:30（模擬現在）、?data=../test/data.test.enc、?photos=../test/photos.test.enc、
 *          ?wxtest=d1212（天氣預覽，會存進設定）、?css=…（只在 localhost 有效）
 */
(function () {
  'use strict';

  // ───────────────────────── 常數 ─────────────────────────
  const APP_VERSION = '2026-11-09.4';
  const CACHE_NAME = 'fj-' + APP_VERSION;           // 必須與 sw.js 的 CACHE 相同
  const PHOTO_CACHE = 'fj-photos';                  // 照片密文的快取，改版不刪
  const SALT_B64 = 'qEM+Nnu2l1V8dK89NBB7VA==';       // 必須與 tools/encrypt.html 相同
  const PBKDF2_ITER = 310000;
  const DEFAULT_DATA_URL = './data.enc';
  const DEFAULT_PHOTOS_URL = './photos.enc';
  const WX_MAX_AGE = 60 * 60 * 1000;
  const DATA_CHECK_EVERY = 60 * 60 * 1000;
  const NAV_RESTORE_MS = 10 * 60 * 1000;
  const END_GRACE_MIN = 120;
  const NIGHT_AFTER_MIN = 60;
  const NIGHT_FROM = 21 * 60;
  const MORNING_FROM = 6 * 60;
  const DOW = ['日', '一', '二', '三', '四', '五', '六'];
  const KEYS = { key: 'fj.key', todo: 'fj.todo', wx: 'fj.wx', sim: 'fj.sim', nav: 'fj.nav', hint: 'fj.hint', wxtest: 'fj.wxtest', places: 'fj.places' };
  const FLAG_LABEL = { cash: '只收現金', noic: '不能刷 IC 卡', ticket: '要先買票／抽號', noyk: '不能預約' };
  const KIND_LABEL = { spot: '景點', food: '餐廳', coffee: '咖啡', hotel: '住宿', transit: '車站' };
  const WMO = {
    0: ['晴', 'sun'], 1: ['晴時多雲', 'sun-cloud'], 2: ['多雲', 'cloud-sun'], 3: ['陰', 'cloud'],
    45: ['霧', 'fog'], 48: ['霧', 'fog'],
    51: ['毛毛雨', 'drizzle'], 53: ['毛毛雨', 'drizzle'], 55: ['毛毛雨', 'drizzle'], 56: ['凍雨', 'drizzle'], 57: ['凍雨', 'drizzle'],
    61: ['小雨', 'rain'], 63: ['雨', 'rain'], 65: ['大雨', 'heavy-rain'], 66: ['凍雨', 'rain'], 67: ['凍雨', 'heavy-rain'],
    71: ['小雪', 'snow'], 73: ['雪', 'snow'], 75: ['大雪', 'snow'], 77: ['霰', 'snow'],
    80: ['陣雨', 'showers'], 81: ['陣雨', 'showers'], 82: ['強陣雨', 'heavy-rain'], 85: ['陣雪', 'snow'], 86: ['陣雪', 'snow'],
    95: ['雷雨', 'thunder'], 96: ['雷雨冰雹', 'thunder'], 99: ['雷雨冰雹', 'thunder'],
  };

  // inline SVG 圖示（24px 畫布、線寬 1.75）
  const svg = (body, cls) => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICON = {
    tabNow: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 'tab-icon'),
    tabDays: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 'tab-icon'),
    tabPlaces: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>', 'tab-icon'),
    tabInfo: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>', 'tab-icon'),
    pin: svg('<path d="M12 22s7-7.1 7-12a7 7 0 1 0-14 0c0 4.9 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>', 'icon'),
    route: svg('<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8 17h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5"/>', 'icon'),
    refresh: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>', 'icon'),
    phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>', 'icon'),
    warn: svg('<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.5"/>', 'icon'),
    train: svg('<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>', 'move-icon'),
    ship: svg('<path d="M2 18c2 2 4 2 6 0s4-2 6 0 4 2 6 0M4 16l1-5h14l1 5M12 11V4M9 7h6"/>', 'move-icon'),
    thermo: svg('<path d="M10 14V5a2 2 0 0 1 4 0v9a3.5 3.5 0 1 1-4 0z"/>', 'icon'),
    umbrella: svg('<path d="M3 12a9 9 0 0 1 18 0H3zM12 12v7a2 2 0 0 0 4 0"/>', 'icon'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', 'icon'),
    chevron: svg('<path d="M9 6l6 6-6 6"/>', 'icon'),
    cloudSmall: svg('<path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.3 3.3 0 0 1 17 18H7z"/>', 'icon'),
  };
  const KIND_ICON = {
    spot: svg('<path d="M4 20h16M6 20V9l6-5 6 5v11M10 20v-6h4v6"/>', 'ph-icon'),
    food: svg('<path d="M4 12h16a8 8 0 0 1-16 0zM12 8V5M8 9l-1-3M16 9l1-3"/>', 'ph-icon'),
    coffee: svg('<path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9zM16 10h2a2 2 0 0 1 0 4h-2M8 6V4M11 6V4"/>', 'ph-icon'),
    hotel: svg('<path d="M3 18V8M3 14h18v4M7 11a2 2 0 1 1 0-.1M11 11h8a2 2 0 0 1 2 2v1"/>', 'ph-icon'),
    transit: svg('<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>', 'ph-icon'),
  };
  const CLOUD = '<path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.3 3.3 0 0 1 17 18H7z"/>';
  const CLOUD_HI = '<path d="M7 15a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.3 3.3 0 0 1 17 15H7z"/>';
  const SUN_SMALL = '<circle cx="7" cy="7" r="2.5"/><path d="M7 2v1.5M7 10.5V12M2 7h1.5M10.5 7H12M3.5 3.5l1 1M9.5 9.5l1 1M3.5 10.5l1-1M9.5 4.5l1-1"/>';
  const WX_ICON = {
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    'sun-cloud': SUN_SMALL + '<path d="M10 20a3.5 3.5 0 0 1-.4-7 4.8 4.8 0 0 1 9.3 1.3A2.9 2.9 0 0 1 18.5 20H10z"/>',
    'cloud-sun': SUN_SMALL + '<path d="M9 21a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.3 3.3 0 0 1 19 21H9z"/>',
    'cloud': CLOUD,
    'fog': '<path d="M4 9h16M3 13h18M5 17h14"/>',
    'drizzle': CLOUD_HI + '<path d="M9 18v1.5M12 19.5v1.5M15 18v1.5"/>',
    'rain': CLOUD_HI + '<path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
    'heavy-rain': CLOUD_HI + '<path d="M7 18l-1.5 4M10.5 18L9 22M14 18l-1.5 4M17.5 18L16 22"/>',
    'snow': CLOUD_HI + '<circle cx="8.5" cy="19.5" r=".9" fill="currentColor"/><circle cx="12" cy="21" r=".9" fill="currentColor"/><circle cx="15.5" cy="19.5" r=".9" fill="currentColor"/>',
    'showers': SUN_SMALL + '<path d="M10 17a3.5 3.5 0 0 1-.4-7 4.8 4.8 0 0 1 9.3 1.3A2.9 2.9 0 0 1 18.5 17H10z"/><path d="M11 19l-1 3M14.5 19l-1 3M18 19l-1 3"/>',
    'thunder': CLOUD_HI + '<path d="M12.5 16l-2.5 4h3l-1.5 3.5"/>',
  };
  const wxIcon = (k) => svg(WX_ICON[k] || WX_ICON.cloud, 'wx-icon');

  // ───────────────────────── 小工具 ─────────────────────────
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stripTags = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const params = new URLSearchParams(location.search);
  const DATA_URL = params.get('data') ? new URL(params.get('data'), location.href).href : DEFAULT_DATA_URL;
  const PHOTOS_URL = params.get('photos') ? new URL(params.get('photos'), location.href).href : DEFAULT_PHOTOS_URL;
  const PHOTOS_FORCED = !!params.get('photos');
  const IS_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (params.get('css') && IS_LOCAL) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = params.get('css'); document.head.appendChild(l);
  }
  function validSim(s) {            // 2 號 #25：檢查範圍
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    const [, y, mo, d, h, mi] = m.map(Number);
    if (y < 2020 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  }
  let urlSim = validSim(params.get('now'));
  function dropParam(name) {        // 5 號 S8：套用設定頁的值時拿掉網址參數；2 號 v2 #12：只刪那一個，其他參數原樣保留
    try {
      const parts = location.search.replace(/^\?/, '').split('&').filter(Boolean);
      const keep = parts.filter((kv) => decodeURIComponent(kv.split('=')[0].replace(/\+/g, ' ')) !== name);
      if (keep.length === parts.length) return;
      history.replaceState(history.state, '', location.pathname + (keep.length ? '?' + keep.join('&') : '') + location.hash);
    } catch (e) { /* ignore */ }
  }

  // ───────────────────────── 狀態 ─────────────────────────
  let data = null, encBlob = null, cryptoKey = null, swReg = null;
  let days = [], dayById = {}, dayByDate = {}, cardByPlace = {}, stayByPlace = {};
  const ui = { tab: 'now', day: null, placesMode: 'day', placesQuery: '' };
  let tickTimer = null, lastState = null, lastDataCheck = 0, updateWorker = null;
  const wxState = { busy: false, lastError: false, jmaOk: true };
  const photoUrls = {};
  const photoState = { status: 'none', count: 0, bytes: 0, loaded: 0, total: 0, msg: '' };
  const sheet = { stack: [], scrollY: 0, trigger: null, after: null };

  // ───────────────────────── 時間（全部用日本時間） ─────────────────────────
  function jstParts(d) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const o = {}; p.forEach((x) => { o[x.type] = x.value; });
    if (o.hour === '24') o.hour = '00';
    return o;
  }
  const realToday = () => { const o = jstParts(new Date()); return `${o.year}-${o.month}-${o.day}`; };
  function simValue() {
    if (IS_LOCAL && window.FJStamps) { const s = FJStamps.simIso(); if (s) return s; }   // 集章分頁的模擬時鐘（只在 localhost；stamps.js 掛鉤 1）
    return urlSim || validSim(store.get(KEYS.sim, null));
  }
  function getNow() {
    const sim = simValue();
    if (sim) return { date: sim.slice(0, 10), min: +sim.slice(11, 13) * 60 + +sim.slice(14, 16), sec: 0, sim: true };
    const o = jstParts(new Date());
    return { date: `${o.year}-${o.month}-${o.day}`, min: +o.hour * 60 + +o.minute, sec: +o.second, sim: false };
  }
  const jstClock = (ms) => { const o = jstParts(new Date(ms)); return `${o.hour}:${o.minute}`; };
  const jstStamp = (ms) => { const o = jstParts(new Date(ms)); return `${+o.month}/${+o.day} ${o.hour}:${o.minute}`; };
  const tmin = (t) => (t == null ? null : +t.slice(0, 2) * 60 + +t.slice(3, 5));
  const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const dayIndex = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
  const isoFromIndex = (i) => { const d = new Date(i * 86400000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
  const addDays = (iso, n) => isoFromIndex(dayIndex(iso) + n);
  const dowOf = (iso) => DOW[new Date(dayIndex(iso) * 86400000).getUTCDay()];
  const fmtMD = (iso, withDow = true) => { const [, m, d] = iso.split('-'); return `${+m}/${+d}` + (withDow ? `（${dowOf(iso)}）` : ''); };
  const nowLabel = (now) => `${fmtMD(now.date)} ${fmtMin(now.min)}`;

  // ───────────────────────── 行程判斷 ─────────────────────────
  function setData(d) {
    data = d; days = d.days; dayById = {}; dayByDate = {}; cardByPlace = {}; stayByPlace = {};
    days.forEach((day, i) => {
      day.idx = i; dayById[day.id] = day; dayByDate[day.date] = day;
      day.spots.forEach((s) => { if (s.place && !cardByPlace[s.place]) cardByPlace[s.place] = { type: 'spot', item: s, day: day.id }; });
      day.food.forEach((f) => { if (f.place && !cardByPlace[f.place]) cardByPlace[f.place] = { type: 'food', item: f, day: day.id }; });
    });
    (d.stays || []).forEach((s) => { stayByPlace[s.place] = s; });
    if (window.FJStamps) FJStamps.onData(d.stamps || null);   // stamps.js 掛鉤 3
  }
  function lastRowMin(day) { let m = null; day.rows.forEach((r) => { const t = tmin(r.t); if (t != null && (m == null || t > m)) m = t; }); return m; }
  function phase(now) {
    const n = dayIndex(now.date), s = dayIndex(data.trip.start), e = dayIndex(data.trip.end);
    if (n < s) return 'before';
    if (n > e) return 'after';
    if (n === e) { const last = lastRowMin(days[days.length - 1]); if (last != null && now.min >= last + END_GRACE_MIN) return 'after'; }
    return 'during';
  }
  function stepState(day, now) {
    let cur = -1;
    day.rows.forEach((r, i) => { const t = tmin(r.t); if (t != null && t <= now.min) cur = i; });
    let next = -1;
    for (let i = cur + 1; i < day.rows.length; i++) { const t = tmin(day.rows[i].t); if (t != null && t > now.min) { next = i; break; } }
    return { cur, next };
  }
  function isNight(day, now) {
    if (day.idx >= days.length - 1 || now.min < MORNING_FROM) return false;
    const last = lastRowMin(day);
    return now.min >= NIGHT_FROM || (last != null && now.min >= last + NIGHT_AFTER_MIN);
  }
  function defaultDayId(now) {
    const ph = phase(now);
    if (ph === 'before') return days[0].id;
    if (ph === 'after') return days[days.length - 1].id;
    return (dayByDate[now.date] || days[0]).id;
  }
  function countdown(row, now) {
    const diff = tmin(row.t) - now.min;
    const soft = row.approx || !row.move;
    let txt, cls = 'countdown';
    if (diff <= 1) { txt = '就是現在'; cls += ' urgent'; }
    else if (diff < 60) { txt = `還有 ${diff} 分`; if (diff <= 5) cls += ' urgent'; }
    else { txt = `還有 ${Math.floor(diff / 60)} 時 ${String(diff % 60).padStart(2, '0')} 分`; }
    if (soft) cls += ' soft';
    return `<span class="${cls}" aria-live="off">${soft ? '<span class="cd-prefix">預計</span>' : ''}${txt}</span>`;   // 「（模擬）」改放在「下一步」標籤旁（3 號 v2 #2）
  }
  function sinceText(row, now) { const d = now.min - tmin(row.t); return d > 0 && d <= 10 ? `· 剛過 ${d} 分` : ''; }   // 2 號 v2 #6：整點不顯示「剛過 0 分」
  // 「怎麼去」的方式（2 號 v2 #1）：搭車的列一律大眾運輸（船的列是走去碼頭）；不是移動的列看列裡有沒有走路，否則用目的地自己的 mode
  const goMode = (r, p) => (r.move ? (r.vehicle === 'ship' ? 'walking' : 'transit') : (r.mode === 'walking' ? 'walking' : ((p && p.mode) || 'transit')));

  // ───────────────────────── 地點、地圖、電話、標記 ─────────────────────────
  const mapSearch = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  const mapDir = (q, mode) => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q) + '&travelmode=' + (mode === 'walking' ? 'walking' : 'transit');
  const telHref = (s) => { const m = /\d[\d-]{6,}\d/.exec(String(s)); return m ? m[0] : String(s).replace(/[^\d+]/g, ''); };
  const TEL_RE = /(0\d{1,4}-\d{1,4}-\d{3,4})/g;
  function telify(html) {
    let inA = false;
    return String(html || '').split(/(<[^>]+>)/).map((seg) => {
      if (seg.startsWith('<')) { if (/^<a[\s>]/i.test(seg)) inA = true; else if (/^<\/a>/i.test(seg)) inA = false; return seg; }
      return inA ? seg : seg.replace(TEL_RE, '<a class="tel" href="tel:$1">$1</a>');
    }).join('');
  }
  const tagsHtml = (flags) => (flags || []).filter((f) => FLAG_LABEL[f]).map((f) => `<span class="tag ${f}">${FLAG_LABEL[f]}</span>`).join('');
  function firstSentence(html, max = 70) {
    const t = stripTags(html);
    const i = t.indexOf('。');
    let s = i > 0 ? t.slice(0, i) : t;
    if (s.length > max) s = s.slice(0, max) + '…';
    return esc(s);
  }
  function sentenceWith(html, re) {
    const parts = stripTags(html).split(/[。；]/);
    const hit = parts.find((p) => re.test(p));
    return esc(hit || parts[0] || '');
  }
  const P = (id) => (data && data.places[id]) || { name: id, kind: 'spot', city: '', query: id, mode: 'transit', inTrip: [] };
  const kindLabel = (p) => KIND_LABEL[p.kind] || '地點';
  function shortName(p) {
    let s = String(p.short || p.name).replace(/（[^）]*）/g, '').replace(/\s*[·]\s*.*$/, '').trim();
    if (s.length > 12) s = s.slice(0, 12) + '…';
    return s;
  }
  function phHtml(id, extra) {
    const p = P(id);
    return `<span class="ph${extra ? ' ' + extra : ''}" data-kind="${esc(p.kind)}" data-photo-id="${esc(id)}" aria-hidden="true">${KIND_ICON[p.kind] || KIND_ICON.spot}<span class="ph-city">${esc(p.city || '')}</span></span>`;
  }
  function thumbHtml(id, extra) {
    const u = photoUrls[id];
    if (u) return `<img class="${extra === 'ph-lg' ? 'sheet-img' : 'thumb'}" src="${u}" alt="" loading="lazy">`;
    return phHtml(id, extra === 'ph-lg' ? 'ph-lg' : 'thumb');
  }
  function hydratePhotos(root) {
    $$('[data-photo-id]', root || document).forEach((el) => {
      const u = photoUrls[el.dataset.photoId]; if (!u) return;
      const img = document.createElement('img'); img.className = el.classList.contains('ph-lg') ? 'sheet-img' : 'thumb'; img.src = u; img.alt = ''; img.loading = 'lazy';
      el.replaceWith(img);
    });
  }
  function addrHtml(address, query) {
    if (address) return `<div class="place-addr"><span class="addr" lang="ja" data-copy="${esc(address)}">${esc(address)}</span><button class="btn ghost copy" type="button" data-copy="${esc(address)}">${ICON.copy}複製</button></div>`;
    return `<div class="place-addr muted">沒有地址 · 地圖用「<span lang="ja">${esc(query)}</span>」搜尋</div>`;
  }
  function placesOf(items) { const seen = new Set(), out = []; items.forEach((id) => { if (id && data.places[id] && !seen.has(id)) { seen.add(id); out.push(id); } }); return out; }
  function dayPlaceIds(day) {
    const ids = [];
    day.rows.forEach((r) => ids.push(...(r.places || [])));
    day.spots.forEach((s) => { ids.push(s.place); ids.push(...(s.altPlaces || [])); });
    day.food.forEach((f) => { ids.push(f.place); ids.push(...(f.altPlaces || [])); });
    if (day.sleep.stay) ids.push(day.sleep.stay);
    return placesOf(ids);
  }
  function pickHtml(ids) {
    return `<div class="step-pick" role="group" aria-label="選一個地點"><span class="pick-label">去哪裡？</span>${ids.map((id) => `<button class="pick" type="button" data-place="${esc(id)}">${esc(shortName(P(id)))}</button>`).join('')}</div>`;
  }

  // ───────────────────────── 時間軸 ─────────────────────────
  function stepHtml(r, state, idx) {
    const ids = r.places || [], openable = ids.length > 0;
    const cur = state === 'current';
    const names = ids.map((id) => P(id).name);
    const tags = tagsHtml(r.flags);
    return `<li class="step" data-state="${state}" data-row="${idx}"${openable ? ` data-places="${esc(ids.join(' '))}"` : ''}${r.move ? ` data-move="${r.vehicle || 'train'}"` : ''}${r.flags && r.flags.length ? ` data-flags="${r.flags.join(' ')}"` : ''}${cur ? ' aria-current="step"' : ''}>` +
      (openable ? `<button class="step-open" type="button" aria-label="${esc(r.tLabel)} ${esc(names.join('、'))}"></button>` : '') +
      `<span class="step-time mono">${esc(r.tLabel)}</span>` +
      `<div class="step-body">${r.move ? (r.vehicle === 'ship' ? ICON.ship : ICON.train) : ''}<div class="step-text">${telify(r.html)}</div>${r.fare ? `<div class="step-fare mono">${esc(r.fare)}</div>` : ''}${tags ? `<div class="step-tags">${tags}</div>` : ''}</div>` +
      (openable ? `<span class="step-chevron" aria-hidden="true">${ICON.chevron}</span>` : '') + '</li>';
  }
  // st：{cur,next} 時三態；opts.allPast 全部已過；opts.fold 把 current 之前的列收成「已過 N 步」
  function timelineHtml(day, st, opts = {}) {
    const rows = opts.rows || day.rows;
    let html = `<ol class="timeline${opts.cls ? ' ' + opts.cls : ''}">`;
    if (st && opts.fold && st.cur > 0) html += `<li class="past-fold"><button class="past-toggle" type="button" aria-expanded="false" data-n="${st.cur}">已過 ${st.cur} 步 ▸</button></li>`;
    html += rows.map((r, i) => {
      let state = 'future';
      if (st) state = i < st.cur ? 'past' : i === st.cur ? 'current' : 'future';
      else if (opts.allPast) state = 'past';
      return stepHtml(r, state, opts.rows ? day.rows.indexOf(r) : i);
    }).join('');
    return html + '</ol>';
  }
  function stepRowHtml(r) {
    return `<div class="step-row"><span class="step-time mono">${esc(r.tLabel)}</span><div class="step-text">${telify(r.html)}${tagsHtml(r.flags)}</div></div>`;
  }

  // ───────────────────────── 天氣 ─────────────────────────
  function wxtestId() { const v = store.get(KEYS.wxtest, null); return v && dayById[v] ? v : null; }
  function wxPlanFor(items, now) {
    const lead = dayIndex(items[0].date) - dayIndex(realToday());
    let available = true, msg = '';
    if (lead > 15 || lead < -1) {
      available = false;
      msg = now.sim && items[0].date !== days[0].date
        ? `模擬時間的日期（${fmtMD(items[0].date, false)}）離今天太遠，沒有預報（預報只有 16 天）。`
        : `${fmtMD(items[0].date, false)} 的預報大約 ${fmtMD(addDays(items[0].date, -15), false)} 起才會有。`;
    }
    const forecastDays = lead <= 1 ? 3 : Math.min(16, lead + 3);
    const points = new Set(), offices = new Set();
    items.forEach((it) => it.day.where.forEach((w) => {
      points.add(w.point); offices.add(data.points[w.point].jma.office);
      if (w.alt) { points.add(w.alt.point); offices.add(data.points[w.alt.point].jma.office); }
    }));
    const needJma = items.some((it) => dayIndex(it.date) - dayIndex(realToday()) <= 1);
    return { items, forecastDays, available, msg, points: [...points], offices: needJma ? [...offices] : [], lead };
  }
  function wxPlan(now) {
    const ph = phase(now);
    if (ph === 'after') return null;
    const items = [];
    const test = ph === 'before' ? wxtestId() : null;
    if (test) {
      const d = dayById[test];
      items.push({ day: d, date: now.sim ? now.date : realToday(), label: `今天（預覽：套 ${fmtMD(d.date, false)} 的行程）` });
      if (days[d.idx + 1]) items.push({ day: days[d.idx + 1], date: addDays(now.sim ? now.date : realToday(), 1), label: '明天（預覽）' });
    } else if (ph === 'before') {
      items.push({ day: days[0], date: days[0].date, label: '出發日' });
      if (dayIndex(days[1].date) - dayIndex(realToday()) <= 15) items.push({ day: days[1], date: days[1].date, label: '第 2 天' });
    } else {
      const d = dayByDate[now.date];
      items.push({ day: d, date: d.date, label: '今天' });
      if (days[d.idx + 1]) items.push({ day: days[d.idx + 1], date: days[d.idx + 1].date, label: '明天' });
    }
    const plan = wxPlanFor(items, now);
    plan.ph = ph; plan.test = !!test;
    return plan;
  }
  function coversPlan(c, plan) {
    if (!c || !c.om) return false;
    return plan.points.every((p) => c.om[p]) && plan.items.every((it) => { const t = c.om[plan.points[0]].time; return t.some((x) => x.startsWith(it.date)); });
  }
  async function fetchWeather(plan) {
    const pts = plan.points;
    const lat = pts.map((p) => data.points[p].lat).join(','), lon = pts.map((p) => data.points[p].lon).join(',');
    const elev = pts.map((p) => (data.points[p].elev == null ? 'nan' : data.points[p].elev)).join(',');   // 2 號 #14
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&elevation=${elev}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code&timezone=Asia%2FTokyo&forecast_days=${plan.forecastDays}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('open-meteo ' + r.status);
    const j = await r.json();
    const arr = Array.isArray(j) ? j : [j];
    const om = {};
    arr.forEach((x, i) => { if (x && x.hourly) om[pts[i]] = { time: x.hourly.time, temp: x.hourly.temperature_2m, feel: x.hourly.apparent_temperature, pop: x.hourly.precipitation_probability, code: x.hourly.weather_code }; });
    if (!Object.keys(om).length) throw new Error('open-meteo empty');
    const jma = {}; let jmaOk = true;
    for (const office of plan.offices) {
      try {
        const rr = await fetch(`https://www.jma.go.jp/bosai/forecast/data/forecast/${office}.json`);
        if (!rr.ok) throw new Error('jma ' + rr.status);
        const jj = await rr.json();
        const ts = (jj[0].timeSeries || []).find((t) => t.areas && t.areas[0] && t.areas[0].pops);
        if (ts) { const areas = {}; ts.areas.forEach((a) => { areas[a.area.code] = a.pops.map(Number); }); jma[office] = { timeDefines: ts.timeDefines, areas }; }
        else jmaOk = false;
      } catch (e) { jmaOk = false; }
    }
    const out = { at: Date.now(), om, jma, jmaOk };
    store.set(KEYS.wx, out);
    wxState.jmaOk = jmaOk;
    return out;
  }
  function modeCode(codes) { const cnt = {}; codes.forEach((c) => { cnt[c] = (cnt[c] || 0) + 1; }); return +Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || b - a)[0]; }
  function blockWx(w, date, from, to, pointId) {
    const om = w && w.om && w.om[pointId];
    if (!om) return null;
    const h1 = +from.slice(0, 2), h2 = +to.slice(0, 2);
    const hours = [];
    om.time.forEach((t, i) => {
      if (!t.startsWith(date)) return;
      const h = +t.slice(11, 13);
      if (h >= h1 && h < h2 && om.feel[i] != null) hours.push({ h, temp: om.temp[i], feel: om.feel[i], pop: om.pop[i] == null ? 0 : om.pop[i], code: om.code[i] == null ? 3 : om.code[i] });
    });
    if (!hours.length) return null;
    const code = modeCode(hours.map((x) => x.code));
    const feels = hours.map((x) => x.feel);
    let pop = null, popSrc = 'om';
    const pt = data.points[pointId], j = w.jma && w.jma[pt.jma.office];
    if (j && j.areas[pt.jma.area]) {
      const pops = j.areas[pt.jma.area], bs = dayIndex(date) * 1440 + h1 * 60, be = dayIndex(date) * 1440 + h2 * 60;
      j.timeDefines.forEach((td, i) => {
        const ss = dayIndex(td.slice(0, 10)) * 1440 + +td.slice(11, 13) * 60, se = ss + 360;
        if (ss < be && se > bs && pops[i] != null && !Number.isNaN(pops[i])) pop = pop == null ? pops[i] : Math.max(pop, pops[i]);
      });
      if (pop != null) popSrc = 'jma';
    }
    if (pop == null) pop = Math.max(...hours.map((x) => x.pop));
    const w2 = WMO[code] || ['多雲', 'cloud'];
    return { code, text: w2[0], icon: w2[1], pop, popSrc, feelMin: Math.round(Math.min(...feels)), feelMax: Math.round(Math.max(...feels)), hours };
  }
  const feelRange = (b) => (b.feelMin === b.feelMax ? `${b.feelMin}` : `${b.feelMin}–${b.feelMax}`);
  const deg = (v) => (v == null || Number.isNaN(v) ? '—' : `${Math.round(v)}°`);   // 2 號 #18
  function hoursTable(hours) {
    return '<table><thead><tr><th>時</th><th>天氣</th><th>降雨</th><th>體感</th><th>氣溫</th></tr></thead><tbody>' +
      hours.map((x) => { const w2 = WMO[x.code] || ['多雲', 'cloud']; return `<tr><td class="mono">${x.h}:00</td><td>${wxIcon(w2[1])}${w2[0]}</td><td class="mono">${x.pop}%</td><td class="mono">${deg(x.feel)}</td><td class="mono">${deg(x.temp)}</td></tr>`; }).join('') +
      '</tbody></table>';
  }
  function wxBlockHtml(x) {
    const b = x.b, pt = data.points[b.point], blk = x.blk;
    const time = `${b.from.slice(0, 2)}–${b.to.slice(0, 2)}`;
    const city = b.move ? `<span class="wx-move">移動中 →</span> ${esc(pt.name)}` : esc(pt.name);
    let html;
    if (!blk) {
      html = `<button class="wx-block" type="button" data-state="${x.state}" aria-expanded="false" disabled><span class="wx-time mono">${time}</span><span class="wx-city">${city}</span><span class="wx-cond muted">—</span></button>`;
    } else {
      html = `<button class="wx-block" type="button" data-state="${x.state}" aria-expanded="false" aria-controls="${x.id}">` +
        `<span class="wx-time mono">${time}</span><span class="wx-city">${city}</span>` +
        `<span class="wx-cond">${wxIcon(blk.icon)}<span>${blk.text}</span></span>` +
        `<span class="wx-pop mono${blk.pop >= 50 ? ' hi' : ''}" title="${blk.popSrc === 'jma' ? '氣象廳' : 'Open-Meteo'}">${blk.pop}%</span>` +
        `<span class="wx-feel">體感 ${feelRange(blk)}°</span></button>` +
        `<div class="wx-hours" id="${x.id}" hidden>${hoursTable(blk.hours)}</div>`;
    }
    if (b.alt) {
      const ap = data.points[b.alt.point], a = x.alt;
      const atime = `${b.alt.from.slice(0, 2)}–${b.alt.to.slice(0, 2)}`;
      html += `<div class="wx-alt"><span class="wx-time mono">${atime}</span> <span class="wx-city">${esc(ap.name)}${ap.elev ? `（${ap.elev} m）` : ''}</span> ` +
        (a ? `<span class="wx-cond">${wxIcon(a.icon)}<span>${a.text}</span></span> <span class="wx-pop mono">${a.pop}%</span> <span class="wx-feel">體感 ${feelRange(a)}°</span>${a.feelMin <= 3 ? `<span class="wx-cold">${ICON.thermo}山上很冷</span>` : ''}` : '<span class="muted">—</span>') + '</div>';
    }
    return html;
  }
  function dayBlocks(it, w, now, pfx) {
    const isToday = now && it.date === now.date;
    return it.day.where.map((b, i) => {
      let state = 'future';
      if (isToday) state = now.min >= tmin(b.to) ? 'past' : now.min >= tmin(b.from) ? 'current' : 'future';
      return { b, state, id: `wx-${pfx}-${it.day.id}-${i}`, blk: blockWx(w, it.date, b.from, b.to, b.point), alt: b.alt ? blockWx(w, it.date, b.alt.from, b.alt.to, b.alt.point) : null };
    });
  }
  function daySummary(blocks) {
    const ok = blocks.filter((x) => x.blk);
    if (!ok.length) return '<span class="muted">還沒有預報</span>';
    const maxPop = Math.max(...ok.map((x) => x.blk.pop)), mn = Math.min(...ok.map((x) => x.blk.feelMin)), mx = Math.max(...ok.map((x) => x.blk.feelMax));
    const mid = ok[Math.floor(ok.length / 2)].blk;
    return `${wxIcon(mid.icon)}${mid.text} · 降雨最高 <b class="mono${maxPop >= 50 ? ' hi' : ''}">${maxPop}%</b> · 體感 ${mn === mx ? mn : mn + '–' + mx}°`;
  }
  function wxStatus(w) {
    if (!w) return navigator.onLine ? '還沒有天氣資料' : '離線 · 還沒有天氣資料';
    if (!navigator.onLine) return `離線 · 顯示 ${jstStamp(w.at)} 的預報`;
    if (wxState.lastError) return `目前無法更新，顯示 ${jstStamp(w.at)} 的資料`;
    return `更新於 ${jstClock(w.at)}`;
  }
  function wxDayHtml(it, w, now, opts) {
    const blocks = dayBlocks(it, w, now, opts.pfx || 'x');
    const head = `<span class="wx-day-h"><span class="wx-day-label">${esc(it.label)} <span class="mono">${fmtMD(it.date)}</span></span>${opts.status ? `<button class="wx-updated${wxState.busy ? ' busy' : ''}" type="button" data-act="wx-refresh">${ICON.refresh}${esc(opts.status)}</button>` : ''}</span>`;
    let inner;
    if (opts.collapsePast) {
      const past = blocks.filter((x) => x.state === 'past'), rest = blocks.filter((x) => x.state !== 'past');
      inner = past.length ? `<details class="wx-past"><summary>已過 ${past.map((x) => x.b.from.slice(0, 2) + '–' + x.b.to.slice(0, 2)).join('、')}</summary>${past.map(wxBlockHtml).join('')}</details>` : '';
      inner += rest.map(wxBlockHtml).join('');
      if (!rest.length && past.length) inner += '<p class="muted">今天的時段都過了。</p>';
    } else inner = blocks.map(wxBlockHtml).join('');
    if (opts.summaryOnly) return `<details class="wx-day wx-tomorrow"><summary>${head}<span class="wx-sum">${daySummary(blocks)}</span></summary>${inner}</details>`;
    return `<div class="wx-day">${head}${inner}</div>`;
  }
  function wxSrc(w) {
    if (!w) return '資料：氣象廳、Open-Meteo.com';
    return w.jmaOk ? '資料：氣象廳（降水確率）、Open-Meteo.com（天氣、體感）' : '資料：Open-Meteo.com（氣象廳暫時無法取得）';
  }
  // mode: 'now'（今天收起已過、明天一行摘要）／'full'／'tomorrow'（只給一天、不顯示更新鈕）
  function wxSectionHtml(plan, now, mode, pfx) {
    if (!plan) return '';
    const w = store.get(KEYS.wx, null);
    if (plan.available === false) {
      const hint = plan.ph === 'before' && !plan.test ? `<button class="btn ghost wxprev-link" type="button" data-act="go-wxprev">想看天氣版面？開天氣預覽 ›</button>` : '';
      return `<section class="wx" aria-label="天氣"><div class="wx-day"><span class="wx-day-h"><span class="wx-day-label">天氣</span></span><p class="muted">${esc(plan.msg)}</p>${hint}</div></section>`;
    }
    const status = wxStatus(w);
    let html = '<section class="wx" aria-label="天氣">';
    plan.items.forEach((it, i) => {
      const first = i === 0;
      if (mode === 'now') html += wxDayHtml(it, w, now, { status: first ? status : null, collapsePast: first, summaryOnly: !first, pfx });
      else if (mode === 'tomorrow') html += wxDayHtml(it, w, now, { status: null, pfx });
      else html += wxDayHtml(it, w, now, { status: first ? status : null, pfx });
    });
    html += `<div class="wx-src">${wxSrc(w)}</div></section>`;
    return html;
  }
  function todayMaxPop(day, date) {
    const w = store.get(KEYS.wx, null);
    if (!w) return null;
    const pops = day.where.map((b) => blockWx(w, date, b.from, b.to, b.point)).filter(Boolean).map((b) => b.pop);
    return pops.length ? Math.max(...pops) : null;
  }
  async function refreshWeather(opts = {}) {
    if (wxState.busy || !data) return;
    const now = getNow(), plan = wxPlan(now);
    if (!plan) { if (!opts.silent) toast('旅程結束了，不再更新天氣'); return; }
    if (!plan.available) { if (!opts.silent) toast(plan.msg); return; }           // 2 號 #12
    const c = store.get(KEYS.wx, null);
    if (!opts.force && c && Date.now() - c.at < WX_MAX_AGE && coversPlan(c, plan)) return;
    if (!navigator.onLine) { if (!opts.silent) toast(c ? `離線，顯示 ${jstStamp(c.at)} 的預報` : '離線，還沒有天氣資料'); return; }
    wxState.busy = true; $$('.wx-updated').forEach((b) => b.classList.add('busy'));
    try {
      await fetchWeather(plan);
      wxState.lastError = false;
      if (!opts.silent) toast(wxState.jmaOk ? '天氣已更新' : '天氣已更新（氣象廳暫時無法取得）');
    } catch (e) {
      wxState.lastError = true;
      if (!opts.silent) toast(c ? `目前無法更新，顯示 ${jstStamp(c.at)} 的資料` : '目前無法更新天氣');
    } finally {
      wxState.busy = false;
      if (ui.tab === 'now') renderNow();
      else if (ui.tab === 'info') renderInfo();
    }
  }

  // ───────────────────────── 今天注意 ─────────────────────────
  function deadlineBits(r) {   // 從列文字抓 <mark class="deadline">，上下文往前找最近的標點切，再限 12 字（5 號 S3；2 號 v2 #5）
    const t = String(r.html).replace(/<mark class="deadline">/g, '\u0001').replace(/<\/mark>/g, '\u0002').replace(/<[^>]+>/g, '');
    const out = [];
    t.replace(/([^\u0001\u0002]{0,40})\u0001([^\u0002]*)\u0002/g, (m, ctx, mk) => {
      let c = ctx.split(/[、，；。（）「」]/).pop().trim();
      if (c.length > 12) c = '…' + c.slice(-11);
      out.push(`${esc(c)}<mark class="deadline">${esc(mk)}</mark>`); return m;
    });
    return out;
  }
  function warnItems(day, now, opts = {}) {
    const during = phase(now) === 'during';
    const cur = opts.isToday ? stepState(day, now).cur : -1;
    const notes = day.notes.filter((n) => !(during && n.pretrip));
    const checks = todoChecks();
    const items = [];
    const push = (cls, html, lead) => items.push({ cls, html, lead: stripTags(lead == null ? html : lead) });
    notes.filter((n) => n.kind === 'todo' && !(n.todo && checks[n.todo] === true)).forEach((n) => push('todo', `<b>待辦</b> ${telify(n.html)}`, `待辦 ${stripTags(n.html)}`));   // 2 號 v2 #3：打勾的不列
    notes.filter((n) => n.hard && n.kind !== 'todo').forEach((n) => push('hard', `<b>${esc(n.title)}</b> ${telify(n.html)}`, `${n.title} ${firstSentence(n.html)}`));
    day.rows.forEach((r, i) => { if (r.hard && i >= cur) push('hard', `<span class="mono">${esc(r.t || r.tLabel)}</span> ${telify(r.html)}`, `${r.t || r.tLabel} ${stripTags(r.html)}`); });
    notes.filter((n) => n.warn && !n.hard && n.kind !== 'todo').forEach((n) => push('warn', `<b>${esc(n.title)}</b> ${telify(n.html)}`, `${n.title} ${firstSentence(n.html)}`));
    day.rows.forEach((r, i) => {
      if (i < cur || r.hard) return;
      const fl = (r.flags || []).filter((f) => FLAG_LABEL[f]).map((f) => FLAG_LABEL[f]);
      const bits = deadlineBits(r);
      if (!fl.length && !bits.length) return;
      push('row', `<span class="mono">${esc(r.t || r.tLabel)}</span> ${[...fl.map(esc), ...bits].join('、')}`);
    });
    notes.filter((n) => !n.warn && !n.hard && (n.kind === 'luggage' || n.kind === 'ticket')).forEach((n) => push('note', `<b>${esc(n.title)}</b> ${telify(n.html)}`, `${n.title} ${firstSentence(n.html)}`));
    const maxPop = todayMaxPop(day, day.date);
    if (maxPop != null && maxPop >= 70) { const rain = day.extras.find((e) => e.rain); if (rain) push('rain', `<b>雨天備案</b> ${telify(rain.html)}`, `雨天備案 ${firstSentence(rain.html)}`); }
    (day.tickets || []).forEach((t) => push('ticket', `<b>票</b> ${esc(t)}`));
    return items;
  }
  function nowWarnHtml(day, now, opts = {}) {
    const items = warnItems(day, now, opts);
    if (!items.length) return '';
    const lead = items.slice(0, 2).map((i) => i.lead).join('；');
    return `<details class="now-warn"><summary>${ICON.warn}<span class="now-warn-text">${esc(lead)}</span><span class="more">更多</span></summary><ul>${items.map((i) => `<li class="${i.cls}">${i.html}</li>`).join('')}</ul></details>`;
  }

  // ───────────────────────── 「現在」 ─────────────────────────
  function stayCardHtml(day, tonight) {
    if (!day.sleep.stay) {
      const f = data.trip.flight;
      return `<section class="card stay-card flight"><div class="card-h">${tonight ? '今晚回東京' : '回程'}</div><div class="stay-name">${esc(f.no)} ${esc(f.dep)} → ${esc(f.arr)}</div><div class="stay-times">座位 ${esc(f.seats)} · ${esc(f.baggage)}</div><div class="stay-note muted">${esc(f.toAirport)}</div></section>`;
    }
    const s = stayByPlace[day.sleep.stay];
    return s ? stayHtml(s, tonight) : '';
  }
  function stayHtml(s, tonight) {
    const p = P(s.place);
    return `<section class="card stay-card" id="stay-${esc(s.id)}" data-places="${esc(s.place)}"><button class="card-open" type="button" aria-label="${esc(s.name)} 介紹"></button><span class="card-chevron" aria-hidden="true">${ICON.chevron}</span>` +
      `<div class="card-h">${tonight ? '今晚住 ' : ''}<span class="stay-dates mono">${esc(s.dates)}</span>${s.nights ? `<span class="muted"> ${s.nights} 晚</span>` : ''}</div>` +
      `<div class="stay-row">${thumbHtml(s.place)}<div class="stay-text"><div class="stay-name" lang="ja">${esc(s.name)}</div><div class="stay-times">入住 ${esc(s.checkin)} · 退房 ${esc(s.checkout)}</div><div class="stay-access muted">${esc(s.access)}</div></div></div>` +
      addrHtml(s.address, p.query) +
      `<div class="stay-phone"><a class="tel" href="tel:${telHref(s.phone)}">${ICON.phone}${esc(s.phone)}</a><button class="btn ghost copy" type="button" data-copy="${esc(telHref(s.phone))}">${ICON.copy}複製</button></div>` +
      `<a class="btn primary go-btn" href="${mapDir(p.query, p.mode)}" target="_blank" rel="noopener">${ICON.route}怎麼去 ›</a></section>`;
  }
  function tomorrowHtml(tm, today, now, open) {
    const during = phase(now) === 'during';
    const outRow = tm.rows.find((r) => /出門|退房/.test(stripTags(r.html))) || tm.rows[0];
    const notes = tm.notes.filter((n) => !(during && n.pretrip)).filter((n) => n.kind === 'todo' || n.warn || n.kind === 'luggage' || n.kind === 'ticket')
      .map((n) => `<li class="${n.kind === 'todo' ? 'todo' : n.hard ? 'hard' : ''}"><b>${esc(n.kind === 'todo' ? '待辦' : n.title)}</b> ${telify(n.html)}</li>`);
    const tonight = (today ? today.notes.filter((n) => n.tonight) : []).map((n) => `<li class="tonight"><b>今晚</b> ${sentenceWith(n.html, /前一晚|今晚|前一天晚上/)}</li>`);
    const plan = wxPlanFor([{ day: tm, date: tm.date, label: '明天' }], now);
    const first3 = tm.rows.slice(0, 3);
    return `<details class="now-tomorrow card"${open ? ' open' : ''}><summary><span class="card-h">明天 <span class="mono">${fmtMD(tm.date)}</span> · ${esc(tm.title)}</span><span class="tm-out">出門 <span class="mono">${esc(outRow.tLabel)}</span></span></summary>` +
      `<div class="tm-body">${first3.includes(outRow) ? '' : stepRowHtml(outRow)}${timelineHtml(tm, null, { cls: 'mini', rows: first3 })}` +
      wxSectionHtml(plan, now, 'tomorrow', 'tm') +
      (tonight.length || notes.length ? `<ul class="tm-notes">${tonight.join('')}${notes.join('')}</ul>` : '') +
      `<button class="btn ghost" type="button" data-go-day="${tm.id}">看明天全部</button></div></details>`;
  }
  function installHintHtml() {
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
    const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (!ios || standalone || store.get(KEYS.hint, false)) return '';
    return `<section class="card install-hint"><div class="card-h">加入主畫面</div><p>用 Safari 的「分享」→「加入主畫面」，之後像 App 一樣打開。加入後要在主畫面的 App 裡再輸入一次密碼。</p><button class="btn ghost" type="button" data-act="hint-close">知道了</button></section>`;
  }
  function todoItemHtml(t, state) {
    return `<li data-state="${state}"><label><input type="checkbox" data-todo="${t.id}"${state === 'done' ? ' checked' : ''}><span class="check-when mono">${esc(t.when)}${state === 'overdue' ? ' <b class="overdue-tag">已過</b>' : ''}</span><span class="check-text">${telify(t.html)}</span></label></li>`;
  }
  function todoChecks() {            // fj.todo 的打勾狀態：只認得現在資料裡有的待辦 id，舊版或對不到的 id 直接忽略
    const raw = store.get(KEYS.todo, {});
    if (!data || !raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const known = new Set(data.todo.map((t) => t.id)), out = {};
    Object.keys(raw).forEach((k) => { if (known.has(k)) out[k] = !!raw[k]; });
    return out;
  }
  function todoList(now) {
    const checks = todoChecks(), ti = dayIndex(now.date);
    const items = data.todo.map((t, i) => {
      const done = checks[t.id] != null ? !!checks[t.id] : !!t.done;
      const state = done ? 'done' : (t.due && dayIndex(t.due) < ti ? 'overdue' : 'open');
      return { t, state, due: t.due ? dayIndex(t.due) : Infinity, ord: i };
    });
    const rank = { overdue: 0, open: 1, done: 2 };
    items.sort((a, b) => rank[a.state] - rank[b.state] || a.due - b.due || a.ord - b.ord);   // 同日期照指南的順序（id 是雜湊，不能拿來排）
    return items;
  }
  function nextTodoHtml(now) {
    const top = todoList(now).filter((x) => x.state !== 'done').slice(0, 3);
    return `<section class="card next-todo"><h2 class="card-h">下一件待辦</h2>${top.length ? `<ul class="checklist">${top.map((x) => todoItemHtml(x.t, x.state)).join('')}</ul>` : '<p class="muted">待辦都完成了。</p>'}<button class="btn ghost" type="button" data-open-todo>全部待辦 ›</button></section>`;
  }
  function refreshTodoBits() {     // 2 號 v2 #4：在待辦子頁打勾、返回後，「下一件待辦」卡和「今天注意」要跟著變（不重畫整頁）
    if (!data || sheet.stack.length) return;
    const now = getNow(), ph = phase(now);
    const nt = $('#view .card.next-todo');
    if (nt) nt.outerHTML = nextTodoHtml(now);
    $$('#view details.now-warn').forEach((d) => {
      const sec = d.closest('section.day');
      const day = sec ? dayById[sec.dataset.day] : (ph === 'during' ? dayByDate[now.date] : null);
      if (!day) return;
      const tpl = document.createElement('template');
      tpl.innerHTML = nowWarnHtml(day, now, { isToday: ph === 'during' && day.date === now.date });
      const nd = tpl.content.firstElementChild;
      if (!nd) { d.remove(); return; }
      if (d.open) { nd.open = true; const m = $('.more', nd); if (m) m.textContent = '收起'; }
      d.replaceWith(nd);
    });
  }
  function preTripHtml(now) {
    const d0 = days[0], left = dayIndex(d0.date) - dayIndex(now.date), first = d0.rows[0];
    return `<section class="pretrip">` +
      `<section class="now-hero"><div class="now-date" aria-label="還有 ${left} 天">還有 <b class="mono">${left}</b> 天</div><div class="now-title"><span class="mono">${fmtMD(d0.date)} ${esc(first.tLabel)}</span> ${esc(stripTags(first.html))}</div></section>` +
      nextTodoHtml(now) +
      wxSectionHtml(wxPlan(now), now, 'full', 'pre') +
      `<section class="card checklist-card"><h2 class="card-h">出發前檢查</h2><ul class="plain"><li>兩支 iPhone 都用 Safari 打開網址 → 分享 → 加入主畫面，然後<b>在主畫面的 App 裡</b>輸入一次密碼（在 Safari 裡輸入的不算）。</li><li>第一次打開用 Wi‑Fi，照片會一次下載存進手機（資訊 → 設定可以看進度）。</li><li>出發前一週打開一次，看「資訊 → 設定」的版本是不是最新。</li><li>出發前把「模擬時間」和「天氣預覽」關掉。</li></ul></section></section>`;
  }
  function postTripHtml() {
    return `<section class="posttrip"><section class="now-hero"><div class="now-date">旅程結束</div><div class="now-title">${fmtMD(data.trip.start, false)}–${fmtMD(data.trip.end, false)}，13 天、12 晚。</div></section><p class="muted">行程、地點、住宿和票券都還看得到。</p><div class="map-actions"><button class="btn" type="button" data-go-tab="days">再看行程</button><button class="btn" type="button" data-go-tab="places">地點</button></div></section>`;
  }
  function cardOpenHtml(ids, label) {
    if (!ids || !ids.length) return '';
    return `<button class="card-open" type="button" aria-label="${esc(label)}"></button><span class="card-chevron" aria-hidden="true">${ICON.chevron}</span>`;
  }
  function duringHtml(now) {
    const day = dayByDate[now.date], st = stepState(day, now), night = isNight(day, now);
    const tm = days[day.idx + 1], cur = st.cur >= 0 ? day.rows[st.cur] : null, next = st.next >= 0 ? day.rows[st.next] : null;
    const maxPop = todayMaxPop(day, day.date);
    const tags = (maxPop != null && maxPop >= 50) ? `<span class="tag umbrella">${ICON.umbrella}帶傘（降雨最高 ${maxPop}%）</span>` : '';
    let html = `<section class="now-hero"><div class="now-sleep">${day.sleep.html}</div>${tags ? `<div class="hero-tags">${tags}</div>` : ''}</section>`;
    if (window.FJStamps) html += FJStamps.nowCardHtml();   // stamps.js 掛鉤 8：當日任務卡
    const curIds = cur ? (cur.places || []) : [];
    html += `<section class="now-current" aria-label="目前這一步"${curIds.length ? ` data-places="${esc(curIds.join(' '))}"` : ''}>${cardOpenHtml(curIds, '目前這一步的地點介紹')}<div class="step-label">現在 <span class="since">${cur ? sinceText(cur, now) : ''}</span></div>${cur ? stepRowHtml(cur) : '<div class="step-text muted">今天還沒開始</div>'}</section>`;
    if (night && tm) html += tomorrowHtml(tm, day, now, true);
    else if (next) {
      const ids = next.places || [];
      const goP = ids.length ? P(ids[ids.length - 1]) : null;
      const gm = goP ? goMode(next, goP) : null;
      html += `<section class="now-next" aria-label="下一步"${ids.length ? ` data-places="${esc(ids.join(' '))}"` : ''}>${cardOpenHtml(ids, '下一步的地點介紹')}<div class="step-label">下一步${now.sim ? '<span class="cd-sim">（模擬）</span>' : ''}</div>${countdown(next, now)}${stepRowHtml(next)}` +
        (goP ? `<a class="btn primary go-btn" href="${mapDir(goP.query, gm)}" target="_blank" rel="noopener">${ICON.route}怎麼去 ›<small>${esc(shortName(goP))}${gm === 'walking' ? '（走路）' : '（大眾運輸）'}</small></a>` : '') + '</section>';
    } else html += `<section class="now-next done" aria-label="下一步"><div class="step-label">下一步</div><div class="step-text muted">今天的行程走完了${tm ? `。明天 ${esc(tm.rows[0].tLabel)} ${esc(stripTags(tm.rows[0].html))}` : ''}</div></section>`;
    const p = day.rows.length ? (st.cur + 1) / day.rows.length : 0;
    html += `<div class="progress" style="--p:${p.toFixed(3)}" role="progressbar" aria-valuemin="0" aria-valuemax="${day.rows.length}" aria-valuenow="${st.cur + 1}"><span class="progress-text">今天 ${st.cur + 1}／${day.rows.length} 步</span></div>`;
    html += nowWarnHtml(day, now, { isToday: true });
    html += wxSectionHtml(wxPlan(now), now, 'now', 'now');
    html += `<h2 class="section-h">今天</h2>${timelineHtml(day, st, { fold: true })}`;
    html += stayCardHtml(day, true);
    if (!night && tm) html += tomorrowHtml(tm, day, now, false);
    return html;
  }
  function renderNow() {              // 5 號 M1：不自動捲動
    const now = getNow(), ph = phase(now);
    $('#view').innerHTML = installHintHtml() + (ph === 'before' ? preTripHtml(now) : ph === 'after' ? postTripHtml() : duringHtml(now));
    renderTopbar();
  }

  // ───────────────────────── 「行程」 ─────────────────────────
  function placeStripHtml(day) {
    const ids = dayPlaceIds(day);
    if (!ids.length) return '';
    return `<h3 class="section-h">這一天的地點</h3><div class="place-strip">${ids.map((id) => `<button class="place-thumb" type="button" data-place="${esc(id)}">${thumbHtml(id)}<span class="thumb-name" lang="ja">${esc(shortName(P(id)))}</span></button>`).join('')}</div>`;
  }
  function dayHtml(day, now) {
    const ph = phase(now), isToday = ph === 'during' && day.date === now.date;
    const st = isToday ? stepState(day, now) : null;
    const allPast = ph === 'after' || dayIndex(day.date) < dayIndex(now.date);
    const prev = days[day.idx - 1], next = days[day.idx + 1];
    return `<section class="day" data-day="${day.id}">` +
      `<header class="day-h"><div class="day-date mono">${fmtMD(day.date)} · Day ${day.day}</div><h2 class="day-title">${esc(day.title)}</h2><div class="day-sleep">${day.sleep.html}</div></header>` +
      `<div class="summary-wrap"><p class="summary clamp">${day.summary}</p><button class="btn ghost more" type="button" data-act="summary">全文</button></div>` +
      nowWarnHtml(day, now, { isToday }) +
      `<h3 class="section-h">時刻表</h3>${timelineHtml(day, st, { allPast, fold: isToday })}` +
      placeStripHtml(day) +
      (day.extras.length ? `<details class="extras"><summary>備案（${day.extras.length}）</summary>${day.extras.map((e) => `<div class="extra"><b>${esc(e.title)}</b>${e.meta ? ` <span class="muted">${esc(e.meta)}</span>` : ''}<div>${telify(e.html)}</div></div>`).join('')}</details>` : '') +
      (day.tickets.length ? `<details class="tickets"><summary>今天的票（${day.tickets.length}）</summary><ul class="plain">${day.tickets.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>` : '') +
      `<nav class="daynav" aria-label="換一天">${prev ? `<button class="btn ghost" type="button" data-go-day="${prev.id}">‹ ${fmtMD(prev.date, false)}</button>` : '<span></span>'}<button class="btn ghost" type="button" data-go-day="${defaultDayId(now)}">今天</button>${next ? `<button class="btn ghost" type="button" data-go-day="${next.id}">${fmtMD(next.date, false)} ›</button>` : '<span></span>'}</nav></section>`;
  }
  function renderDays(scrollToCurrent) {
    const now = getNow(), ph = phase(now), todayId = defaultDayId(now);
    if (!ui.day || !dayById[ui.day]) ui.day = todayId;
    const day = dayById[ui.day];
    const firstLabel = ph === 'during' ? ['今天', fmtMD(dayById[todayId].date, false)] : ph === 'before' ? [fmtMD(days[0].date, false), '出發'] : [fmtMD(days[days.length - 1].date, false), '最後'];
    const chips = `<div class="daychips" role="tablist" aria-label="選一天"><button class="chip chip-today" type="button" role="tab" data-day="${todayId}" aria-current="${ui.day === todayId}"><span class="chip-date">${firstLabel[0]}</span><span class="chip-dow">${firstLabel[1]}</span></button>` +
      days.map((d) => `<button class="chip" type="button" role="tab" data-day="${d.id}" aria-current="${ui.day === d.id}"><span class="chip-date mono">${fmtMD(d.date, false)}</span><span class="chip-dow">${d.dow}</span></button>`).join('') + '</div>';
    $('#view').innerHTML = chips + dayHtml(day, now);
    renderTopbar();
    const back = $('button.back-today');
    if (back) back.hidden = ui.day === todayId;
    const sel = $('.daychips .chip[aria-current="true"]:not(.chip-today)');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
    if (scrollToCurrent) {              // 5 號 S9：選到今天時捲到目前列
      const cur = $('li.step[data-state="current"]');
      if (cur) requestAnimationFrame(() => cur.scrollIntoView({ block: 'start' }));
    }
  }

  // ───────────────────────── 「地點」 ─────────────────────────
  function placeRowHtml(id, metaOverride) {
    const p = P(id), first = (p.inTrip || []).find((x) => x.t) || (p.inTrip || [])[0];
    const card = cardByPlace[id];
    const meta = metaOverride || [kindLabel(p), first ? `${fmtMD(dayById[first.day].date, false)}${first.t ? ' ' + first.t : ''}` : '', card && card.item.meta ? card.item.meta : ''].filter(Boolean).join(' · ');
    return `<li><button class="place-row" type="button" data-place="${esc(id)}">${thumbHtml(id)}<span class="place-row-text"><span class="place-row-name" lang="ja">${esc(p.name)}</span><span class="place-row-meta">${esc(meta)}</span></span><span class="chevron" aria-hidden="true">${ICON.chevron}</span></button></li>`;
  }
  function renderPlaces() {
    const now = getNow(), todayId = defaultDayId(now), q = ui.placesQuery.trim().toLowerCase();
    const match = (id) => { if (!q) return true; const p = P(id); return `${p.name} ${p.city} ${kindLabel(p)}`.toLowerCase().includes(q); };
    let html = `<div class="seg" role="group" aria-label="排法"><button type="button" data-mode="day" aria-pressed="${ui.placesMode === 'day'}">依天</button><button type="button" data-mode="kind" aria-pressed="${ui.placesMode === 'kind'}">依類別</button></div>` +
      `<input class="place-search" type="search" placeholder="找店名、地名" value="${esc(ui.placesQuery)}" aria-label="搜尋地點" autocomplete="off">`;
    let count = 0;
    if (ui.placesMode === 'day') {
      const start = dayById[todayId].idx;
      const order = [...days.slice(start), ...days.slice(0, start)];
      order.forEach((d) => {
        const ids = dayPlaceIds(d).filter(match);
        if (!ids.length) return;
        count += ids.length;
        html += `<h3 class="place-group-h">${fmtMD(d.date)} ${esc(d.title)}${d.id === todayId && phase(now) === 'during' ? '（今天）' : ''}</h3><ul class="place-list">${ids.map((id) => placeRowHtml(id)).join('')}</ul>`;
      });
    } else {
      const groups = [['spot', '景點'], ['food', '吃與喝'], ['coffee', '咖啡'], ['hotel', '住宿'], ['transit', '車站・碼頭']];
      const firstIdx = (id) => { const f = (P(id).inTrip || [])[0]; return f ? dayById[f.day].idx * 1440 + (tmin(f.t) || 0) : 9e9; };
      groups.forEach(([kind, label]) => {
        const ids = Object.keys(data.places).filter((id) => data.places[id].kind === kind && match(id)).sort((a, b) => firstIdx(a) - firstIdx(b));
        if (!ids.length) return;
        count += ids.length;
        html += `<h3 class="place-group-h">${label}（${ids.length}）</h3><ul class="place-list">${ids.map((id) => placeRowHtml(id)).join('')}</ul>`;
      });
    }
    if (!count) html += '<p class="empty">沒有符合的地點。</p>';
    $('#view').innerHTML = html;
    renderTopbar();
  }

  // ───────────────────────── 介紹頁 #sheet ─────────────────────────
  function factsHtml(p, stay) {
    const f = p.facts || {};
    const rows = [];
    // 飯店：入住／退房以訂房確認信（stays）為準，內容檔的 checkin／checkout 只在沒有 stays 時用；早餐、行李、洗衣是內容 A 的欄位
    const ci = (stay && stay.checkin) || f.checkin, co = (stay && stay.checkout) || f.checkout;
    if (ci) rows.push(['入住', esc(ci)]);
    if (co) rows.push(['退房', esc(co)]);
    if (f.hours) rows.push(['時間', esc(f.hours)]);
    if (f.price) rows.push(['費用', esc(f.price)]);
    if (f.pay) rows.push(['付款', esc(f.pay)]);       // 5 號 v2 S3（build 從 price 拆出）
    if (f.book) rows.push(['訂位', esc(f.book)]);
    if (f.breakfast) rows.push(['早餐', esc(f.breakfast)]);
    if (f.baggage) rows.push(['行李', esc(f.baggage)]);
    if (f.laundry) rows.push(['洗衣', esc(f.laundry)]);
    const card = cardByPlace[p.id];
    if (!f.hours && !f.price && card && card.item.meta) rows.push(['資料', esc(card.item.meta)]);
    const phone = f.phone || p.phone || (stay && stay.phone);
    if (phone) rows.push(['電話', `<a class="tel" href="tel:${telHref(phone)}">${ICON.phone}${esc(phone)}</a>`]);
    const addr = f.address || p.address;
    rows.push(['地址', addr ? `<span class="addr" lang="ja" data-copy="${esc(addr)}">${esc(addr)}</span><button class="btn ghost copy" type="button" data-copy="${esc(addr)}">${ICON.copy}複製</button>` : `<span class="muted">沒有地址 · 地圖用「<span lang="ja">${esc(p.query)}</span>」搜尋</span>`]);
    const access = f.access || (stay && stay.access);
    if (access) rows.push(['交通', esc(access)]);
    return `<section class="sheet-facts"><h3 class="section-h">實用資訊</h3><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></section>`;
  }
  function priceHtml(it) {          // 5 號 v2 S1／S2：大字只放一個數字，說明放小字；沒有數字的用灰字
    if (it.priceShort) return `<span class="item-price mono">${esc(it.priceShort)}</span>`;
    if (it.priceLabel) return `<span class="item-price unconfirmed">${esc(it.priceLabel)}</span>`;
    return it.price ? `<span class="item-price mono">${esc(it.price)}</span>` : '';
  }
  function itemsHtml(list, cls, title) {
    if (!Array.isArray(list) || !list.length) return '';
    return `<section class="${cls}"><h3 class="section-h">${title}</h3><ul>${list.map((it) => `<li><b class="item-name" lang="ja">${esc(it.name)}</b>${priceHtml(it)}${it.priceNote ? `<span class="item-price-note">${esc(it.priceNote)}</span>` : ''}${it.desc ? `<p class="item-desc">${esc(it.desc)}</p>` : ''}${it.where ? `<span class="item-where">${esc(it.where)}</span>` : ''}${it.src ? ` <a class="item-src" href="${esc(it.src)}" target="_blank" rel="noopener">來源</a>` : ''}</li>`).join('')}</ul></section>`;
  }
  function placeSheetHtml(id) {
    const p = Object.assign({ id }, P(id)), stay = stayByPlace[id] || null, card = cardByPlace[id];
    const first = (p.inTrip || []).find((x) => x.t) || (p.inTrip || [])[0];
    const when = first ? `${fmtMD(dayById[first.day].date)}${first.t ? ' ' + first.t : ''}` : '';
    let intro = p.intro || '';
    if (!intro) {
      // 沒有介紹時退回指南卡片；自己沒有卡片的（例如獅子岩展望台）用把它列為備選的那張卡
      const host = card || Object.values(cardByPlace).find((c) => (c.item.altPlaces || []).includes(id)) || null;
      if (host) intro = `<div class="place-desc">${telify(host.item.html)}</div>${host.item.alt ? `<div class="place-alt">${telify(host.item.alt)}</div>` : ''}${host !== card ? `<p class="muted">（取自「${esc(host.item.name)}」的指南卡片）</p>` : ''}`;
      else if (stay) intro = `<p>${esc(stay.note)}</p><p class="muted">入住、退房時間依訂房確認信；確認信沒寫的依飯店官網。</p>`;   // 2 號 v2 #11
      else intro = `<p class="muted">（介紹待補）</p>`;
    } else intro = telify(intro);
    const alts = card && card.item.altPlaces ? card.item.altPlaces.filter((a) => data.places[a]) : [];
    const intrip = (p.inTrip || []).map((x) => {   // 5 號 v2 S5：一行一筆，只放日期時刻
      const d = dayById[x.day]; if (!d) return '';
      const r = x.row != null ? d.rows[x.row] : null;
      return `<button type="button" data-goto="${esc(x.day)}:${x.row == null ? '' : x.row}"><span class="mono">${fmtMD(d.date)}${r ? ' ' + esc(r.tLabel) : ''}</span>${r ? '' : '<span class="intrip-note">這天的景點卡</span>'}<span class="intrip-arrow" aria-hidden="true">›</span></button>`;
    }).join('');
    const credit = [];
    if (p.photo && (p.photo.author || p.photo.license)) credit.push(`照片：${esc(p.photo.author || '')}${p.photo.license ? `／<a href="${esc(p.photo.licenseUrl || '#')}" target="_blank" rel="noopener">${esc(p.photo.license)}</a>` : ''}${p.photo.sourceUrl ? `（<a href="${esc(p.photo.sourceUrl)}" target="_blank" rel="noopener">來源</a>）` : ''}${p.photo.note ? ` · ${esc(p.photo.note)}` : ''}`);
    else if (photoUrls[id]) credit.push('照片：授權資料待補');
    if (Array.isArray(p.sources) && p.sources.length) credit.push('資料來源：' + p.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>`).join('、'));
    if (p.address && /https?:\/\//.test(p.addrSource || '')) credit.push(`地址來源：${(p.addrSource.match(/https?:\/\/\S+/g) || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, '').slice(0, 36))}</a>`).join('、')}`);
    const phone = (p.facts && p.facts.phone) || p.phone || (stay && stay.phone);
    const dirMode = p.mode === 'walking' ? '走路' : '大眾運輸';
    return `<header class="sheet-bar"><button class="sheet-back" type="button">‹ 返回</button><span class="sheet-bar-title" lang="ja">${esc(p.name)}</span></header>` +
      `<div class="sheet-scroll"><figure class="sheet-photo">${thumbHtml(id, 'ph-lg')}</figure>` +
      `<h2 class="sheet-title" lang="ja">${esc(p.name)}</h2>` +
      `<div class="sheet-chips"><span class="chip-kind">${kindLabel(p)}</span>${when ? `<span class="chip-when mono">${esc(when)}</span>` : ''}${p.city ? `<span class="chip-city">${esc(p.city)}</span>` : ''}</div>` +
      factsHtml(p, stay) +
      itemsHtml(p.buy, 'sheet-buy', '推薦買') + itemsHtml(p.signature, 'sheet-signature', p.kind === 'coffee' ? '招牌飲品' : '招牌菜') +
      `<section class="sheet-intro"><h3 class="section-h">介紹</h3>${intro}</section>` +
      (alts.length ? `<section class="sheet-alt"><h3 class="section-h">備選／附近</h3>${alts.map((a) => `<button type="button" data-place="${esc(a)}">${thumbHtml(a)}<span lang="ja">${esc(P(a).name)}</span></button>`).join('')}</section>` : '') +
      (intrip ? `<section class="sheet-intrip"><h3 class="section-h">在行程裡</h3>${intrip}</section>` : '') +
      (credit.length ? `<footer class="sheet-credit">${credit.join('<br>')}</footer>` : '') + '</div>' +
      `<nav class="sheet-actions"><a class="btn primary go" href="${mapDir(p.query, p.mode)}" target="_blank" rel="noopener">${ICON.route}怎麼去<small>${dirMode}</small></a><a class="btn ghost map" href="${mapSearch(p.query)}" target="_blank" rel="noopener">${ICON.pin}地圖</a></nav>`;   // 旅人 10/7：拿掉「撥號」（電話在實用資訊裡是 a.tel）
  }
  function todoSheetHtml() {
    const items = todoList(getNow());
    return `<header class="sheet-bar"><button class="sheet-back" type="button">‹ 返回</button><span class="sheet-bar-title">待辦</span></header>` +
      `<div class="sheet-scroll"><h2 class="sheet-title">待辦</h2><p class="todo-intro muted">打勾只存在這支手機。依日期排序，過期未完成的在最上面。</p><ul class="checklist">${items.map((x) => todoItemHtml(x.t, x.state)).join('')}</ul></div>`;
  }
  // mode：'push'（新開或往下堆一層：從右滑入）／'pop'（退回上一層：從左邊帶回來）；WAAPI，不靠 CSS transition（旅人 10/7：要真的滑）
  function renderSheet(mode) {
    const el = $('#sheet'), top = sheet.stack[sheet.stack.length - 1];
    if (!top) { el.classList.remove('open'); el.hidden = true; el.innerHTML = ''; return; }
    el.getAnimations().forEach((a) => a.cancel());        // 滑出到一半又打開：取消滑出
    if (window.FJStamps) FJStamps.sheetUnmounted();        // stamps.js 掛鉤 10：換頁時先收掉元件
    const isStamp = top.type === 'stamp' && window.FJStamps;
    el.innerHTML = isStamp ? FJStamps.sheetHtml(top) : top.type === 'todo' ? todoSheetHtml() : placeSheetHtml(top.id);
    el.setAttribute('aria-label', isStamp ? (FJStamps.tabLabel() || '任務') : top.type === 'todo' ? '待辦' : '介紹');   // 2 號 v2 #10
    el.hidden = false; el.classList.add('open');
    if (isStamp) FJStamps.sheetMounted(el, top);
    const sc = $('.sheet-scroll', el); if (sc) sc.scrollTop = 0;
    if (mode && !REDUCE()) {
      el.getBoundingClientRect();                           // 先排版，動畫才會從右邊開始
      const a = mode === 'push'
        ? el.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' })
        : el.animate([{ transform: 'translateX(-14%)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: 'ease-out' });
      setTimeout(() => { if (a.playState !== 'finished') { try { a.finish(); } catch (e) { /* ignore */ } } }, 660);   // 背景時動畫不前進：超時直接到定位
    }
    const back = $('.sheet-back', el); if (back) { try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); } }
  }
  function openSheet(entry, trigger) {
    if (!data) return;
    if (!sheet.stack.length) {
      sheet.scrollY = window.scrollY; sheet.trigger = trigger || document.activeElement;
      document.body.style.top = -sheet.scrollY + 'px';
      document.body.setAttribute('data-sheet-open', '1');
      try { $('#app').setAttribute('inert', ''); } catch (e) { /* ignore */ }   // 2 號 v2 #10：Tab 鍵不會走到底下的頁面
    }
    sheet.stack.push(entry);
    try { history.pushState({ fj: 'sheet', depth: sheet.stack.length }, ''); } catch (e) { /* ignore */ }
    renderSheet('push');
  }
  function closeSheetTo(depth) {
    let hadTodo = false;
    while (sheet.stack.length > Math.max(0, depth)) { const e = sheet.stack.pop(); if (e && e.type === 'todo') hadTodo = true; }
    if (!sheet.stack.length) {
      const el = $('#sheet');
      if (window.FJStamps) FJStamps.sheetUnmounted();   // stamps.js 掛鉤 10
      const finish = () => { if (sheet.stack.length) return; el.classList.remove('open'); el.hidden = true; el.innerHTML = ''; };   // 滑出時又開了新的就不收
      document.body.removeAttribute('data-sheet-open'); document.body.style.top = '';
      try { $('#app').removeAttribute('inert'); } catch (e) { /* ignore */ }
      window.scrollTo(0, sheet.scrollY);
      if (hadTodo) refreshTodoBits();
      const t = sheet.trigger; sheet.trigger = null;
      const f = t && document.contains(t) ? t : (hadTodo ? $('#view [data-open-todo]') : null);
      if (f && f.focus) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      const after = sheet.after; sheet.after = null; if (after) after();
      if (REDUCE()) finish();
      else {
        el.getAnimations().forEach((a) => a.cancel());
        const a = el.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], { duration: 220, easing: 'cubic-bezier(.4,0,1,1)' });
        a.finished.then(finish).catch(finish);          // 取消（又開了新的）也走 finish，裡面會看 stack 決定要不要收
        setTimeout(() => { if (a.playState !== 'finished' && !sheet.stack.length) { try { a.finish(); } catch (e) { finish(); } } }, 620);   // 背景時動畫不前進：超時直接收
      }
    } else renderSheet('pop');
  }
  function sheetBack() {
    if (history.state && history.state.fj === 'sheet' && history.state.depth === sheet.stack.length) history.back();
    else closeSheetTo(sheet.stack.length - 1);
  }
  function closeAllSheets(after) {
    if (!sheet.stack.length) { if (after) after(); return; }
    sheet.after = after || null;
    if (history.state && history.state.fj === 'sheet') history.go(-sheet.stack.length);
    else closeSheetTo(0);
  }
  function pickOrOpen(container, ids, trigger) {
    if (ids.length === 1) { openSheet({ type: 'place', id: ids[0] }, trigger); return; }
    const old = $('.step-pick', container);
    if (old && !old.dataset.closing) { slideOutRemove(old); return; }
    if (old) { stopAnim(old); old.remove(); }             // 收到一半又點：換成滑出來
    container.insertAdjacentHTML('beforeend', pickHtml(ids));
    slideIn($('.step-pick', container));
  }

  // ───────────────────────── 展開／收合動畫（WAAPI；旅人 10/7：要「滑出來」） ─────────────────────────
  const REDUCE = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ANIM_OPEN = 250, ANIM_CLOSE = 210;
  let infoIO = null, infoScroll = null, infoScrollT = null;
  const fadeAt = new WeakMap();          // 反轉時淡入淡出從目前的透明度接著播
  function stopAnim(el) {
    if (el._fjAnim) { el._fjAnim.cancel(); el._fjAnim = null; }
    (el._fjFades || []).forEach((a) => { const t = a.effect && a.effect.target; if (t) fadeAt.set(t, curOpacity(t)); a.cancel(); }); el._fjFades = [];
    el.style.overflow = ''; el.style.boxSizing = '';
  }
  function curOpacity(el) { const v = parseFloat(getComputedStyle(el).opacity); return Number.isNaN(v) ? 1 : v; }
  // 高度從 from 滑到 to（要連 padding 一起縮的傳 pads）；fades 裡的元素同時淡入／淡出；done 只在播完才叫（反轉時不叫）
  function runSlide(el, from, to, open, fades, done, pads) {
    el.style.overflow = 'hidden'; el.style.boxSizing = 'border-box';
    const kf = [{ height: from + 'px' }, { height: to + 'px' }];
    if (pads) { kf[0].paddingTop = pads.from[0] + 'px'; kf[0].paddingBottom = pads.from[1] + 'px'; kf[1].paddingTop = pads.to[0] + 'px'; kf[1].paddingBottom = pads.to[1] + 'px'; }
    const dur = open ? ANIM_OPEN : ANIM_CLOSE;
    const a = el.animate(kf, { duration: dur, easing: open ? 'cubic-bezier(.2,.8,.2,1)' : 'cubic-bezier(.4,0,.6,1)' });
    el._fjAnim = a; el._fjOpen = open;
    el._fjFades = (fades || []).map((f) => {
      const from = fadeAt.has(f) ? fadeAt.get(f) : (open ? 0 : 1);   // 剛從 hidden／display:none 出來的從 0 淡入
      fadeAt.delete(f);
      return f.animate([{ opacity: from }, { opacity: open ? 1 : 0 }], { duration: open ? dur : Math.round(dur * 0.8), easing: 'ease-out', fill: 'both' });
    });
    // 用 finished promise 收尾（頁面在背景時動畫不會前進，finish 事件也不會來）；超時就直接 finish()，狀態一定會收斂
    a.finished.then(() => { if (el._fjAnim !== a) return; el._fjAnim = null; (el._fjFades || []).forEach((f) => f.cancel()); el._fjFades = []; el.style.overflow = ''; el.style.boxSizing = ''; if (done) done(); }).catch(() => {});
    setTimeout(() => { if (el._fjAnim === a && a.playState !== 'finished') { try { a.finish(); } catch (e) { /* ignore */ } } }, dur + 400);
  }
  // <details>：開的時候先設 open 再播；關的時候播完才拿掉 open；播到一半再點就從目前高度反轉
  function animateDetails(d, open) {
    const summary = d.querySelector(':scope > summary');
    if (!summary || REDUCE()) { stopAnim(d); d.open = open; d.removeAttribute('data-anim'); return; }
    const from = d.getBoundingClientRect().height;
    stopAnim(d);
    d.open = true;                                          // 內容要在版面上才量得到
    const openH = d.offsetHeight;
    d.open = false; const closedH = d.offsetHeight; d.open = true;
    d.setAttribute('data-anim', open ? 'open' : 'close');
    const content = Array.from(d.children).filter((c) => c !== summary);
    runSlide(d, from, open ? openH : closedH, open, content, () => { d.open = open; d.removeAttribute('data-anim'); });
  }
  const detailsIsOpen = (d) => (d._fjAnim ? d._fjOpen : d.open);
  // 按鈕控制、用 hidden 開關的區塊（天氣逐小時表）
  function slideToggle(el, show) {
    if (REDUCE()) { stopAnim(el); el.hidden = !show; return; }
    const from = el.hidden ? 0 : el.getBoundingClientRect().height;
    const cs0 = getComputedStyle(el);
    const padFrom = el.hidden ? [0, 0] : [parseFloat(cs0.paddingTop) || 0, parseFloat(cs0.paddingBottom) || 0];
    stopAnim(el);
    el.hidden = false;
    const cs = getComputedStyle(el), pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    const full = el.offsetHeight;
    runSlide(el, from, show ? full : 0, show, [el], () => { if (!show) el.hidden = true; }, { from: padFrom, to: show ? [pt, pb] : [0, 0] });
  }
  // 剛插進去的區塊從 0 滑出（.step-pick）；滑回 0 之後移除
  function slideIn(el) {
    if (!el || REDUCE()) return;
    const cs = getComputedStyle(el), pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    runSlide(el, 0, el.offsetHeight, true, [el], null, { from: [0, 0], to: [pt, pb] });
  }
  function slideOutRemove(el) {
    if (!el || el.dataset.closing) return;
    el.dataset.closing = '1';
    if (REDUCE()) { stopAnim(el); el.remove(); return; }
    const from = el.getBoundingClientRect().height;
    const cs = getComputedStyle(el), padFrom = [parseFloat(cs.paddingTop) || 0, parseFloat(cs.paddingBottom) || 0];
    stopAnim(el);
    runSlide(el, from, 0, false, [el], () => el.remove(), { from: padFrom, to: [0, 0] });
  }
  // 時間軸「已過 N 步」：整個 ol 的高度滑動，已過的列淡入淡出（2 號 v2 #9 的文字一起換）
  function togglePast(ol, btn) {
    const wasOpen = ol.hasAttribute('data-past-open'), n = btn.dataset.n || '';
    const open = ol._fjAnim ? !ol._fjOpen : !wasOpen;
    btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? `收起已過的 ${n} 步 ▾` : `已過 ${n} 步 ▸`;
    if (REDUCE()) { stopAnim(ol); if (open) ol.setAttribute('data-past-open', '1'); else ol.removeAttribute('data-past-open'); return; }
    const from = ol.getBoundingClientRect().height;
    stopAnim(ol);
    ol.setAttribute('data-past-open', '1'); const openH = ol.offsetHeight;
    ol.removeAttribute('data-past-open'); const closedH = ol.offsetHeight;
    ol.setAttribute('data-past-open', '1');                 // 動畫期間已過的列都在版面上
    const rows = Array.from(ol.children).filter((li) => li.matches('li.step[data-state="past"]'));
    runSlide(ol, from, open ? openH : closedH, open, rows, () => { if (!open) ol.removeAttribute('data-past-open'); });
  }
  // 行程頁 summary 的「全文」／「收起」
  function toggleSummary(p, btn) {
    const expand = p._fjAnim ? !p._fjOpen : p.classList.contains('clamp');
    btn.textContent = expand ? '收起' : '全文';
    if (REDUCE()) { stopAnim(p); p.classList.toggle('clamp', !expand); return; }
    const from = p.getBoundingClientRect().height;
    stopAnim(p);
    p.classList.remove('clamp'); const full = p.offsetHeight;
    p.classList.add('clamp'); const clamped = p.offsetHeight;
    p.classList.remove('clamp');                            // 動畫期間顯示全文、靠 overflow 裁
    runSlide(p, from, expand ? full : clamped, expand, [], () => { if (!expand) p.classList.add('clamp'); });
  }
  // 資訊頁置頂的五顆鈕：IntersectionObserver 標「目前在哪一區」（旅人 10/7）
  function setInfoCurrent(id) { $$('#view .info-nav a[href^="#"]').forEach((a) => { if (a.getAttribute('href') === '#' + id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }); }
  function teardownInfoNav() {
    if (infoIO) { infoIO.disconnect(); infoIO = null; }
    if (infoScroll) { window.removeEventListener('scroll', infoScroll); infoScroll = null; }
    if (infoScrollT) { clearTimeout(infoScrollT); infoScrollT = null; }
  }
  function setupInfoNav() {
    teardownInfoNav();
    const nav = $('#view .info-nav'); if (!nav) return;
    const secs = $$('a[href^="#"]', nav).map((a) => $(a.getAttribute('href'))).filter(Boolean);
    if (!secs.length) return;
    const line = Math.round(nav.getBoundingClientRect().bottom) + 16;     // 置頂區塊的下緣（含橫幅、topbar、五顆鈕）＋ scroll-margin 的 12px
    const update = (visible) => {
      let cur = secs.find((s) => visible.has(s)) || null;                 // 區塊帶裡文件順序最前面的
      if (!cur) secs.forEach((s) => { if (s.getBoundingClientRect().top <= line) cur = s; });
      setInfoCurrent((cur || secs[0]).id);                                 // 還在最上面時就是第一區
    };
    const visible = new Set();
    // 捲動時也用幾何位置算一次（IO 沒通知到、或區塊很短時的保險）
    infoScroll = () => { if (infoScrollT) return; infoScrollT = setTimeout(() => { infoScrollT = null; if ($('#view .info-nav') === nav) update(visible); }, 80); };
    window.addEventListener('scroll', infoScroll, { passive: true });
    if ('IntersectionObserver' in window) {
      infoIO = new IntersectionObserver((entries) => {
        entries.forEach((en) => { if (en.isIntersecting) visible.add(en.target); else visible.delete(en.target); });
        update(visible);
      }, { rootMargin: `-${line}px 0px -${Math.max(0, Math.round(window.innerHeight * 0.55))}px 0px`, threshold: [0, 0.01] });
      secs.forEach((s) => infoIO.observe(s));
    }
    update(visible);
  }
  function gotoRow(dayId, row) {
    ui.tab = 'days'; ui.day = dayId; saveNav();
    render(false);
    if (row != null && row !== '') {
      const li = $(`li.step[data-row="${row}"]`);
      if (li) { const ol = li.closest('ol.timeline'); if (ol && li.dataset.state === 'past') ol.setAttribute('data-past-open', '1'); requestAnimationFrame(() => li.scrollIntoView({ block: 'center' })); }
    } else window.scrollTo(0, 0);
  }

  // ───────────────────────── 「資訊」 ─────────────────────────
  function photoStatusText() {
    const s = photoState;
    if (s.status === 'ready') return `照片 ${s.count} 張 · ${(s.bytes / 1048576).toFixed(1)} MB · 已存在手機`;
    if (s.status === 'loading') return s.total ? `下載中 ${Math.round(s.loaded / s.total * 100)}%（${(s.loaded / 1048576).toFixed(1)}／${(s.total / 1048576).toFixed(1)} MB）` : '下載中…';
    if (s.status === 'offline') return '離線，連上網路後會自動下載照片';
    if (s.status === 'error') return `照片無法使用：${s.msg}`;
    if (s.status === 'nofile') return '這版資料沒有照片';
    return '還沒下載照片';
  }
  function renderInfo() {
    const f = data.trip.flight, w = store.get(KEYS.wx, null), simv = store.get(KEYS.sim, '') || '', wt = wxtestId(), ph = phase(getNow());
    const navHtml = `<nav class="info-nav" aria-label="資訊分區"><a class="btn ghost" href="#info-stays">住宿</a><a class="btn ghost" href="#info-tickets">票券</a><a class="btn ghost" href="#info-contacts">聯絡</a><a class="btn ghost" href="#info-todo">待辦</a><a class="btn ghost" href="#info-settings">設定</a></nav>`;
    const stays = `<section class="info-sec" id="info-stays"><h2 class="section-h">住宿（${data.stays.length} 間）</h2>` + data.stays.map((s) => stayHtml(s, false)).join('') +
      `<section class="card stay-card flight"><div class="card-h"><span class="stay-dates mono">${fmtMD(f.date, false)}</span> 回程</div><div class="stay-name">${esc(f.no)} ${esc(f.dep)} → ${esc(f.arr)}</div><div class="stay-times">座位 ${esc(f.seats)}</div><div class="stay-note">${esc(f.baggage)}。${esc(f.toAirport)}</div></section></section>`;
    const tickets = `<section class="card" id="info-tickets"><h2 class="card-h">每天的票</h2>${days.map((d) => `<details class="day-tickets"><summary><span class="mono">${fmtMD(d.date)}</span> ${esc(d.title)}</summary><ul class="plain">${d.tickets.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>`).join('')}</section>`;
    const contacts = `<section class="card contacts" id="info-contacts"><h2 class="card-h">緊急聯絡</h2><ul class="contacts">${data.contacts.map((c) => `<li><span class="c-name">${esc(c.name)}</span><a class="tel" href="tel:${telHref(c.phone)}">${ICON.phone}<span class="mono">${esc(c.phone)}</span></a>${c.note ? `<span class="c-note muted">${esc(c.note)}</span>` : ''}</li>`).join('')}` +
      data.stays.map((s) => `<li><span class="c-name" lang="ja">${esc(s.name)}</span><a class="tel" href="tel:${telHref(s.phone)}">${ICON.phone}<span class="mono">${esc(s.phone)}</span></a></li>`).join('') + '</ul></section>';
    const todoSec = `<section class="card" id="info-todo"><h2 class="card-h">待辦</h2><p class="muted">${ph === 'before' ? '出發前的訂票與確認事項。' : '旅途中有日期的待辦會出現在那天的「今天注意」。'}</p><button class="btn" type="button" data-open-todo>打開待辦清單 ›</button></section>`;
    const settings = `<section class="card settings" id="info-settings"><h2 class="card-h">設定</h2>` +
      `<div class="setting sim"><label for="sim">模擬時間（預覽某天某時的畫面，日本時間）</label><input id="sim" type="datetime-local" value="${esc(simv)}" style="font-size:16px"><div class="setting-actions"><button class="btn" type="button" data-act="sim-apply">套用</button><button class="btn ghost" type="button" data-act="sim-clear"${simv || urlSim ? '' : ' disabled'}>關閉模擬</button></div>${urlSim ? '<p class="muted">目前用的是網址上的 ?now= 參數，只對這次有效（按「套用」會改用設定值）。</p>' : ''}</div>` +
      `<div class="setting wxprev"><label for="wxprev-day">天氣預覽（用今天的真實預報，套某一天的行程）</label><div class="setting-row"><select id="wxprev-day">${days.map((d) => `<option value="${d.id}"${wt === d.id ? ' selected' : ''}>${fmtMD(d.date)} ${esc(d.title)}</option>`).join('')}</select></div><div class="setting-actions"><button class="btn" type="button" data-act="wxprev-on"${ph !== 'before' ? ' disabled' : ''}>開啟預覽</button><button class="btn ghost" type="button" data-act="wxprev-off"${wt ? '' : ' disabled'}>關閉</button></div>${ph !== 'before' ? '<p class="muted">旅程開始後用真的預報，不需要預覽。</p>' : (wt ? `<p class="muted">預覽中：${fmtMD(dayById[wt].date)} 的行程。</p>` : '')}</div>` +
      `<div class="setting photos"><span class="photo-status">${esc(photoStatusText())}</span><div class="setting-actions"><button class="btn" type="button" data-act="photos-reload"${photoState.status === 'loading' || photoState.status === 'nofile' ? ' disabled' : ''}>重新下載照片</button></div></div>` +
      `<div class="setting"><button class="btn" type="button" data-act="wx-refresh">更新天氣</button><span class="muted">${w ? `上次更新 ${jstStamp(w.at)}` : '還沒有天氣資料'}</span></div>` +
      `<div class="setting"><button class="btn" type="button" data-act="check-update">檢查新版本</button><span class="muted update-note">${updateWorker ? '有新版本可用，重新開啟 App 即可。' : (lastDataCheck ? `上次檢查 ${jstStamp(lastDataCheck)}` : '')}</span></div>` +
      `<div class="setting"><button class="btn" type="button" data-act="relock">重新鎖定（清除金鑰）</button><span class="muted">下次打開要重新輸入密碼。</span></div>` +
      `<dl class="version"><dt>App 版本</dt><dd class="mono">${APP_VERSION}</dd><dt>資料版本</dt><dd class="mono">${esc(data.version)}（指南 ${esc(data.guideVersion || '')}）</dd><dt>照片版本</dt><dd class="mono">${esc(data.photos ? data.photos.ver : '—')}</dd><dt>資料檔</dt><dd class="mono">${esc(DATA_URL)}</dd><dt>現在（日本時間）</dt><dd class="mono">${esc(nowLabel(getNow()))}${getNow().sim ? '（模擬）' : ''}</dd></dl>` +
      `<p class="muted sources">資料來源：行程由指南 ${esc(data.guideVersion || '')} 轉出。天氣：氣象廳（6 小時降水確率）、Open-Meteo.com（逐小時天氣、體感溫度）。地圖與路線：Google Maps。照片：Wikimedia Commons 等可再散布的授權，作者與授權標在各介紹頁。行程資料與照片以加密檔存在這支手機；待辦打勾、天氣快取存在這支手機的瀏覽器儲存空間，不會同步到另一支。</p></section>`;
    $('#view').innerHTML = navHtml + stays + tickets + contacts + todoSec + settings;
    setupInfoNav();
    renderTopbar();
  }

  // ───────────────────────── 外框、分頁、橫幅 ─────────────────────────
  function renderTopbar() {
    let title = '告別之旅', sub = '';
    const now = getNow();
    let showRefresh = false;
    if (data) {
      const ph = phase(now);
      if (ui.tab === 'now') {
        if (ph === 'during') { const d = dayByDate[now.date]; title = `${fmtMD(d.date)} · Day ${d.day}`; sub = d.title; showRefresh = true; }
        else if (ph === 'before') { title = '出發前'; sub = `${fmtMD(data.trip.start)} 出發`; const plan = wxPlan(now); showRefresh = !!(plan && plan.available); }
        else { title = '旅程結束'; sub = `${fmtMD(data.trip.start, false)}–${fmtMD(data.trip.end, false)}`; }
      } else if (ui.tab === 'days') { title = '行程'; const d = dayById[ui.day]; sub = d ? `${fmtMD(d.date)} · ${d.title}` : ''; }
      else if (ui.tab === 'places') { title = '地點'; sub = `${Object.keys(data.places).length} 個地點 · 點開看介紹`; }
      else if (ui.tab === 'stamps' && window.FJStamps) { const t = FJStamps.topbar(); title = t.title; sub = t.sub; }   // stamps.js 掛鉤 7
      else { title = '資訊'; sub = '住宿、票券、聯絡、待辦、設定'; }
    }
    $('.topbar-title').textContent = title;
    $('.topbar-sub').innerHTML = esc(sub) + (navigator.onLine ? '' : '<span class="offline-pill">離線</span>');
    const btn = $('.topbar .icon-btn');
    btn.hidden = !showRefresh;      // 5 號 C6
    btn.setAttribute('aria-label', '更新天氣'); btn.dataset.act = 'wx-refresh'; btn.innerHTML = ICON.refresh;
    renderBanners(now);
  }
  function renderBanners(now) {
    const app = $('#app');
    let sb = $('.sim-banner');
    if (!now.sim) { if (sb) sb.remove(); document.body.removeAttribute('data-sim'); }
    else {
      if (!sb) { sb = document.createElement('div'); sb.className = 'sim-banner'; sb.setAttribute('role', 'status'); app.insertBefore(sb, app.firstChild); }
      document.body.setAttribute('data-sim', '1');
      sb.innerHTML = `${ICON.warn}<span class="sim-text">模擬時間 <b class="mono">${esc(nowLabel(now))}</b>${urlSim ? '（網址參數）' : ''}</span><button class="btn ghost" type="button" data-act="sim-clear">關閉</button>`;
    }
    let wb = $('.wx-preview-banner');
    const wt = data ? wxtestId() : null;
    if (!wt || phase(now) !== 'before') { if (wb) wb.remove(); if (wt && data && phase(now) !== 'before') store.del(KEYS.wxtest); }
    else {
      if (!wb) { wb = document.createElement('div'); wb.className = 'wx-preview-banner'; wb.setAttribute('role', 'status'); const anchor = $('.sim-banner'); app.insertBefore(wb, anchor ? anchor.nextSibling : app.firstChild); }
      wb.innerHTML = `${ICON.cloudSmall}<span class="wx-preview-text">天氣預覽：用今天的預報套 <b class="mono">${fmtMD(dayById[wt].date, false)}</b> 的行程</span><button class="btn ghost" type="button" data-act="wxprev-off">關閉</button>`;
    }
  }
  function saveNav() { store.set(KEYS.nav, { tab: ui.tab, day: ui.day, at: Date.now(), today: defaultDayId(getNow()) }); }
  // 集章分頁（stamps.js 掛鉤 4）：該出現時在 tabbar 最後加第 5 顆，不該出現時移除；紅點照 FJStamps.badge()
  function syncTabs() {
    const nav = $('nav.tabbar'); if (!nav) return;
    const show = !!(data && window.FJStamps && FJStamps.tabVisible());
    let btn = $('.tab[data-tab="stamps"]', nav);
    if (show) {
      if (!btn) {
        btn = document.createElement('button'); btn.className = 'tab'; btn.type = 'button'; btn.setAttribute('role', 'tab'); btn.dataset.tab = 'stamps';
        btn.innerHTML = FJStamps.tabIcon() + `<span class="tab-label">${esc(FJStamps.tabLabel())}</span><span class="st-dot" hidden></span>`;
        btn.addEventListener('click', () => setTab('stamps'));
        nav.appendChild(btn); nav.classList.add('st-5');
      }
      btn.setAttribute('aria-selected', String(ui.tab === 'stamps'));
      const dot = $('.st-dot', btn); if (dot) dot.hidden = !FJStamps.badge();
    } else {
      if (btn) { btn.remove(); nav.classList.remove('st-5'); }
      if (ui.tab === 'stamps') setTab('now');
    }
  }
  function render(scroll) {
    if (!data) return;
    if (ui.tab !== 'info') teardownInfoNav();
    if (ui.tab === 'stamps' && !(window.FJStamps && FJStamps.tabVisible())) ui.tab = 'now';
    if (ui.tab === 'now') renderNow();
    else if (ui.tab === 'days') renderDays(scroll);
    else if (ui.tab === 'places') renderPlaces();
    else if (ui.tab === 'stamps') { FJStamps.renderTab($('#view')); renderTopbar(); }   // stamps.js 掛鉤 5
    else renderInfo();
    syncTabs();
    $$('.tabbar .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === ui.tab)));
    const back = $('button.back-today'); if (back && ui.tab !== 'days') back.hidden = true;
  }
  function setTab(tab) {
    if (tab === ui.tab) { window.scrollTo({ top: 0, behavior: 'auto' }); if (tab === 'now') renderNow(); return; }
    ui.tab = tab;
    window.scrollTo(0, 0);
    render(false);
    saveNav();
    lastState = null;
    if (tab === 'now') tick(true);
  }
  function goDay(id) {
    const isToday = id === defaultDayId(getNow());
    ui.tab = 'days'; ui.day = id;
    window.scrollTo(0, 0);
    render(isToday);
    saveNav();
  }

  // ───────────────────────── 事件 ─────────────────────────
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('已複製'); return; } catch (e) { /* fallback */ }
    try {
      const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove();
      toast(ok ? '已複製' : '無法複製，請長按選取');
    } catch (e) { toast('無法複製，請長按選取'); }
  }
  function onAction(act, el) {
    if (act === 'wx-refresh') refreshWeather({ force: true });
    else if (act === 'sim-apply') {
      const v = validSim($('#sim') && $('#sim').value); if (!v) { toast('先選一個時間'); return; }
      store.set(KEYS.sim, v); urlSim = null; dropParam('now');
      ui.day = defaultDayId(getNow()); lastState = null; render(false); toast(`模擬時間 ${nowLabel(getNow())}`);
    } else if (act === 'sim-clear') {
      store.del(KEYS.sim); urlSim = null; dropParam('now');
      ui.day = defaultDayId(getNow()); lastState = null; render(false); toast('已關閉模擬時間');   // 2 號 #11
    } else if (act === 'wxprev-on') {
      const v = $('#wxprev-day') && $('#wxprev-day').value; if (!v || !dayById[v]) return;
      store.set(KEYS.wxtest, v); store.del(KEYS.wx); render(false); refreshWeather({ force: true, silent: true }); toast(`天氣預覽：${fmtMD(dayById[v].date, false)} 的行程`);
    } else if (act === 'wxprev-off') { store.del(KEYS.wxtest); store.del(KEYS.wx); render(false); refreshWeather({ silent: true }); toast('已關閉天氣預覽'); }
    else if (act === 'go-wxprev') {   // 2 號 v2 #8：等畫面畫好再捲、再給下拉選單焦點（不讓 focus 再捲一次）
      setTab('info');
      setTimeout(() => {
        const s = $('#info-settings'); if (s) s.scrollIntoView({ block: 'start' });
        const sel = $('#wxprev-day'); if (sel) { try { sel.focus({ preventScroll: true }); } catch (e) { sel.focus(); } }
      }, 80);
    }
    else if (act === 'photos-reload') { loadPhotos({ force: true }); }
    else if (act === 'check-update') { checkUpdates(true); }
    else if (act === 'relock') { store.del(KEYS.key); cryptoKey = null; toast('已清除金鑰，下次打開要重新輸入密碼'); setTimeout(() => location.reload(), 800); }
    else if (act === 'hint-close') { store.set(KEYS.hint, true); const c = el.closest('.install-hint'); if (c) c.remove(); }
    else if (act === 'summary') { const p = el.parentElement.querySelector('.summary'); if (p) toggleSummary(p, el); }
  }
  function bindEvents() {
    $$('.tabbar .tab').forEach((t) => { t.addEventListener('click', () => setTab(t.dataset.tab)); });
    // 旅人 10/7：<details> 要滑出來 → 攔截 summary 的點擊，自己開關＋播動畫（summary 裡的連結、按鈕照常）；資訊頁五顆鈕用捲動、不改網址
    document.addEventListener('click', (e) => {
      const s = e.target.closest('summary');
      if (s && s.parentElement && s.parentElement.tagName === 'DETAILS' && !e.target.closest('a, button, input, select')) {
        e.preventDefault();
        const d = s.parentElement, open = !detailsIsOpen(d);
        animateDetails(d, open);
        if (d.matches('details.now-warn')) { const m = $('.more', d); if (m) m.textContent = open ? '收起' : '更多'; }
        return;
      }
      const link = e.target.closest('.info-nav a[href^="#"]');
      if (link) {
        e.preventDefault();
        const target = $(link.getAttribute('href'));
        if (target) { setInfoCurrent(target.id); target.scrollIntoView({ block: 'start', behavior: REDUCE() ? 'auto' : 'smooth' }); }
      }
    }, true);
    document.addEventListener('click', (e) => {
      const t = e.target.closest('.sheet-back, .step-open, .card-open, .past-toggle, [data-goto], [data-open-todo], [data-place], [data-act], [data-go-tab], [data-go-day], [data-copy], .wx-block, .chip, .seg > button, a[href^="https://www.google.com/maps"]');
      const openPick = $('.step-pick:not([data-closing])');     // 5 號 v2 S8：點別處就收起地點選擇（同一列的按鈕由 pickOrOpen 自己開關）
      if (openPick && !e.target.closest('.step-pick')) {
        const own = t && (t.matches('.step-open') || t.matches('.card-open')) && t.closest('[data-places]') === openPick.parentElement;
        if (!own) slideOutRemove(openPick);
      }
      if (!t) return;
      if (t.matches('a[href^="https://www.google.com/maps"]')) { if (!navigator.onLine) toast('需要網路才能開地圖'); return; }
      if (t.matches('.sheet-back')) { sheetBack(); return; }
      if (t.matches('.step-open') || t.matches('.card-open')) {
        const box = t.closest('[data-places]'); if (!box) return;
        pickOrOpen(box, box.dataset.places.split(' ').filter(Boolean), t); return;
      }
      if (t.matches('.past-toggle')) {   // 2 號 v2 #9：展開後文字與箭頭也要變
        const ol = t.closest('ol.timeline');
        if (ol) togglePast(ol, t);
        return;
      }
      if (t.dataset.goto != null) { const [d, r] = t.dataset.goto.split(':'); closeAllSheets(() => gotoRow(d, r)); return; }
      if (t.hasAttribute('data-open-todo')) { openSheet({ type: 'todo' }, t); return; }
      if (t.dataset.place) {
        const pk = t.closest('.step-pick');     // 5 號 v2 S8：選完就收起，返回時焦點回到那一列
        const trig = pk ? (pk.parentElement.querySelector('.step-open, .card-open') || t) : t;
        openSheet({ type: 'place', id: t.dataset.place }, trig);
        if (pk) slideOutRemove(pk);
        return;
      }
      if (t.dataset.act) { e.preventDefault(); onAction(t.dataset.act, t); return; }
      if (t.dataset.goTab) { setTab(t.dataset.goTab); return; }
      if (t.dataset.goDay) { goDay(t.dataset.goDay); return; }
      if (t.dataset.copy != null) { copyText(t.dataset.copy); return; }
      if (t.matches('.chip')) { goDay(t.dataset.day); return; }
      if (t.matches('.seg > button')) { ui.placesMode = t.dataset.mode; store.set(KEYS.places, ui.placesMode); renderPlaces(); return; }
      if (t.matches('.wx-block')) {
        const open = t.getAttribute('aria-expanded') === 'true';
        t.setAttribute('aria-expanded', String(!open));
        const h = t.nextElementSibling; if (h && h.classList.contains('wx-hours')) slideToggle(h, !open);
      }
    });
    document.addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-todo]');
      if (!cb) return;
      const checks = todoChecks(); checks[cb.dataset.todo] = cb.checked; store.set(KEYS.todo, checks);   // 存回去時順便把對不到的舊 id 清掉
      const li = cb.closest('li'); if (li) { const t = data.todo.find((x) => x.id === cb.dataset.todo); li.dataset.state = cb.checked ? 'done' : (t && t.due && dayIndex(t.due) < dayIndex(getNow().date) ? 'overdue' : 'open'); }
    });
    document.addEventListener('input', (e) => {
      const s = e.target.closest('input.place-search'); if (!s) return;
      ui.placesQuery = s.value;
      const pos = s.selectionStart; renderPlaces(); const ns = $('input.place-search'); if (ns) { ns.focus(); try { ns.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } }
    });
    document.addEventListener('toggle', (e) => {
      const d = e.target; if (!d.matches || !d.matches('details.now-warn')) return;
      const m = $('.more', d); if (m) m.textContent = d.open ? '收起' : '更多';
    }, true);
    const back = document.createElement('button'); back.type = 'button'; back.className = 'back-today btn'; back.hidden = true; back.textContent = '回到今天';
    back.addEventListener('click', () => goDay(defaultDayId(getNow())));
    $('#app').appendChild(back);
    const wake = () => { if (!data) return; tick(false); refreshWeather({ silent: true }); checkUpdates(false); if (photoState.status === 'offline' || photoState.status === 'none') loadPhotos({ silent: true }); };   // 2 號 #10
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    window.addEventListener('pageshow', wake);
    window.addEventListener('focus', () => { if (data) tick(false); });
    window.addEventListener('online', () => { if (ui.tab === 'now') renderNow(); else renderTopbar(); refreshWeather({ silent: true }); if (photoState.status !== 'ready') loadPhotos({ silent: true }); });   // 5 號 S7
    window.addEventListener('offline', () => { if (ui.tab === 'now') renderNow(); else renderTopbar(); });
    window.addEventListener('popstate', (e) => {
      const depth = e.state && e.state.fj === 'sheet' ? e.state.depth : 0;
      if (depth < sheet.stack.length) closeSheetTo(depth);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.stack.length) sheetBack(); });
  }

  // ───────────────────────── 每 30 秒重算 ─────────────────────────
  function tick(force) {
    if (!data) return;
    if (window.FJStamps) { try { FJStamps.tick(); } catch (e) { console.error('[stamps] tick', e); } }   // stamps.js 掛鉤 9
    syncTabs();
    if (ui.tab !== 'now') { renderTopbar(); return; }
    const now = getNow(), ph = phase(now);
    let key = ph;
    if (ph === 'during') { const d = dayByDate[now.date], st = stepState(d, now); key = `${d.id}:${st.cur}:${st.next}:${isNight(d, now)}`; }
    if (force || key !== lastState) { lastState = key; renderNow(); return; }
    if (ph === 'during') {
      const d = dayByDate[now.date], st = stepState(d, now);
      const cd = $('.now-next .countdown'); if (cd && st.next >= 0) cd.outerHTML = countdown(d.rows[st.next], now);
      const since = $('.now-current .since'); if (since && st.cur >= 0) since.textContent = sinceText(d.rows[st.cur], now);
    }
  }
  function startTick() { if (tickTimer) clearInterval(tickTimer); tickTimer = setInterval(() => tick(false), 30000); }

  // ───────────────────────── Toast ─────────────────────────
  let toastTimer = null;
  function toast(msg, opts = {}) {
    let el = $('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); $('#app').appendChild(el); }
    el.innerHTML = `<span class="toast-msg">${esc(msg)}</span>${opts.action ? `<button class="btn ghost" type="button">${esc(opts.action.label)}</button>` : ''}`;
    if (opts.action) el.querySelector('button').addEventListener('click', () => { hideToast(); opts.action.fn(); });
    el.hidden = false; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, opts.ms || (opts.action ? 8000 : 2500));
  }
  function hideToast() { const el = $('.toast'); if (el) { el.classList.remove('show'); el.hidden = true; } }

  // ───────────────────────── 加密／鎖定 ─────────────────────────
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64ToBytes = (b) => { const s = atob(b); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
  const bytesToB64 = (a) => { let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
  async function deriveKey(pw, iter) {
    const km = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64ToBytes(SALT_B64), iterations: iter || PBKDF2_ITER, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  const importRaw = (b64) => crypto.subtle.importKey('raw', b64ToBytes(b64), { name: 'AES-GCM' }, true, ['decrypt']);
  async function decryptBlob(key, blob) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(blob.iv), tagLength: 128 }, key, b64ToBytes(blob.ct));
    return JSON.parse(dec.decode(pt));
  }
  function showLock(note) {
    const lock = $('#lock'); lock.hidden = false;
    $('.lock-note').textContent = note || '只需要輸入一次，之後這支手機會記住。';
    $('.lock-error').hidden = true;
    setTimeout(() => { try { $('#pass').focus(); } catch (e) { /* ignore */ } }, 50);
  }
  function hideLock() { $('#lock').hidden = true; }
  function bindLock() {
    $('#pass-show').addEventListener('change', (e) => { $('#pass').type = e.target.checked ? 'text' : 'password'; });
    $('#lock form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('#pass').value, btn = $('#unlock'), err = $('.lock-error');
      if (!pw) return;
      if (!window.crypto || !crypto.subtle) { err.textContent = '這個瀏覽器無法解密（需要 https 或 localhost）。'; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = '解密中…'; err.hidden = true;
      try {
        const key = await deriveKey(pw, encBlob.iter);
        const d = await decryptBlob(key, encBlob);
        cryptoKey = key;
        const raw = await crypto.subtle.exportKey('raw', key);
        if (!store.set(KEYS.key, bytesToB64(new Uint8Array(raw)))) toast('無法記住金鑰（瀏覽器儲存被停用），下次要再輸入');
        setData(d); hideLock(); $('#pass').value = ''; start();
      } catch (ex) {
        err.textContent = '密碼不對，再試一次'; err.hidden = false;
      } finally { btn.disabled = false; btn.textContent = '解鎖'; }
    });
  }

  // ───────────────────────── 照片（photos.enc → fj-photos 快取 → 解密 → Blob URL） ─────────────────────────
  function setPhotoStatus(status, extra) {
    photoState.status = status; Object.assign(photoState, extra || {});
    const el = $('.photo-status'); if (el) el.textContent = photoStatusText();
    const btn = $('[data-act="photos-reload"]'); if (btn) btn.disabled = status === 'loading' || status === 'nofile';
    if (window.FJStamps && (status === 'ready' || status === 'nofile' || status === 'error')) FJStamps.onPhotos(status);   // stamps.js 掛鉤 11：照片解好、或確定沒有照片
  }
  async function fetchWithProgress(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !r.body.getReader) return r.arrayBuffer();
    const reader = r.body.getReader(), chunks = []; let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.length;
      setPhotoStatus('loading', { loaded, total });
    }
    const out = new Uint8Array(loaded); let o = 0; chunks.forEach((c) => { out.set(c, o); o += c.length; });
    return out.buffer;
  }
  async function loadPhotos(opts = {}) {
    if (!data || !cryptoKey || photoState.status === 'loading') return;
    const expected = data.photos && data.photos.ver ? data.photos.ver : null;
    if (!expected && !PHOTOS_FORCED) { setPhotoStatus('nofile'); return; }
    let buf = null, cache = null;
    try { if ('caches' in window) cache = await caches.open(PHOTO_CACHE); } catch (e) { cache = null; }
    if (cache && !opts.force) {
      try {
        const hit = await cache.match(PHOTOS_URL);
        if (hit && (!expected || hit.headers.get('x-fj-ver') === expected)) buf = await hit.arrayBuffer();
      } catch (e) { buf = null; }
    }
    if (!buf) {
      if (!navigator.onLine) { setPhotoStatus('offline'); return; }
      setPhotoStatus('loading', { loaded: 0, total: 0 });
      try {
        buf = await fetchWithProgress(PHOTOS_URL);
        if (cache) { try { if (opts.force) await cache.delete(PHOTOS_URL); await cache.put(PHOTOS_URL, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream', 'x-fj-ver': expected || 'none' } })); } catch (e) { /* 存不進去就算了 */ } }
      } catch (e) {
        setPhotoStatus(navigator.onLine ? 'error' : 'offline', { msg: e.message.includes('404') ? '網站上還沒有 photos.enc' : '下載失敗（' + e.message + '）' });
        if (!opts.silent) toast('照片下載失敗');
        return;
      }
    }
    try {
      const u8 = new Uint8Array(buf);
      if (!(u8[0] === 0x46 && u8[1] === 0x4A && u8[2] === 0x45 && u8[3] === 0x31) || u8[4] !== 1) throw new Error('不是 photos.enc 格式');
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(5, 17), tagLength: 128 }, cryptoKey, u8.subarray(17));
      const p8 = new Uint8Array(plain);
      if (!(p8[0] === 0x46 && p8[1] === 0x4A && p8[2] === 0x50 && p8[3] === 0x48)) throw new Error('照片包格式不對');
      const n = new DataView(plain).getUint32(4);
      const header = JSON.parse(dec.decode(p8.subarray(8, 8 + n)));
      const base = 8 + n; let count = 0;
      Object.keys(photoUrls).forEach((k) => { try { URL.revokeObjectURL(photoUrls[k]); } catch (e) { /* ignore */ } delete photoUrls[k]; });
      Object.entries(header.files || {}).forEach(([id, entry]) => {   // stamps.js 掛鉤 11：第三項是 MIME（集章素材 image/webp）；st- 開頭的不算照片張數
        const [off, len] = entry;
        photoUrls[id] = URL.createObjectURL(new Blob([plain.slice(base + off, base + off + len)], { type: entry[2] || 'image/jpeg' }));
        if (!id.startsWith('st-')) count++;
      });
      setPhotoStatus('ready', { count, bytes: buf.byteLength });
      hydratePhotos(document);
      if (!opts.silent && opts.force) toast(`照片已重新下載（${count} 張）`);
    } catch (e) {
      if (cache) { try { await cache.delete(PHOTOS_URL); } catch (er) { /* ignore */ } }
      setPhotoStatus('error', { msg: /OperationError|decrypt/i.test(String(e.name + e.message)) ? '解不開（密碼和行程不一樣？）' : e.message });
    }
  }

  // ───────────────────────── 資料載入、更新、Service Worker ─────────────────────────
  async function loadBlob() {
    let r;
    try { r = await fetch(DATA_URL); } catch (e) { return { error: 'network' }; }
    if (!r.ok) return { error: r.status === 404 ? 'missing' : 'http', status: r.status };
    try { const blob = await r.json(); if (!blob.ct || !blob.iv) return { error: 'bad' }; return { blob }; } catch (e) { return { error: 'bad' }; }
  }
  function renderEmpty(res) {
    const msg = res.error === 'missing' ? '找不到 <code>data.enc</code>。請用 <code>tools/encrypt.html</code> 把 itinerary.json 加密，把下載的 data.enc 放進網站資料夾（和 index.html 同一層）後再打開。'
      : res.error === 'network' ? '需要網路下載行程（第一次打開，或太久沒用被手機清掉了）。連上網路後再打開一次。'
        : `行程資料檔讀不出來（${esc(res.error)} ${esc(res.status || '')}），請重新加密、重新上傳。`;
    $('#view').innerHTML = `<section class="empty"><h2>還沒放行程資料</h2><p>${msg}</p></section>`;
    renderTopbar();
  }
  async function checkData(manual) {
    if (!cryptoKey || !encBlob || !navigator.onLine) return;
    if (!manual && Date.now() - lastDataCheck < DATA_CHECK_EVERY) return;
    lastDataCheck = Date.now();
    let blob;
    try { const r = await fetch(DATA_URL, { cache: 'no-cache' }); if (!r.ok) return; blob = await r.json(); } catch (e) { if (manual) toast('目前無法檢查（沒有網路？）'); return; }
    if (!blob || !blob.ct || (blob.ver === encBlob.ver && blob.ct === encBlob.ct)) { if (manual) toast('行程資料已是最新'); return; }
    let nd;
    try { nd = await decryptBlob(cryptoKey, blob); } catch (e) {
      encBlob = blob; cryptoKey = null; store.del(KEYS.key);
      showLock('行程資料更新了，請再輸入一次密碼'); return;
    }
    encBlob = blob; setData(nd);
    try { const c = await caches.open(CACHE_NAME); await c.put(new Request(DATA_URL), new Response(JSON.stringify(blob), { headers: { 'Content-Type': 'application/json' } })); } catch (e) { /* ignore */ }
    toast(`行程資料已更新到 ${nd.version}`);
    lastState = null; render(false);
    loadPhotos({ silent: true });
  }
  function offerUpdate(worker) {
    updateWorker = worker;
    toast('有新版本，重新開啟即可', { action: { label: '重新載入', fn: () => worker.postMessage({ type: 'SKIP_WAITING' }) }, ms: 10000 });
    const n = $('.update-note'); if (n) n.textContent = '有新版本可用，重新開啟 App 即可。';
  }
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;      // 2 號 #6
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      swReg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(nw); });
      });
    }).catch(() => { /* 本機或不支援時略過 */ });
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || refreshing) return; refreshing = true; location.reload(); });
  }
  async function checkUpdates(manual) {
    if (manual && !navigator.onLine) { toast('沒有網路，無法檢查'); return; }
    if (manual) toast('檢查中…');
    let found = false;
    if (swReg) {
      try {
        const before = swReg.installing || swReg.waiting;
        await swReg.update();
        found = !!(swReg.installing || swReg.waiting) && (swReg.installing || swReg.waiting) !== before;
      } catch (e) { /* ignore */ }
    }
    await checkData(manual);
    if (manual && !found && !updateWorker) setTimeout(() => { if (!updateWorker) toast('App 已是最新版本'); }, 1200);
    if (ui.tab === 'info') renderInfo();
  }

  // ───────────────────────── 啟動 ─────────────────────────
  function start() {
    const now = getNow(), today = defaultDayId(now);
    const nav = store.get(KEYS.nav, null);
    const tabs = ['now', 'days', 'places', 'info']; if (window.FJStamps && FJStamps.tabVisible()) tabs.push('stamps');   // stamps.js 掛鉤 6
    if (nav && nav.at && Date.now() - nav.at < NAV_RESTORE_MS && nav.today === today && tabs.includes(nav.tab)) { ui.tab = nav.tab; ui.day = nav.day; }   // 5 號 M3
    else { ui.tab = 'now'; ui.day = today; }
    if (!ui.day || !dayById[ui.day]) ui.day = today;
    ui.placesMode = store.get(KEYS.places, 'day') === 'kind' ? 'kind' : 'day';
    syncTabs();
    render(false);
    lastState = null; tick(true); startTick();
    refreshWeather({ silent: true });
    registerSW();
    loadPhotos({ silent: true });
    setTimeout(() => checkData(false), 3000);
  }
  async function boot() {
    if (window.FJStamps) {   // stamps.js 掛鉤 2、13：集章分頁引擎（介面見 stamps/impl/spec.md §8.1）
      try {
        FJStamps.init({ store, esc, toast, openSheet, closeAllSheets, sheetBack, render, renderTopbar, syncTabs, setTab, jstParts, IS_LOCAL, params, REDUCE, photoUrl: (id) => photoUrls[id] || null, getData: () => data, getUi: () => ui });
      } catch (e) { console.error('[stamps] init', e); }
    }
    $$('.tabbar .tab').forEach((t) => {
      const k = t.dataset.tab;
      t.innerHTML = ({ now: ICON.tabNow, days: ICON.tabDays, places: ICON.tabPlaces, info: ICON.tabInfo })[k] + `<span class="tab-label">${({ now: '現在', days: '行程', places: '地點', info: '資訊' })[k]}</span>`;
    });
    try { if (!history.state || history.state.fj !== 'base') history.replaceState({ fj: 'base', depth: 0 }, ''); } catch (e) { /* ignore */ }
    if (params.get('wxtest')) { store.set(KEYS.wxtest, params.get('wxtest')); dropParam('wxtest'); }
    bindEvents(); bindLock(); renderTopbar();
    $('#view').innerHTML = '<p class="empty muted">載入中…</p>';
    const res = await loadBlob();
    if (res.error) { renderEmpty(res); registerSW(); return; }
    encBlob = res.blob;
    if (!window.crypto || !crypto.subtle) { $('#view').innerHTML = '<section class="empty"><h2>無法解密</h2><p>這個瀏覽器沒有 Web Crypto（要用 https 或 localhost 打開）。</p></section>'; return; }
    const raw = store.get(KEYS.key, null);
    if (raw) {
      try { cryptoKey = await importRaw(raw); setData(await decryptBlob(cryptoKey, encBlob)); }
      catch (e) { cryptoKey = null; store.del(KEYS.key); showLock('行程資料更新了，請再輸入一次密碼'); return; }
      if (!wxtestId()) store.del(KEYS.wxtest);
      start();
    } else showLock();
  }
  boot();
})();

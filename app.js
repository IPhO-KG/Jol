'use strict';
const $ = id => document.getElementById(id);
const rad = Math.PI / 180;
const VMAX = 1.35; // m/s, fastest walking speed used in the graph

// ======================= physics =======================
function sunPos(date, lat, lon) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const H = (gmst * 15 + lon) * rad - ra, phi = lat * rad;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  let az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  if (az < 0) az += 2 * Math.PI;
  return { alt, az };
}
let ELEV_KM = 0.8;
function dni(altDeg) {
  if (altDeg <= 0) return 0;
  const AM = 1 / (Math.sin(altDeg * rad) + 0.50572 * Math.pow(altDeg + 6.07995, -1.6364));
  return 1353 * ((1 - 0.14 * ELEV_KM) * Math.pow(0.7, Math.pow(AM, 0.678)) + 0.14 * ELEV_KM);
}
const FP = [0.35, 0.35, 0.314, 0.258, 0.206, 0.144, 0.082];
const fp = a => { const x = Math.min(Math.max(a, 0), 90) / 15, i = Math.min(5, Math.floor(x)); return FP[i] + (FP[i + 1] - FP[i]) * (x - i); };
const bodyWatts = a => 0.7 * fp(a) * dni(a) * 1.8;
let SUN_W_MAX = 0;
const calcSunMax = () => { SUN_W_MAX = 0; for (let h = 0.5; h < 90; h += 0.5) SUN_W_MAX = Math.max(SUN_W_MAX, bodyWatts(h)); };
const Q = { 5: 1.0, 4: 0.6, 3: 0.3, 2: 0.05 }, HALFW = { 5: 10, 4: 7, 3: 5, 2: 3 }, GRP = { 5: 0, 4: 0, 3: 1, 2: 1 }; // 0 = arterial, 1 = local
const decay = d => 0.6 * Math.exp(-d / 40) + 0.4 * Math.exp(-d / 250);
const RCUT = 700;
let C_NORM = 0; for (let s = -RCUT; s <= RCUT; s += 10) C_NORM += decay(Math.max(0, Math.hypot(s, 10) - 10)) * 10;
// Traffic intensity by hour (fraction of the weekday evening peak). Expert estimate from Bishkek schedules:
// schools 07:30/08:00, offices 09:00–18:00 with lunch ~12:30–13:30, universities from 10:00, school shift change 12–14,
// evening peak 17–19 that now drags to ~21:00. Arterials = primary/secondary/trunk; local = tertiary/residential/service.
const PROF = {
  workA: [0.15, 0.10, 0.07, 0.06, 0.07, 0.15, 0.35, 0.72, 0.95, 0.90, 0.80, 0.72, 0.80, 0.82, 0.74, 0.74, 0.82, 0.95, 1.00, 0.95, 0.85, 0.65, 0.42, 0.25],
  workL: [0.08, 0.05, 0.04, 0.04, 0.05, 0.12, 0.35, 0.85, 0.90, 0.60, 0.50, 0.50, 0.65, 0.70, 0.55, 0.52, 0.62, 0.85, 1.00, 0.90, 0.70, 0.50, 0.30, 0.15],
  satA: [0.25, 0.18, 0.12, 0.08, 0.07, 0.10, 0.18, 0.28, 0.40, 0.52, 0.62, 0.68, 0.72, 0.72, 0.72, 0.72, 0.74, 0.76, 0.78, 0.76, 0.68, 0.55, 0.42, 0.32],
  satL: [0.15, 0.10, 0.06, 0.05, 0.05, 0.07, 0.12, 0.20, 0.32, 0.45, 0.55, 0.60, 0.62, 0.62, 0.60, 0.60, 0.62, 0.65, 0.68, 0.65, 0.55, 0.42, 0.30, 0.20],
};
const HOLI = ['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '03-08', '03-21', '05-01', '05-02', '05-03', '05-04', '05-05', '05-06', '05-07', '05-08', '05-09', '08-31'];
function dayType(dateStr) { const d = new Date(dateStr + 'T12:00:00Z'), wd = d.getUTCDay(); if (HOLI.includes(dateStr.slice(5))) return 'hol'; return wd === 0 ? 'sun' : wd === 6 ? 'sat' : 'work'; }
const DAYNAME = { work: 'будний день', sat: 'суббота', sun: 'воскресенье', hol: 'праздник (как воскресенье)' };
function prof(arr, h) { const i = Math.floor(h) % 24, f = h - Math.floor(h); return arr[i] * (1 - f) + arr[(i + 1) % 24] * f; }
function trafficK(dateStr, h) { const t = dayType(dateStr), sunF = t === 'work' || t === 'sat' ? 1 : 0.85; return t === 'work' ? [prof(PROF.workA, h), prof(PROF.workL, h)] : [prof(PROF.satA, h) * sunF, prof(PROF.satL, h) * sunF]; }
// Emissions per km grow in stop-and-go traffic. BPR-style congestion term (∝ load⁴): arterials jam at peak, local streets mostly don't.
const CONG = [1.5, 0.3]; // extra emission factor at full load: arterials ×2.5, local ×1.3
const emisK = k => [k[0] * (1 + CONG[0] * k[0] ** 4), k[1] * (1 + CONG[1] * k[1] ** 4)];
let TK = [1, 1];

// ======================= spatial grid =======================
class Grid {
  constructor(cs) { this.cs = cs; this.m = new Map(); }
  k(ix, iy) { return (ix + 32768) * 65536 + (iy + 32768); }
  add(id, x0, y0, x1, y1) { const c = this.cs; for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) for (let iy = Math.floor(y0 / c); iy <= Math.floor(y1 / c); iy++) { const k = this.k(ix, iy); let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(id); } }
  each(x0, y0, x1, y1, stamp, st, cb) { const c = this.cs; for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) for (let iy = Math.floor(y0 / c); iy <= Math.floor(y1 / c); iy++) { const a = this.m.get(this.k(ix, iy)); if (!a) continue; for (const id of a) { if (stamp[id] === st) continue; stamp[id] = st; if (cb(id) === false) return; } } }
}
let STAMP = 1; const nextStamp = () => (++STAMP);

// ======================= geometry helpers =======================
function pip(x, y, p) { let ins = false; const n = p.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
function segX(ax, ay, bx, by, cx, cy, dx, dy) { const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax), d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)); }
function segHitsPoly(ax, ay, bx, by, p) { if (pip(ax, ay, p)) return true; const n = p.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) if (segX(ax, ay, bx, by, p[2 * j], p[2 * j + 1], p[2 * i], p[2 * i + 1])) return true; return false; }
function dPtSeg(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
function dSegSeg(ax, ay, bx, by, cx, cy, dx, dy) { if (segX(ax, ay, bx, by, cx, cy, dx, dy)) return 0; return Math.min(dPtSeg(ax, ay, cx, cy, dx, dy), dPtSeg(bx, by, cx, cy, dx, dy), dPtSeg(cx, cy, ax, ay, bx, by), dPtSeg(dx, dy, ax, ay, bx, by)); }
const bboxOf = f => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < f.length; i += 2) { if (f[i] < x0) x0 = f[i]; if (f[i] > x1) x1 = f[i]; if (f[i + 1] < y0) y0 = f[i + 1]; if (f[i + 1] > y1) y1 = f[i + 1]; } return [x0, y0, x1, y1]; };

// ======================= model =======================
let M = null;
function buildModel(D, name) {
  const t0 = performance.now();
  const m = { name, lat: D.meta.lat0, lon: D.meta.lon0, meta: D.meta };
  ELEV_KM = (m.lat > 39 && m.lat < 43.5 && m.lon > 69 && m.lon < 80.5) ? 0.8 : 0.2; calcSunMax();
  m.kx = Math.cos(m.lat * rad) * 111320; m.ky = 110574;
  // buildings
  m.B = D.B.map(b => { const p = Float32Array.from(b.slice(1)); const h = b[0] > 0 ? b[0] : (b[0] < 0 ? -b[0] : 9); return { p, h, known: b[0] > 0, bb: bboxOf(p) }; });
  m.hMax = m.B.reduce((s, b) => Math.max(s, b.h), 10);
  m.gB = new Grid(50); m.B.forEach((b, i) => m.gB.add(i, ...b.bb)); m.stB = new Int32Array(m.B.length);
  m.V = D.V.map(f => { const p = Float32Array.from(f); return { p, bb: bboxOf(p) }; }); m.gV = new Grid(100); m.V.forEach((v, i) => m.gV.add(i, ...v.bb)); m.stV = new Int32Array(m.V.length);
  m.PK = D.PK.map(f => { const p = Float32Array.from(f); return { p, bb: bboxOf(p) }; }); m.gP = new Grid(100); m.PK.forEach((v, i) => m.gP.add(i, ...v.bb)); m.stP = new Int32Array(m.PK.length);
  m.T = Float32Array.from(D.T); m.gT = new Grid(50); for (let i = 0; i < m.T.length / 2; i++) m.gT.add(i, m.T[2 * i], m.T[2 * i + 1], m.T[2 * i], m.T[2 * i + 1]); m.stT = new Int32Array(m.T.length / 2);
  m.TRS = []; for (const f of D.TR) for (let i = 2; i < f.length; i += 2) m.TRS.push([f[i - 2], f[i - 1], f[i], f[i + 1]]);
  m.gTR = new Grid(50); m.TRS.forEach((s, i) => m.gTR.add(i, Math.min(s[0], s[2]), Math.min(s[1], s[3]), Math.max(s[0], s[2]), Math.max(s[1], s[3]))); m.stTR = new Int32Array(m.TRS.length);
  // graph
  m.NX = D.JX.length / 2; m.JX = Float64Array.from(D.JX);
  m.E = D.S.map(s => {
    const pts = [[m.JX[2 * s[1]], m.JX[2 * s[1] + 1]]];
    for (let k = 3; k < s.length; k += 2) pts.push([s[k], s[k + 1]]);
    pts.push([m.JX[2 * s[2]], m.JX[2 * s[2] + 1]]);
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    L = Math.max(L, 0.5); const cls = s[0];
    return { cls, a: s[1], b: s[2], pts, L, t: L / (cls === 1 ? 0.75 : VMAX), bb: bboxOf(pts.flat()), smp: null, sun: 1, sunK: '', pol: -1 };
  });
  m.adj = Array.from({ length: m.NX }, () => []);
  m.E.forEach((e, i) => { if (e.a !== e.b) { m.adj[e.a].push(i); m.adj[e.b].push(i); } });
  m.gE = new Grid(100); m.E.forEach((e, i) => m.gE.add(i, ...e.bb)); m.stE = new Int32Array(m.E.length);
  const comp = new Int32Array(m.NX).fill(-1); let best = -1, bs = 0;
  for (let s = 0, c = 0; s < m.NX; s++) {
    if (comp[s] >= 0 || !m.adj[s].length) continue; let size = 0; const st = [s]; comp[s] = c;
    while (st.length) { const u = st.pop(); size++; for (const ei of m.adj[u]) { const e = m.E[ei], w = e.a === u ? e.b : e.a; if (comp[w] < 0) { comp[w] = c; st.push(w); } } }
    if (size > bs) { bs = size; best = c; } c++;
  }
  m.inMain = i => comp[i] === best;
  m.gN = new Grid(100); for (let i = 0; i < m.NX; i++) if (comp[i] === best) m.gN.add(i, m.JX[2 * i], m.JX[2 * i + 1], m.JX[2 * i], m.JX[2 * i + 1]); m.stN = new Int32Array(m.NX);
  // pollution line sources
  const EL = []; for (const e of m.E) { const q = Q[e.cls]; if (!q) continue; for (let i = 1; i < e.pts.length; i++) { const [ax, ay] = e.pts[i - 1], [bx, by] = e.pts[i]; const l = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(l / 10)); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; EL.push(ax + (bx - ax) * t, ay + (by - ay) * t, q * l / n, HALFW[e.cls], GRP[e.cls]); } } }
  m.EL = Float32Array.from(EL); m.gEL = new Grid(100); for (let i = 0; i < m.EL.length / 5; i++) m.gEL.add(i, m.EL[5 * i], m.EL[5 * i + 1], m.EL[5 * i], m.EL[5 * i + 1]); m.stEL = new Int32Array(m.EL.length / 5);
  // view box: 2–98 % of buildings (or graph nodes) so stray far-away points don't shrink the map
  const xs = [], ys = []; if (m.B.length > 20) for (const b of m.B) { xs.push(b.bb[0]); ys.push(b.bb[1]); } else for (let i = 0; i < m.NX; i++) { xs.push(m.JX[2 * i]); ys.push(m.JX[2 * i + 1]); }
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b); const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  m.bb = [q(xs, 0.02) - 40, q(ys, 0.02) - 40, q(xs, 0.98) + 40, q(ys, 0.98) + 40];
  m.buildMs = performance.now() - t0;
  return m;
}
const toLatLon = (x, y) => [M.lat + y / M.ky, M.lon + x / M.kx];

function nearestNode(x, y) {
  for (let r = 100; r <= 3200; r *= 2) {
    let bi = -1, bd = Infinity; const st = nextStamp();
    M.gN.each(x - r, y - r, x + r, y + r, M.stN, st, i => { const d = (M.JX[2 * i] - x) ** 2 + (M.JX[2 * i + 1] - y) ** 2; if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0 && Math.sqrt(bd) <= r) return bi;
  }
  let bi = -1, bd = Infinity; for (let i = 0; i < M.NX; i++) if (M.inMain(i)) { const d = (M.JX[2 * i] - x) ** 2 + (M.JX[2 * i + 1] - y) ** 2; if (d < bd) { bd = d; bi = i; } } return bi;
}

// ======================= shade tiles & pollution =======================
let SUN = null; // {alt, az, ux, uy, cot, up, key, W, pen}
const TILE = 512, TRES = 2, TPX = TILE / TRES; // 512 m tiles, 2 m pixels
let tileCache = new Map(), tileKey = '';
const tcv = document.createElement('canvas'); tcv.width = tcv.height = TPX; const tctx = tcv.getContext('2d', { willReadFrequently: true });
const vcv = document.createElement('canvas'); vcv.width = vcv.height = TPX; const vctx = vcv.getContext('2d', { willReadFrequently: true });
function renderTile(ix, iy) {
  const m = M, X0 = ix * TILE, Y1 = (iy + 1) * TILE;
  const px = x => (x - X0) / TRES, py = y => (Y1 - y) / TRES;
  const poly = (c, f, ox = 0, oy = 0) => { c.beginPath(); for (let i = 0; i < f.length; i += 2) { const X = px(f[i] + ox), Y = py(f[i + 1] + oy); i ? c.lineTo(X, Y) : c.moveTo(X, Y); } c.closePath(); };
  const cast = (c, f, ox, oy) => { poly(c, f); c.fill(); if (Math.hypot(ox, oy) < 0.5) return; poly(c, f, ox, oy); c.fill(); const n = f.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; c.beginPath(); c.moveTo(px(f[2 * i]), py(f[2 * i + 1])); c.lineTo(px(f[2 * j]), py(f[2 * j + 1])); c.lineTo(px(f[2 * j] + ox), py(f[2 * j + 1] + oy)); c.lineTo(px(f[2 * i] + ox), py(f[2 * i + 1] + oy)); c.closePath(); c.fill(); } };
  tctx.clearRect(0, 0, TPX, TPX); vctx.clearRect(0, 0, TPX, TPX);
  const x0 = X0, y0 = Y1 - TILE, x1 = X0 + TILE, y1 = Y1;
  if (SUN.up) {
    const L = Math.min(400, m.hMax * SUN.cot); tctx.fillStyle = '#000';
    let st = nextStamp(); m.gB.each(x0 - L, y0 - L, x1 + L, y1 + L, m.stB, st, i => { const b = m.B[i], Ls = Math.min(400, b.h * SUN.cot); cast(tctx, b.p, -SUN.ux * Ls, -SUN.uy * Ls); });
    const Lt = Math.min(120, 8 * SUN.cot), ox = -SUN.ux * Lt, oy = -SUN.uy * Lt;
    vctx.fillStyle = 'rgba(0,0,0,0.85)';
    st = nextStamp(); m.gV.each(x0 - Lt, y0 - Lt, x1 + Lt, y1 + Lt, m.stV, st, i => cast(vctx, m.V[i].p, ox, oy));
    st = nextStamp(); m.gT.each(x0 - Lt - 5, y0 - Lt - 5, x1 + Lt + 5, y1 + Lt + 5, m.stT, st, i => { const tx = m.T[2 * i], ty = m.T[2 * i + 1]; vctx.beginPath(); vctx.arc(px(tx), py(ty), 2, 0, 7); vctx.fill(); vctx.beginPath(); vctx.arc(px(tx + ox), py(ty + oy), 2, 0, 7); vctx.fill(); });
    vctx.strokeStyle = 'rgba(0,0,0,0.85)'; vctx.lineWidth = 3.5; vctx.lineCap = 'round';
    const line = (ax, ay, bx, by) => { for (const [dx, dy] of [[0, 0], [ox, oy]]) { vctx.beginPath(); vctx.moveTo(px(ax + dx), py(ay + dy)); vctx.lineTo(px(bx + dx), py(by + dy)); vctx.stroke(); } };
    st = nextStamp(); m.gTR.each(x0 - Lt - 5, y0 - Lt - 5, x1 + Lt + 5, y1 + Lt + 5, m.stTR, st, i => { const s = m.TRS[i]; line(s[0], s[1], s[2], s[3]); });
    if (STREET_TREES) { vctx.strokeStyle = 'rgba(0,0,0,0.6)'; st = nextStamp(); m.gE.each(x0 - Lt - 20, y0 - Lt - 20, x1 + Lt + 20, y1 + Lt + 20, m.stE, st, i => { const e = m.E[i]; if (e.cls < 2) return; vctx.lineWidth = (HALFW[e.cls] + 4) * 2 / TRES; for (let k = 1; k < e.pts.length; k++) line(e.pts[k - 1][0], e.pts[k - 1][1], e.pts[k][0], e.pts[k][1]); }); vctx.lineWidth = 3.5; }
    vctx.fillStyle = 'rgba(0,0,0,0.45)'; st = nextStamp(); m.gP.each(x0, y0, x1, y1, m.stP, st, i => { poly(vctx, m.PK[i].p); vctx.fill(); });
  }
  const a = tctx.getImageData(0, 0, TPX, TPX).data, v = vctx.getImageData(0, 0, TPX, TPX).data, out = new Uint8Array(TPX * TPX);
  for (let i = 0; i < out.length; i++) out[i] = SUN.up ? Math.max(a[4 * i + 3], v[4 * i + 3]) : 255;
  return out;
}
function shadeAt(x, y) {
  if (tileKey !== SUN.key) { tileCache = new Map(); tileKey = SUN.key; }
  const ix = Math.floor(x / TILE), iy = Math.floor(y / TILE), k = ix * 100000 + iy;
  let t = tileCache.get(k); if (!t) { t = renderTile(ix, iy); tileCache.set(k, t); }
  const gx = Math.min(TPX - 1, Math.floor((x - ix * TILE) / TRES)), gy = Math.min(TPX - 1, Math.floor(((iy + 1) * TILE - y) / TRES));
  return t[gy * TPX + gx] / 255;
}
// Pollution = fast local part (0.6·e^(−d/40), exact, within 160 m) + slow part (0.4·e^(−d/250)) on a cached 100 m grid with bilinear interpolation
const RFAST = 160, SG_C = 100; let slowCache = new Map();
function sumEl(x, y, R, f, out) { const m = M, st = nextStamp(); m.gEL.each(x - R, y - R, x + R, y + R, m.stEL, st, i => { const dx = x - m.EL[5 * i], dy = y - m.EL[5 * i + 1], r = Math.sqrt(dx * dx + dy * dy); if (r > R) return; out[m.EL[5 * i + 4]] += m.EL[5 * i + 2] * f(Math.max(0, r - m.EL[5 * i + 3])); }); return out; }
const fSlow = d => 0.4 * Math.exp(-d / 250), fFast = d => 0.6 * Math.exp(-d / 40);
const slowNode = (i, j) => { const k = i * 100000 + j; let v = slowCache.get(k); if (!v) { v = sumEl(i * SG_C, j * SG_C, RCUT, fSlow, [0, 0]); slowCache.set(k, v); } return v; };
// returns [arterial, local] concentration (1 = kerb of a primary road at k = 1)
function concAt(x, y) {
  const fi = x / SG_C, fj = y / SG_C, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
  const n00 = slowNode(i, j), n10 = slowNode(i + 1, j), n01 = slowNode(i, j + 1), n11 = slowNode(i + 1, j + 1);
  const out = sumEl(x, y, RFAST, fFast, [0, 0]);
  for (const g of [0, 1]) out[g] = (out[g] + (1 - u) * (1 - v) * n00[g] + u * (1 - v) * n10[g] + (1 - u) * v * n01[g] + u * v * n11[g]) / C_NORM;
  return out;
}
const concNow = (x, y) => { const c = concAt(x, y); return TK[0] * c[0] + TK[1] * c[1]; };
function samplesOf(e) {
  if (e.smp) return e.smp; const out = [];
  for (let i = 1; i < e.pts.length; i++) { const [ax, ay] = e.pts[i - 1], [bx, by] = e.pts[i]; const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 3)); for (let j = 0; j < n; j++) { const t = (j + 0.5) / n; out.push(ax + (bx - ax) * t, ay + (by - ay) * t); } }
  return e.smp = Float32Array.from(out);
}
function ensureEdge(e) {
  if (e.sunK !== SUN.key) { const s = samplesOf(e); let a = 0; for (let i = 0; i < s.length; i += 2) a += shadeAt(s[i], s[i + 1]); e.sun = 1 - a / (s.length / 2); e.sunK = SUN.key; }
  if (e.polA === undefined) { const s = samplesOf(e); let a = 0, l = 0, n = 0; const step = 10; /* every 5th sample ≈ 15 m */ for (let i = 0; i < s.length; i += step) { const c = concAt(s[i], s[i + 1]); a += c[0]; l += c[1]; n++; } e.polA = n ? a / n : 0; e.polL = n ? l / n : 0; }
  e.pol = TK[0] * e.polA + TK[1] * e.polL;
}

// ======================= routing =======================
let HK = new Float64Array(1024), HV = new Int32Array(1024);
function dijkstra(cost, src, dst) {
  const m = M, dist = new Float64Array(m.NX).fill(Infinity), prev = new Int32Array(m.NX).fill(-1);
  let n = 0; const push = (k, v) => { if (n === HK.length) { const a = new Float64Array(n * 2); a.set(HK); HK = a; const b = new Int32Array(n * 2); b.set(HV); HV = b; } let i = n++; while (i) { const p = (i - 1) >> 1; if (HK[p] <= k) break; HK[i] = HK[p]; HV[i] = HV[p]; i = p; } HK[i] = k; HV[i] = v; };
  push(0, src); dist[src] = 0;
  while (n) {
    const d = HK[0], u = HV[0]; n--; if (n) { const k = HK[n], v = HV[n]; let i = 0; for (;;) { const l = 2 * i + 1; if (l >= n) break; const r = l + 1, c = r < n && HK[r] < HK[l] ? r : l; if (HK[c] >= k) break; HK[i] = HK[c]; HV[i] = HV[c]; i = c; } HK[i] = k; HV[i] = v; }
    if (d > dist[u]) continue; if (u === dst) break;
    const ad = m.adj[u];
    for (let q = 0; q < ad.length; q++) { const ei = ad[q], c = cost[ei]; if (c === Infinity) continue; const e = m.E[ei], w = e.a === u ? e.b : e.a, nd = d + c; if (nd < dist[w]) { dist[w] = nd; prev[w] = ei; push(nd, w); } }
  }
  if (!isFinite(dist[dst])) return null;
  const path = []; let u = dst; while (u !== src) { const ei = prev[u]; path.push(ei); const e = m.E[ei]; u = e.a === u ? e.b : e.a; }
  return path.reverse();
}
const harmE = (e, ws, wp) => e.t * (ws * e.sun * SUN.pen + wp * e.pol);
function stats(p) {
  let L = 0, t = 0, sh = 0, tSun = 0, heat = 0, air = 0;
  for (const ei of p) { const e = M.E[ei]; L += e.L; t += e.t; sh += e.L * (1 - e.sun); tSun += e.t * e.sun; heat += e.t * e.sun * SUN.W; air += e.t * e.pol; }
  return { L, t, shade: sh / L, tSun, heat: heat / 1000, air: air / 60 };
}
const key = p => p ? p.join(',') : '';
let A = -1, B = -1, setting = 'A', corridor = null, front = [], picked = null;
const R = { fast: null, shade: null, air: null, bal: null };
function bestUnder(ws, wp, T0, eps, wantFront) {
  const lim = T0 * (1 + eps) + 1e-6, seen = new Map();
  const cost = new Float64Array(M.E.length).fill(Infinity);
  const tryMu = mu => {
    for (const ei of corridor.edges) { const e = M.E[ei]; cost[ei] = (1 - mu) * e.t + mu * harmE(e, ws, wp); }
    const p = dijkstra(cost, A, B); if (!p) return null; const k = key(p);
    if (!seen.has(k)) { let t = 0, h = 0; for (const ei of p) { t += M.E[ei].t; h += harmE(M.E[ei], ws, wp); } seen.set(k, { p, t, h }); }
    return seen.get(k);
  };
  for (let i = 0; i <= 14; i++) tryMu(0.999 * i / 14);
  for (const mu of [0.97, 0.985, 0.993, 0.997]) tryMu(mu);
  let lo = 0, hi = 0.999; for (let it = 0; it < 10; it++) { const mm = (lo + hi) / 2, r = tryMu(mm); if (r && r.t <= lim) lo = mm; else hi = mm; }
  let b = null; for (const r of seen.values()) if (r.t <= lim && (!b || r.h < b.h - 1e-9 || (Math.abs(r.h - b.h) < 1e-9 && r.t < b.t))) b = r;
  let fr = null; if (wantFront) { const arr = [...seen.values()].sort((a, c) => a.t - c.t); fr = []; let mn = Infinity; for (const r of arr) if (r.h < mn - 1e-9) { fr.push(r); mn = r.h; } }
  return { best: b, front: fr };
}
function route() {
  const t0 = performance.now();
  const eps = +$('detour').value / 100, ws = +$('wShade').value / 100, wp = +$('wAir').value / 100;
  R.fast = dijkstra(Float64Array.from(M.E, e => e.t), A, B);
  if (!R.fast) { R.shade = R.air = R.bal = null; front = []; corridor = null; return; }
  const T0 = R.fast.reduce((s, ei) => s + M.E[ei].t, 0);
  // Corridor: any path with time ≤ (1+ε)·T0 has length ≤ VMAX·(1+ε)·T0, so every point P on it satisfies |PA|+|PB| ≤ that. Ellipse is convex ⇒ checking vertices suffices.
  const epsC = Math.min(0.6, Math.max(0.3, 1.5 * eps));
  const ax = M.JX[2 * A], ay = M.JX[2 * A + 1], bx = M.JX[2 * B], by = M.JX[2 * B + 1], Dm = VMAX * (1 + epsC) * T0;
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, half = Dm / 2;
  const edges = [], st = nextStamp();
  M.gE.each(cx - half, cy - half, cx + half, cy + half, M.stE, st, ei => { const e = M.E[ei]; for (const [x, y] of e.pts) if (Math.hypot(x - ax, y - ay) + Math.hypot(x - bx, y - by) > Dm) return; edges.push(ei); });
  corridor = { edges, ax, ay, bx, by, Dm, epsC };
  for (const ei of edges) ensureEdge(M.E[ei]);
  for (const ei of R.fast) ensureEdge(M.E[ei]);
  R.shade = SUN.up && ws > 0 ? bestUnder(1, 0, T0, eps * ws).best?.p || R.fast : R.fast;
  R.air = wp > 0 ? bestUnder(0, 1, T0, eps * wp).best?.p || R.fast : R.fast;
  if (ws + wp === 0) { R.bal = R.fast; front = []; }
  else {
    const res = bestUnder(ws, wp, T0, eps, true); front = res.front; const b = res.best;
    const pk = picked && front.find(f => key(f.p) === picked);
    R.bal = pk ? pk.p : (b ? b.p : R.fast);
  }
  lastRouteMs = performance.now() - t0;
}
let lastRouteMs = 0;

// ======================= rendering =======================
const cv = $('map'), ctx = cv.getContext('2d');
let view = { s: 1, tx: 0, ty: 0 }, W = 0, H = 0, dpr = 1;
const sx = x => view.tx + x * view.s, sy = y => view.ty - y * view.s;
const fromScreen = (X, Y) => [(X - view.tx) / view.s, (view.ty - Y) / view.s];
function fit() { const r = cv.parentElement.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
function fitTo(x0, y0, x1, y1) { const s = Math.min(W / (x1 - x0 || 1), H / (y1 - y0 || 1)) * 0.92; view = { s, tx: W / 2 - (x0 + x1) / 2 * s, ty: H / 2 + (y0 + y1) / 2 * s }; }
const shadeCv = document.createElement('canvas'), shadeCtx = shadeCv.getContext('2d');
let polImg = null, polTimer = 0;
function pathFlat(c, f, ox = 0, oy = 0) { c.beginPath(); for (let i = 0; i < f.length; i += 2) { const X = sx(f[i] + ox), Y = sy(f[i + 1] + oy); i ? c.lineTo(X, Y) : c.moveTo(X, Y); } c.closePath(); }
function shadowShape(c, f, ox, oy) {
  pathFlat(c, f); c.fill(); if (Math.hypot(ox, oy) < 0.3) return; pathFlat(c, f, ox, oy); c.fill();
  const n = f.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; c.beginPath(); c.moveTo(sx(f[2 * i]), sy(f[2 * i + 1])); c.lineTo(sx(f[2 * j]), sy(f[2 * j + 1])); c.lineTo(sx(f[2 * j] + ox), sy(f[2 * j + 1] + oy)); c.lineTo(sx(f[2 * i] + ox), sy(f[2 * i + 1] + oy)); c.closePath(); c.fill(); }
}
function visBox(pad = 0) { const [x0, y1] = fromScreen(0, 0), [x1, y0] = fromScreen(W, H); return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]; }
function schedulePol() {
  clearTimeout(polTimer); if (!$('lPol').checked || view.s < 0.08) { polImg = null; return; }
  polTimer = setTimeout(() => {
    const cs = 12, nx = Math.ceil(W / cs), ny = Math.ceil(H / cs), c = document.createElement('canvas'); c.width = nx; c.height = ny;
    const cc = c.getContext('2d'), im = cc.createImageData(nx, ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const [x, y] = fromScreen((i + 0.5) * cs, (j + 0.5) * cs); const v = Math.min(1, Math.max(0, (concNow(x, y) - 0.15) / 1.0)); const k = 4 * (j * nx + i); im.data[k] = 214; im.data[k + 1] = 58; im.data[k + 2] = 30; im.data[k + 3] = Math.pow(v, 1.4) * 150; }
    cc.putImageData(im, 0, 0); polImg = { c, view: { ...view } }; draw();
  }, 250);
}
function routeScreenPts(p) { const out = []; let cur = A; for (const ei of p) { const e = M.E[ei]; const pts = e.a === cur ? e.pts : e.pts.slice().reverse(); cur = e.a === cur ? e.b : e.a; for (const q of pts) { const X = sx(q[0]), Y = sy(q[1]); const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - X, l[1] - Y) > 0.5) out.push([X, Y]); } } return out; }
function offsetPts(pts, o) { if (!o) return pts; return pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [p[0] - dy / l * o, p[1] + dx / l * o]; }); }
const STY = { fast: ['#6b6b6b', 4, [7, 6], 0], shade: ['#2563eb', 4, null, 5], air: ['#9333ea', 4, null, -5], bal: ['#11845b', 5.5, null, 0] };
function strokeRoute(k) {
  const p = R[k]; if (!p || !$('show_' + k).checked) return;
  const [col, w, dash, off] = STY[k]; const pts = offsetPts(routeScreenPts(p), off);
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const [c, lw] of [['rgba(255,255,255,.95)', w + 3.5], [col, w]]) { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.setLineDash(dash && c[0] === '#' ? dash : []); ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke(); }
  ctx.restore();
}
function draw() {
  if (!M) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#f3efe7'; ctx.fillRect(0, 0, W, H);
  const [x0, y0, x1, y1] = visBox(20);
  let st = nextStamp(); ctx.fillStyle = '#dbe8cf'; M.gP.each(x0, y0, x1, y1, M.stP, st, i => { pathFlat(ctx, M.PK[i].p); ctx.fill(); });
  st = nextStamp(); ctx.fillStyle = '#b9d4a3'; M.gV.each(x0, y0, x1, y1, M.stV, st, i => { pathFlat(ctx, M.V[i].p); ctx.fill(); });
  if ($('lPol').checked && polImg) { const pv = polImg.view, k = view.s / pv.s; ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true; ctx.drawImage(polImg.c, view.tx - pv.tx * k, view.ty - pv.ty * k, W * k, H * k); }
  const showB = view.s >= 0.12;
  if ($('lShade').checked && SUN.up && view.s >= 0.2) {
    shadeCv.width = cv.width; shadeCv.height = cv.height; shadeCtx.setTransform(dpr, 0, 0, dpr, 0, 0); shadeCtx.fillStyle = '#000';
    const L = Math.min(400, M.hMax * SUN.cot);
    st = nextStamp(); M.gB.each(x0 - L, y0 - L, x1 + L, y1 + L, M.stB, st, i => { const b = M.B[i], Ls = Math.min(400, b.h * SUN.cot); shadowShape(shadeCtx, b.p, -SUN.ux * Ls, -SUN.uy * Ls); });
    const Lt = Math.min(120, 8 * SUN.cot); shadeCtx.globalAlpha = 0.85;
    st = nextStamp(); M.gV.each(x0 - Lt, y0 - Lt, x1 + Lt, y1 + Lt, M.stV, st, i => shadowShape(shadeCtx, M.V[i].p, -SUN.ux * Lt, -SUN.uy * Lt));
    st = nextStamp(); M.gT.each(x0, y0, x1, y1, M.stT, st, i => { for (const o of [0, 1]) { shadeCtx.beginPath(); shadeCtx.arc(sx(M.T[2 * i] - o * SUN.ux * Lt), sy(M.T[2 * i + 1] - o * SUN.uy * Lt), 4 * view.s, 0, 7); shadeCtx.fill(); } });
    shadeCtx.globalAlpha = 1;
    ctx.globalAlpha = 0.33; ctx.drawImage(shadeCv, 0, 0, W, H); ctx.globalAlpha = 1;
  }
  const RS = { 0: ['#a39b8f', 0.8], 1: ['#a39b8f', 0.8], 2: ['#ffffff', 3], 3: ['#ffffff', 4.5], 4: ['#fbe3a6', 6], 5: ['#f6c86b', 7] };
  const minCls = view.s < 0.06 ? 4 : view.s < 0.15 ? 2 : view.s < 0.35 ? 1 : 0;
  const byCls = [[], [], [], [], [], []]; st = nextStamp(); M.gE.each(x0, y0, x1, y1, M.stE, st, i => { const e = M.E[i]; if (e.cls >= minCls) byCls[e.cls].push(e); });
  for (const c of [0, 1, 2, 3, 4, 5]) {
    if (!byCls[c].length) continue; const [col, w] = RS[c]; ctx.strokeStyle = col; ctx.lineWidth = Math.max(c >= 2 ? 1 : 0.6, w * view.s * (c >= 2 ? 1.6 : 1)); ctx.lineCap = 'round'; ctx.setLineDash(c <= 1 ? [2, 2] : []);
    ctx.beginPath(); for (const e of byCls[c]) e.pts.forEach((q, k) => k ? ctx.lineTo(sx(q[0]), sy(q[1])) : ctx.moveTo(sx(q[0]), sy(q[1]))); ctx.stroke();
  }
  ctx.setLineDash([]);
  if (showB) { st = nextStamp(); ctx.strokeStyle = 'rgba(90,80,70,.35)'; ctx.lineWidth = 0.6; M.gB.each(x0, y0, x1, y1, M.stB, st, i => { const b = M.B[i], t = Math.min(1, b.h / 50); ctx.fillStyle = b.known ? `rgb(${200 - 70 * t},${192 - 70 * t},${182 - 65 * t})` : '#d6cfc4'; pathFlat(ctx, b.p); ctx.fill(); if (view.s > 0.4) ctx.stroke(); }); }
  if (view.s >= 0.4) { st = nextStamp(); ctx.fillStyle = '#7fae6a'; M.gT.each(x0, y0, x1, y1, M.stT, st, i => { ctx.beginPath(); ctx.arc(sx(M.T[2 * i]), sy(M.T[2 * i + 1]), Math.max(1.5, 3 * view.s), 0, 7); ctx.fill(); }); }
  if (corridor && $('lCorr').checked) { // search ellipse
    const c = corridor, a = c.Dm / 2, f = Math.hypot(c.bx - c.ax, c.by - c.ay) / 2, b2 = Math.sqrt(Math.max(1, a * a - f * f)), ang = Math.atan2(c.by - c.ay, c.bx - c.ax);
    ctx.save(); ctx.strokeStyle = 'rgba(17,132,91,.55)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(sx((c.ax + c.bx) / 2), sy((c.ay + c.by) / 2), a * view.s, b2 * view.s, -ang, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
  }
  for (const k of ['fast', 'air', 'shade', 'bal']) strokeRoute(k);
  if (ME) { const X = sx(ME.x), Y = sy(ME.y); ctx.fillStyle = 'rgba(37,99,235,.15)'; ctx.beginPath(); ctx.arc(X, Y, Math.max(8, ME.acc * view.s), 0, 7); ctx.fill(); ctx.fillStyle = '#2563eb'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(X, Y, 7, 0, 7); ctx.fill(); ctx.stroke(); }
  for (const [n, lab, col] of [[A, 'A', '#1d4ed8'], [B, 'B', '#c2410c']]) {
    if (n < 0) continue; const X = sx(M.JX[2 * n]), Y = sy(M.JX[2 * n + 1]); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X, Y, 11, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '600 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(lab, X, Y + 0.5);
  }
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(W - 54, 12, 40, 46); ctx.fillStyle = '#333'; ctx.font = '600 12px Inter, system-ui'; ctx.textAlign = 'center'; ctx.fillText('С', W - 34, 27);
  ctx.beginPath(); ctx.moveTo(W - 34, 33); ctx.lineTo(W - 40, 50); ctx.lineTo(W - 28, 50); ctx.closePath(); ctx.fill();
  if (SUN.up) { const cx = W - 34, cy = 92, r = 22; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, 7); ctx.fill(); ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(cx + SUN.ux * r, cy - SUN.uy * r, 6, 0, 7); ctx.fill(); ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - SUN.ux * r * 0.8, cy + SUN.uy * r * 0.8); ctx.stroke(); }
  const nice = [50, 100, 200, 500, 1000, 2000, 5000]; let m = nice.find(v => v * view.s > 80) || 5000; const px = m * view.s;
  const by = W < 600 ? H - 30 : 0; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(12, H - 34 - by, px + 56, 24); ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(18, H - 16 - by); ctx.lineTo(18 + px, H - 16 - by); ctx.stroke(); ctx.fillStyle = '#333'; ctx.textAlign = 'left'; ctx.font = '11px Inter, system-ui'; ctx.fillText(m >= 1000 ? m / 1000 + ' км' : m + ' м', 24 + px, H - 18 - by);
}

// ======================= traffic profile chart =======================
function drawTraffic() {
  const c = $('trafficChart'); if (!c) return; const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1; c.width = r.width * d; c.height = r.height * d;
  const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); const Wc = r.width, Hc = r.height, L = 34, B = 16, T = 8;
  const X = h => L + h / 24 * (Wc - L - 18), Y = v => Hc - B - v * (Hc - B - T);
  g.clearRect(0, 0, Wc, Hc); g.font = '10px Inter, system-ui'; g.fillStyle = '#8a8478'; g.strokeStyle = '#eee7dc'; g.lineWidth = 1;
  for (const v of [0, 0.5, 1]) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(Wc - 18, Y(v)); g.stroke(); g.textAlign = 'right'; g.fillText((v * 100) + '%', L - 3, Y(v) + 3); }
  for (const h of [0, 6, 12, 18, 24]) { g.textAlign = 'center'; g.fillText(h + ':00', X(h), Hc - 3); }
  const ds = $('date').value;
  for (const [idx, col] of [[0, '#c2410c'], [1, '#d4a373']]) { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); for (let h = 0; h <= 24; h += 0.25) { const v = trafficK(ds, h % 24)[idx]; h ? g.lineTo(X(h), Y(v)) : g.moveTo(X(h), Y(v)); } g.stroke(); }
  g.strokeStyle = '#1f2328'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(curHour), T); g.lineTo(X(curHour), Hc - B); g.stroke(); g.setLineDash([]);
}

// ======================= Pareto chart =======================
const pc = $('pareto'), pctx = pc.getContext('2d'); let pBox = null;
function drawPareto() {
  const r = pc.getBoundingClientRect(), d = window.devicePixelRatio || 1; pc.width = r.width * d; pc.height = r.height * d; pctx.setTransform(d, 0, 0, d, 0, 0);
  const Wc = r.width, Hc = r.height; pctx.clearRect(0, 0, Wc, Hc); pBox = null;
  if (!front.length || !R.fast) { pctx.fillStyle = '#8a8478'; pctx.font = '12px Inter, system-ui'; pctx.fillText('Нет данных', 10, 20); $('frontN').textContent = 0; return; }
  const T0 = stats(R.fast).t, lim = T0 * (1 + +$('detour').value / 100);
  const pts = front; const xs = pts.map(f => f.t / 60), ys = pts.map(f => f.h / 60);
  const x0 = Math.min(...xs), x1 = Math.max(...xs, lim / 60) * 1.02, yMin = Math.min(...ys), yMax = Math.max(...ys), pad = Math.max((yMax - yMin) * 0.15, 0.05), y0 = Math.max(0, yMin - pad), y1 = yMax + pad;
  const L = 44, Rr = 10, T = 10, Bm = 30; const X = v => L + (v - x0) / (x1 - x0 || 1) * (Wc - L - Rr), Y = v => Hc - Bm - (v - y0) / (y1 - y0) * (Hc - Bm - T);
  pBox = { X, Y, pts };
  pctx.strokeStyle = '#e6e0d6'; pctx.lineWidth = 1; pctx.font = '10.5px Inter, system-ui'; pctx.fillStyle = '#8a8478';
  for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4, yy = Y(v); pctx.beginPath(); pctx.moveTo(L, yy); pctx.lineTo(Wc - Rr, yy); pctx.stroke(); pctx.textAlign = 'right'; pctx.fillText(v.toFixed(y1 - y0 < 1 ? 2 : 1), L - 4, yy + 3); }
  for (let i = 0; i <= 4; i++) { const v = x0 + (x1 - x0) * i / 4; pctx.textAlign = 'center'; pctx.fillText(v.toFixed(1), X(v), Hc - Bm + 13); }
  pctx.fillText('время, мин', (L + Wc) / 2, Hc - 4);
  pctx.save(); pctx.translate(10, (T + Hc - Bm) / 2); pctx.rotate(-Math.PI / 2); pctx.fillText('вред, мин-экв.', 0, 0); pctx.restore();
  pctx.fillStyle = 'rgba(17,132,91,.07)'; pctx.fillRect(L, T, X(lim / 60) - L, Hc - Bm - T);
  pctx.strokeStyle = '#11845b'; pctx.setLineDash([4, 4]); pctx.beginPath(); pctx.moveTo(X(lim / 60), T); pctx.lineTo(X(lim / 60), Hc - Bm); pctx.stroke(); pctx.setLineDash([]);
  pctx.strokeStyle = '#9ca3af'; pctx.beginPath(); pts.forEach((f, i) => { const a = X(f.t / 60), b = Y(f.h / 60); i ? pctx.lineTo(a, b) : pctx.moveTo(a, b); }); pctx.stroke();
  const kb = key(R.bal);
  for (const f of pts) { const sel = key(f.p) === kb; pctx.fillStyle = sel ? '#11845b' : '#fff'; pctx.strokeStyle = sel ? '#11845b' : '#4b5058'; pctx.lineWidth = 1.5; pctx.beginPath(); pctx.arc(X(f.t / 60), Y(f.h / 60), sel ? 6 : 4, 0, 7); pctx.fill(); pctx.stroke(); }
  $('frontN').textContent = pts.length;
}
pc.addEventListener('click', e => {
  if (!pBox) return; const r = pc.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  let bi = null, bd = 196; for (const f of pBox.pts) { const d = (pBox.X(f.t / 60) - mx) ** 2 + (pBox.Y(f.h / 60) - my) ** 2; if (d < bd) { bd = d; bi = f; } }
  if (bi) { picked = key(bi.p); recompute(false); }
});

// ======================= UI =======================
let curHour = 14, STREET_TREES = false;
const fmtMin = s => (s / 60).toFixed(1);
const NAMES = { fast: 'Быстрый', shade: 'Тень', air: 'Воздух', bal: 'Баланс' };
function updateInfo() {
  const altD = SUN.alt / rad;
  $('sunAlt').textContent = altD.toFixed(1) + '°'; $('sunAz').textContent = (SUN.az / rad).toFixed(0) + '°';
  $('shadow10').textContent = SUN.up ? (10 / Math.tan(SUN.alt)).toFixed(1) + ' м' : 'ночь';
  $('sunW').textContent = SUN.W.toFixed(0) + ' Вт'; $('dniV').textContent = dni(altD).toFixed(0) + ' Вт/м²'; $('fpV').textContent = fp(altD).toFixed(3);
  { const k = trafficK($('date').value, curHour); $('trafficK').textContent = `поток на магистралях ${(k[0] * 100).toFixed(0)}%, на местных ${(k[1] * 100).toFixed(0)}% от вечернего пика; выброс на км ×${(1 + CONG[0] * k[0] ** 4).toFixed(1)} и ×${(1 + CONG[1] * k[1] ** 4).toFixed(1)} из-за заторов`; } $('dayType').textContent = DAYNAME[dayType($('date').value)]; drawTraffic();
  $('perf').textContent = corridor ? `Зона поиска: ${corridor.edges.length} из ${M.E.length} участков, расчёт ${lastRouteMs.toFixed(0)} мс` : '';
  if (!R.fast) { $('res').innerHTML = '<tr><td>Поставьте точки A и B (клик по карте)</td></tr>'; $('verdict').innerHTML = ''; return; }
  const ks = ['fast', 'shade', 'air', 'bal'], S = {}; ks.forEach(k => S[k] = stats(R[k]));
  const same = k => { for (const j of ks) { if (j === k) break; if (key(R[j]) === key(R[k])) return NAMES[j]; } return null; };
  const head = '<tr><th></th>' + ks.map(k => `<th><i class="dot" style="background:${STY[k][0]}"></i>${NAMES[k]}${same(k) ? `<small>= ${same(k)}</small>` : ''}</th>`).join('') + '</tr>';
  const rows = [['Время, мин', s => fmtMin(s.t), 'lo', s => s.t], ['Дистанция, м', s => s.L.toFixed(0), 'lo', s => s.L], ['В тени', s => (s.shade * 100).toFixed(0) + '%', 'hi', s => s.shade], ['Мин. на солнце', s => fmtMin(s.tSun), 'lo', s => s.tSun], ['Тепло от солнца, кДж', s => s.heat.toFixed(0), 'lo', s => s.heat], ['Выхлоп, мин-экв.*', s => s.air.toFixed(1), 'lo', s => s.air]];
  $('res').innerHTML = head + rows.map(([n, f, dir, v]) => '<tr><th>' + n + '</th>' + ks.map(k => { const d = v(S[k]) - v(S.fast); const cl = k === 'fast' || Math.abs(d) < 1e-6 ? '' : ((dir === 'lo') === (d < 0) ? 'good' : 'bad'); return `<td class="${cl}">${f(S[k])}</td>`; }).join('') + '</tr>').join('');
  const f = S.fast, c = S.bal;
  if (key(R.bal) === key(R.fast)) { $('verdict').innerHTML = 'Баланс совпал с быстрым: при этих весах и лимите крюк не окупается. Попробуйте увеличить «Допустимый крюк».'; return; }
  const parts = [];
  if (f.heat - c.heat > 0.5) parts.push(`солнечного тепла на <b>${((1 - c.heat / f.heat) * 100).toFixed(0)}%</b> меньше (${(f.heat - c.heat).toFixed(0)} кДж)`);
  if (f.air - c.air > 0.05) parts.push(`выхлопа на <b>${((1 - c.air / f.air) * 100).toFixed(0)}%</b> меньше`); else if (c.air - f.air > 0.05) parts.push(`выхлопа на ${((c.air / f.air - 1) * 100).toFixed(0)}% больше (размен ради тени)`);
  $('verdict').innerHTML = `Баланс: <b>+${((c.t / f.t - 1) * 100).toFixed(0)}%</b> времени (+${fmtMin(c.t - f.t)} мин); ${parts.join(', ') || 'выигрыш мал'}.` + (picked ? ' <i>(выбран на графике)</i>' : '');
}
function readTime() {
  const [y, mo, d] = $('date').value.split('-').map(Number); const mins = +$('time').value; curHour = mins / 60;
  $('timeLbl').textContent = String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
  const tz = Math.round(M.lon / 15); // approx local solar-ish time zone; Bishkek = UTC+6 (lon 74.6 → 5), override for KG
  const TZ = (M.lat > 39 && M.lat < 43.5 && M.lon > 69 && M.lon < 80.5) ? 6 : tz;
  $('tzLbl').textContent = 'UTC' + (TZ >= 0 ? '+' : '') + TZ;
  TK = emisK(trafficK($('date').value, curHour));
  const s = sunPos(new Date(Date.UTC(y, mo - 1, d, 0, mins) - TZ * 3600000), M.lat, M.lon);
  const altD = s.alt / rad, W0 = bodyWatts(altD);
  SUN = { ...s, up: s.alt > 0.005, ux: Math.sin(s.az), uy: Math.cos(s.az), cot: 1 / Math.tan(Math.max(s.alt, 0.01)), W: s.alt > 0 ? W0 : 0, pen: s.alt > 0 ? W0 / SUN_W_MAX : 0, key: `${y}-${mo}-${d}-${mins}-${STREET_TREES}` };
}
let pending = 0;
function recompute(full) {
  if (!M || pending) return;
  if (A >= 0 && B >= 0) $('perf').textContent = 'Считаю маршруты…';
  pending = requestAnimationFrame(() => setTimeout(() => { pending = 0; if (full) readTime(); if (A >= 0 && B >= 0) route(); updateInfo(); draw(); drawPareto(); if (full) schedulePol(); }, 0));
}
['date', 'time'].forEach(id => $(id).addEventListener('input', () => { picked = null; recompute(true); }));
$('streetTrees').addEventListener('input', () => { STREET_TREES = $('streetTrees').checked; picked = null; recompute(true); });
['wShade', 'wAir', 'detour'].forEach(id => $(id).addEventListener('input', () => { picked = null; $(id + 'V').textContent = $(id).value + (id === 'detour' ? '%' : ''); recompute(false); }));
['lShade', 'show_fast', 'show_shade', 'show_air', 'show_bal', 'lCorr'].forEach(id => $(id).addEventListener('input', draw));
$('lPol').addEventListener('input', () => { schedulePol(); draw(); });
document.querySelectorAll('[data-date]').forEach(b => b.addEventListener('click', () => { $('date').value = b.dataset.date === 'today' ? new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 10) : b.dataset.date; picked = null; recompute(true); }));
$('setA').onclick = () => { setting = 'A'; markSet(); }; $('setB').onclick = () => { setting = 'B'; markSet(); };
$('swap').onclick = () => { [A, B] = [B, A]; picked = null; recompute(false); };
function markSet() { $('setA').classList.toggle('on', setting === 'A'); $('setB').classList.toggle('on', setting === 'B'); }
let drag = null;
cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 4) drag.moved = true; if (drag.moved) { view.tx = drag.tx + dx; view.ty = drag.ty + dy; draw(); } });
cv.addEventListener('pointerup', e => {
  if (drag && !drag.moved && M) { const r = cv.getBoundingClientRect(); const [x, y] = fromScreen(e.clientX - r.left, e.clientY - r.top); const n = nearestNode(x, y); if (setting === 'A') { A = n; setting = 'B'; } else { B = n; setting = 'A'; } markSet(); picked = null; recompute(false); }
  else if (drag && drag.moved) { schedulePol(); updateLinks(); }
  drag = null;
});
cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
function zoomAt(X, Y, k) { const ns = Math.min(Math.max(view.s * k, 0.01), 8), f = ns / view.s; view.tx = X - (X - view.tx) * f; view.ty = Y - (Y - view.ty) * f; view.s = ns; draw(); schedulePol(); updateLinks(); }
$('zin').onclick = () => zoomAt(W / 2, H / 2, 1.4); $('zout').onclick = () => zoomAt(W / 2, H / 2, 1 / 1.4); $('zfit').onclick = () => { fitTo(...M.bb); draw(); schedulePol(); updateLinks(); };
window.addEventListener('resize', () => { fit(); draw(); drawPareto(); });

// ======================= data loading =======================
const OVERPASS_Q = bb => `[out:xml][timeout:900][maxsize:2000000000][bbox:${bb}];(way["highway"];way["building"];relation["building"];node["natural"="tree"];way["natural"~"^(tree_row|wood|scrub)$"];way["landuse"="forest"];way["leisure"~"^(park|garden)$"];relation["leisure"~"^(park|garden)$"];);(._;>;);out body;`;
const BISHKEK_BB = '42.79,74.46,42.94,74.72';
const opURL = bb => 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(OVERPASS_Q(bb));
function updateLinks() {
  $('dlCity').href = opURL(BISHKEK_BB);
  if (!M) return; const [x0, y0, x1, y1] = visBox(); const [la0, lo0] = toLatLon(x0, y0), [la1, lo1] = toLatLon(x1, y1);
  const bb = `${la0.toFixed(5)},${lo0.toFixed(5)},${la1.toFixed(5)},${lo1.toFixed(5)}`; const km2 = ((x1 - x0) * (y1 - y0) / 1e6);
  $('dlView').href = opURL(bb); $('dlViewInfo').textContent = `${km2.toFixed(1)} км²`;
  $('osmExport').href = `https://www.openstreetmap.org/export#map=16/${((la0 + la1) / 2).toFixed(5)}/${((lo0 + lo1) / 2).toFixed(5)}`;
  $('qText').value = OVERPASS_Q(bb);
}
$('copyQ').onclick = async () => { try { await navigator.clipboard.writeText($('qText').value); $('copyQ').textContent = 'Скопировано'; setTimeout(() => $('copyQ').textContent = 'Скопировать запрос', 1500); } catch { $('qText').select(); } };
function setStatus(html, kind) { const el = $('status'); el.innerHTML = html; el.className = 'status ' + (kind || ''); }
function useData(D, name, keepView) {
  const m = buildModel(D, name); M = m; tileCache = new Map(); tileKey = ''; slowCache = new Map();
  A = -1; B = -1; ME = null; R.fast = R.shade = R.air = R.bal = null; corridor = null; front = []; picked = null; polImg = null; setting = 'A'; markSet();
  const mt = D.meta;
  setStatus(`<b>${name}</b>: ${mt.buildings.toLocaleString('ru')} зданий (высота известна у ${mt.known.toLocaleString('ru')}), ${m.E.length.toLocaleString('ru')} участков пешеходной сети, ${mt.trees.toLocaleString('ru')} деревьев. Подготовка ${m.buildMs.toFixed(0)} мс.`, 'ok');
  fitTo(...m.bb);
  if (D.defaultAB) { A = nearestNode(...D.defaultAB[0]); B = nearestNode(...D.defaultAB[1]); }
  readTime(); recompute(true); updateLinks();
}
function loadFile(file, onDone) {
  if (!file) return;
  setStatus(`Читаю <b>${file.name}</b> (${(file.size / 1e6).toFixed(1)} МБ)…`, 'busy'); $('prog').style.display = 'block'; $('progBar').style.width = '0%';
  const w = new Worker('parse.js'); const t0 = performance.now();
  w.onmessage = ev => {
    const m = ev.data;
    if (m.type === 'progress') { if (m.read) $('progBar').style.width = Math.min(98, m.read / file.size * 100) + '%'; setStatus(`${m.phase}… ${m.read ? (m.read / 1e6).toFixed(0) + ' МБ' : ''}`, 'busy'); }
    else if (m.type === 'error') { $('prog').style.display = 'none'; setStatus('Не получилось: ' + m.message, 'err'); w.terminate(); }
    else if (m.type === 'done') { $('prog').style.display = 'none'; w.terminate(); m.data.meta.parseMs = performance.now() - t0; useData(m.data, file.label || file.name.replace(/\.(osm|json|gz|xml)+$/ig, '')); if (onDone) onDone(); }
  };
  w.onerror = e => { setStatus('Ошибка обработчика: ' + e.message, 'err'); };
  w.postMessage({ file });
}
$('file').addEventListener('change', e => loadFile(e.target.files[0]));
$('demo').onclick = loadDemo;

// ---------- "Где я": geolocation → download the surrounding map from OpenStreetMap (Overpass API) ----------
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const qJSON = bb => OVERPASS_Q(bb).replace('[out:xml][timeout:900][maxsize:2000000000]', '[out:json][timeout:90]');
let ME = null; // user position in local metres
async function fetchOverpass(bb) {
  let last = '';
  for (const url of OVERPASS) {
    try {
      setStatus(`Скачиваю карту вокруг вас с ${new URL(url).host}…`, 'busy');
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(qJSON(bb)) });
      if (!r.ok) { last = `${new URL(url).host}: ошибка ${r.status}`; continue; }
      const blob = await r.blob(); if (blob.size < 200) { last = 'пустой ответ'; continue; }
      return blob;
    } catch (e) { last = `${new URL(url).host}: ${e.message}`; }
  }
  throw new Error('серверы карт не ответили (' + last + ')');
}
function locate() {
  if (!navigator.geolocation) { setStatus('Браузер не поддерживает геолокацию', 'err'); return; }
  setStatus('Определяю, где вы… (разрешите доступ к геопозиции)', 'busy');
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: la, longitude: lo, accuracy } = pos.coords;
    // reuse the loaded city map if the user is inside it
    if (M && M.meta.city) { const x = (lo - M.lon) * M.kx, y = (la - M.lat) * M.ky; if (x > M.bb[0] && x < M.bb[2] && y > M.bb[1] && y < M.bb[3]) { placeMe(la, lo, accuracy); return; } }
    const dLa = 0.016, dLo = 0.016 / Math.cos(la * rad); // ≈ 3.5 × 3.5 km
    const bb = `${(la - dLa).toFixed(5)},${(lo - dLo).toFixed(5)},${(la + dLa).toFixed(5)},${(lo + dLo).toFixed(5)}`;
    try {
      const blob = await fetchOverpass(bb);
      const file = new File([blob], 'area.json'); file.label = 'Район вокруг вас';
      loadFile(file, () => placeMe(la, lo, accuracy));
    } catch (e) { setStatus('Не удалось скачать карту: ' + e.message + '. Попробуйте ещё раз через минуту или загрузите файл вручную.', 'err'); }
  }, err => setStatus('Геопозиция недоступна: ' + (err.code === 1 ? 'доступ запрещён — разрешите его в настройках браузера' : err.message), 'err'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}
function placeMe(la, lo, acc) {
  const x = (lo - M.lon) * M.kx, y = (la - M.lat) * M.ky; ME = { x, y, acc };
  A = nearestNode(x, y); setting = 'B'; markSet(); B = -1; R.fast = null; corridor = null; front = [];
  view.s = Math.max(view.s, 0.6); view.tx = W / 2 - x * view.s; view.ty = H / 2 + y * view.s;
  setStatus($('status').innerHTML + ' <b>Вы на карте (точка A). Теперь нажмите, куда идёте.</b>', 'ok');
  recompute(true); updateLinks();
}
$('locate').onclick = locate; $('locate2').onclick = locate;
$('city').onclick = () => {
  setStatus('Загружаю карту всего Бишкека…', 'busy');
  fetch('data/bishkek.json').then(r => { if (!r.ok) throw new Error('файла ещё нет: он появится после первого запуска ежедневного обновления'); return r.json(); })
    .then(D => { D.meta.city = true; useData(D, 'Бишкек (OSM от ' + (D.meta.updated || '?') + ')'); })
    .catch(e => setStatus('Не удалось: ' + e.message, 'err'));
};
['dragover', 'dragenter'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); document.body.classList.add('drag'); }));
['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement) document.body.classList.remove('drag'); }));
document.addEventListener('drop', e => { document.body.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
function loadDemo() {
  setStatus('Загружаю демо…', 'busy');
  fetch('data/demo.json').then(r => r.json()).then(D => {
    const meta = { lat0: 42.8690, lon0: 74.5990, buildings: D.B.length, known: D.B.filter(b => b[0] > 0).length, trees: D.T.length / 2 };
    useData({ meta, B: D.B, V: D.V, PK: D.PK, TR: D.TR, T: D.T, JX: D.JX, S: D.S, defaultAB: [[180, 260], [1000, 1010]] }, 'Демо: центр Бишкека');
  }).catch(e => setStatus('Не удалось загрузить демо: ' + e.message, 'err'));
}
fit(); updateLinks(); loadDemo();

// Web Worker: parses OpenStreetMap data (.osm XML, .osm.gz, Overpass JSON) into the compact local-metre format
// { meta, B:[[h, x,y,...]], V:[[x,y,...]], PK:[[...]], TR:[[...]], T:[x,y,...], JX:[x,y,...], S:[[cls,a,b, x,y,...]] }
'use strict';
const post = (type, data) => self.postMessage(Object.assign({ type }, data));

// ---------- growable stores ----------
class F64 { constructor(n = 1 << 16) { this.a = new Float64Array(n); this.n = 0; } push(v) { if (this.n === this.a.length) { const b = new Float64Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; } view() { return this.a.subarray(0, this.n); } }
const nodeId = new F64(), nodeLat = new F64(), nodeLon = new F64();
const treeNodes = []; // ids of natural=tree nodes
const ways = new Map(); // id -> {refs, tags} (relevant ways + untagged ways for multipolygons)
const rels = []; // {tags, outer:[wayIds]}

const HW_CLS = { footway: 0, path: 0, pedestrian: 0, cycleway: 0, bridleway: 0, corridor: 0, track: 2, steps: 1, service: 2, residential: 2, living_street: 2, unclassified: 2, road: 2, tertiary: 3, tertiary_link: 3, secondary: 4, secondary_link: 4, primary: 5, primary_link: 5, trunk: 5, trunk_link: 5 };
function relevantWay(t) {
  if (t.building && t.building !== 'roof' && t.building !== 'no') return true;
  if (t.highway && t.highway in HW_CLS) return true;
  if (t.natural === 'tree_row' || t.natural === 'wood' || t.natural === 'scrub' || t.landuse === 'forest') return true;
  if (t.leisure === 'park' || t.leisure === 'garden') return true;
  return false;
}
function relevantRel(t) { return t.type === 'multipolygon' && ((t.building && t.building !== 'no') || t.leisure === 'park' || t.leisure === 'garden' || t.natural === 'wood' || t.landuse === 'forest'); }
function addWay(id, refs, tags) { const has = Object.keys(tags).length > 0; if (relevantWay(tags) || !has) ways.set(id, { refs, tags: has ? tags : null }); }

// ---------- XML streaming parser ----------
const ATTR = /(\w[\w:]*)="([^"]*)"/g;
const ent = s => s.indexOf('&') < 0 ? s : s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function attrs(s) { const o = {}; let m; ATTR.lastIndex = 0; while ((m = ATTR.exec(s))) o[m[1]] = m[2]; return o; }
async function parseXML(reader, total, firstText, dec) {
  let buf = firstText, read = 0, cur = null; // cur: {kind, id, tags, refs, members}
  const TAG = /<(\/?)(node|way|relation|nd|tag|member)\b([^>]*)>/g;
  let lastPost = 0;
  const consume = final => {
    const end = final ? buf.length : buf.lastIndexOf('>') + 1;
    if (end <= 0) return;
    const chunk = buf.slice(0, end); buf = buf.slice(end);
    TAG.lastIndex = 0; let m;
    while ((m = TAG.exec(chunk))) {
      const close = m[1] === '/', name = m[2], body = m[3], selfClose = body.endsWith('/');
      if (close) {
        if (cur && cur.kind === name) finish(cur), cur = null;
        continue;
      }
      if (name === 'node') {
        const a = attrs(body); nodeId.push(+a.id); nodeLat.push(+a.lat); nodeLon.push(+a.lon);
        if (!selfClose) cur = { kind: 'node', id: +a.id, tags: {} };
      } else if (name === 'way') {
        const a = attrs(body); cur = { kind: 'way', id: +a.id, tags: {}, refs: [] }; if (selfClose) finish(cur), cur = null;
      } else if (name === 'relation') {
        const a = attrs(body); cur = { kind: 'relation', id: +a.id, tags: {}, members: [] }; if (selfClose) cur = null;
      } else if (!cur) continue;
      else if (name === 'nd') { const i = body.indexOf('ref="'); cur.refs.push(+body.slice(i + 5, body.indexOf('"', i + 5))); }
      else if (name === 'tag') { const a = attrs(body); cur.tags[ent(a.k)] = ent(a.v); }
      else if (name === 'member') { const a = attrs(body); if (a.type === 'way') cur.members.push([+a.ref, a.role]); }
    }
  };
  const finish = c => {
    if (c.kind === 'node') { if (c.tags.natural === 'tree') treeNodes.push(c.id); }
    else if (c.kind === 'way') addWay(c.id, c.refs, c.tags);
    else if (c.kind === 'relation' && relevantRel(c.tags)) rels.push({ tags: c.tags, outer: c.members.filter(m => m[1] === 'outer' || m[1] === '').map(m => m[0]) });
  };
  consume(false);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    read += value.length; buf += dec.decode(value, { stream: true });
    if (buf.length > 1 << 20) consume(false);
    const now = Date.now(); if (now - lastPost > 250) { post('progress', { phase: 'Чтение файла', read }); lastPost = now; }
  }
  buf += dec.decode(); consume(true);
}
function parseJSON(text) {
  const j = JSON.parse(text);
  const els = j.elements || (j.features ? null : []);
  if (!els) throw new Error('GeoJSON пока не поддерживается: нужен .osm или Overpass JSON');
  for (const e of els) {
    if (e.type === 'node') { nodeId.push(e.id); nodeLat.push(e.lat); nodeLon.push(e.lon); if (e.tags && e.tags.natural === 'tree') treeNodes.push(e.id); }
    else if (e.type === 'way') addWay(e.id, e.nodes || [], e.tags || {});
    else if (e.type === 'relation' && e.tags && relevantRel(e.tags)) rels.push({ tags: e.tags, outer: (e.members || []).filter(m => m.type === 'way' && (m.role === 'outer' || m.role === '')).map(m => m.ref) });
  }
}

// ---------- geometry ----------
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1]; let md = 0, mi = 0; const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  for (let i = 1; i < pts.length - 1; i++) { const d = L ? Math.abs(dx * (a[1] - pts[i][1]) - dy * (a[0] - pts[i][0])) / L : Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]); if (d > md) { md = d; mi = i; } }
  if (md <= tol) return [a, b];
  return dp(pts.slice(0, mi + 1), tol).slice(0, -1).concat(dp(pts.slice(mi), tol));
}
function ring(pts, tol) {
  pts = pts.slice(0, -1); if (pts.length < 4) return pts;
  let fi = 0, fd = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; fi = i; } }
  const A = dp(pts.slice(0, fi + 1), tol), B = dp(pts.slice(fi).concat([pts[0]]), tol);
  return A.slice(0, -1).concat(B.slice(0, -1));
}
const DEF_BY_TYPE = { house: 6, detached: 6, semidetached_house: 6, bungalow: 4, garage: 3, garages: 3, shed: 3, hut: 3, kiosk: 3, roof: 4, apartments: 15, residential: 12, dormitory: 15, hotel: 18, office: 15, commercial: 12, retail: 6, school: 12, university: 15, hospital: 15, industrial: 8, warehouse: 8, church: 15, mosque: 15 };
function heightOf(t) { // >0 known, <0 default guess
  const h = parseFloat(t.height); if (h > 0 && h < 400) return Math.round(h);
  const lv = parseFloat(t['building:levels']); if (lv > 0 && lv < 120) return Math.round(lv * 3.2 + 1);
  return -(DEF_BY_TYPE[t.building] || 9);
}

async function build() {
  post('progress', { phase: 'Индекс узлов' });
  const ids = nodeId.view(); let sorted = true; for (let i = 1; i < ids.length; i++) if (ids[i] < ids[i - 1]) { sorted = false; break; }
  let IDS = ids, LAT = nodeLat.view(), LON = nodeLon.view();
  if (!sorted) { const ord = Array.from({ length: ids.length }, (_, i) => i).sort((a, b) => ids[a] - ids[b]); IDS = Float64Array.from(ord, i => ids[i]); LAT = Float64Array.from(ord, i => nodeLat.a[i]); LON = Float64Array.from(ord, i => nodeLon.a[i]); }
  const find = id => { let lo = 0, hi = IDS.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (IDS[m] === id) return m; if (IDS[m] < id) lo = m + 1; else hi = m - 1; } return -1; };
  // centre from relevant ways
  let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180, any = false;
  for (const w of ways.values()) { if (!w.tags) continue; for (const r of w.refs) { const k = find(r); if (k < 0) continue; any = true; if (LAT[k] < la0) la0 = LAT[k]; if (LAT[k] > la1) la1 = LAT[k]; if (LON[k] < lo0) lo0 = LON[k]; if (LON[k] > lo1) lo1 = LON[k]; } }
  if (!any) throw new Error('В файле не найдено ни улиц, ни зданий');
  const lat0 = (la0 + la1) / 2, lon0 = (lo0 + lo1) / 2, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110574;
  const P = k => [Math.round((LON[k] - lon0) * kx * 10) / 10, Math.round((LAT[k] - lat0) * ky * 10) / 10];
  const geom = refs => { const out = []; for (const r of refs) { const k = find(r); if (k < 0) return null; out.push(P(k)); } return out; };
  const B = [], V = [], PK = [], TR = [], T = [];
  const addPoly = (tags, refs) => {
    if (refs.length < 4 || refs[0] !== refs[refs.length - 1]) return;
    const g = geom(refs); if (!g) return;
    if (tags.building && tags.building !== 'roof' && tags.building !== 'no') { const r = ring(g, 1.2); if (r.length >= 3) B.push([heightOf(tags)].concat(r.flat())); }
    else if (tags.natural === 'wood' || tags.natural === 'scrub' || tags.landuse === 'forest') { const r = ring(g, 2); if (r.length >= 3) V.push(r.flat()); }
    else if (tags.leisure === 'park' || tags.leisure === 'garden') { const r = ring(g, 3); if (r.length >= 3) PK.push(r.flat()); }
  };
  post('progress', { phase: 'Здания и зелень' });
  for (const w of ways.values()) {
    if (!w.tags) continue; const t = w.tags;
    if (t.natural === 'tree_row') { const g = geom(w.refs); if (g) TR.push(dp(g, 1.5).flat()); continue; }
    if (!t.highway) addPoly(t, w.refs);
  }
  for (const r of rels) for (const wid of r.outer) { const w = ways.get(wid); if (w) addPoly(r.tags, w.refs); }
  for (const id of treeNodes) { const k = find(id); if (k >= 0) T.push(...P(k)); }
  post('progress', { phase: 'Пешеходный граф' });
  const HW = [];
  for (const w of ways.values()) {
    const t = w.tags; if (!t || !t.highway || !(t.highway in HW_CLS)) continue;
    if (t.area === 'yes') continue;
    if ((t.foot === 'no' || t.access === 'private' || t.access === 'no') && t.foot !== 'yes' && t.foot !== 'designated') continue;
    HW.push(w);
  }
  const cnt = new Map(); for (const w of HW) for (const r of w.refs) cnt.set(r, (cnt.get(r) || 0) + 1);
  const J = new Map(), JX = []; const jid = r => { let i = J.get(r); if (i === undefined) { i = J.size; J.set(r, i); JX.push(...P(find(r))); } return i; };
  const S = [];
  for (const w of HW) {
    const c = HW_CLS[w.tags.highway]; const ns = w.refs.filter(r => find(r) >= 0); let st = 0;
    for (let k = 1; k < ns.length; k++) {
      if (k === ns.length - 1 || cnt.get(ns[k]) > 1) {
        const seg = ns.slice(st, k + 1); const pts = dp(seg.map(r => P(find(r))), 1.5);
        S.push([c, jid(seg[0]), jid(seg[seg.length - 1])].concat(pts.slice(1, -1).flat())); st = k;
      }
    }
  }
  const known = B.filter(b => b[0] > 0).length;
  return { meta: { lat0, lon0, nodes: IDS.length, buildings: B.length, known, edges: S.length, trees: T.length / 2 }, B, V, PK, TR, T, JX, S };
}

self.onmessage = async ev => {
  try {
    const file = ev.data.file;
    let stream = file.stream();
    let gz = /\.gz$/i.test(file.name);
    const r0 = stream.getReader(); const first = await r0.read(); r0.releaseLock();
    if (first.value && first.value[0] === 0x1f && first.value[1] === 0x8b) gz = true;
    // rebuild stream with the first chunk
    const rest = stream; const firstChunk = first.value;
    const rd = rest.getReader();
    let s2 = new ReadableStream({ start(c) { if (firstChunk) c.enqueue(firstChunk); }, async pull(c) { const { value, done } = await rd.read(); if (done) c.close(); else c.enqueue(value); } });
    if (gz) s2 = s2.pipeThrough(new DecompressionStream('gzip'));
    const reader = s2.getReader();
    const head = await reader.read(); const dec = new TextDecoder(); const headText = head.value ? dec.decode(head.value, { stream: true }) : '';
    if (headText.trimStart()[0] === '{') {
      let text = headText; for (;;) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); }
      post('progress', { phase: 'Разбор JSON' }); parseJSON(text + dec.decode());
    } else await parseXML(reader, file.size, headText, dec);
    const out = await build();
    post('done', { data: out });
  } catch (e) { post('error', { message: String(e && e.message || e) }); }
};

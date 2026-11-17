import { useEffect, useMemo, useRef, useState } from 'react';
import { askPerson, bookPlaces, chapterPeople, chapterPlaces, GeoData, loadGeo, MapPt, Person } from './geo';
import { PtList } from './Pt';
import { Pt } from './study';

/* ================================================================
   v1.9.4 🗺️ 이 장의 장소 지도 + 👤 이 장의 인물
   - 1장: 이 책에 자주 나오는 곳 / 2장부터: 이 장에 나오는 곳
   - 지도는 앱 안의 그림이라 인터넷 없이도 보임
   - 장소 이름을 누르면 그 이름이 처음 나오는 절로 이동
   ================================================================ */
export function useGeo() {
  const [g, setG] = useState<GeoData | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { loadGeo().then(setG).catch(e => setErr((e as Error).message)); }, []);
  return { g, err };
}

const W = 360, H = 250;

/** 지금 나라 · 바다 이름 (지도를 넓게 볼 때 "어디 부근인지" 알 수 있게) */
const MODERN: [string, number, number, 's' | 'c', ...number[]][] = [
  ['이집트', 30.0, 26.5, 'c'], ['리비아', 20.5, 28.5, 'c'], ['사우디아라비아', 44.0, 24.5, 'c'], ['요르단', 36.9, 30.9, 'c'],
  ['이스라엘', 34.9, 31.3, 'c', 34.8, 30.6], ['레바논', 35.9, 33.9, 'c'], ['시리아', 38.6, 35.0, 'c'], ['이라크', 43.6, 33.0, 'c'],
  ['이란', 53.0, 32.5, 'c'], ['튀르키예', 34.0, 39.2, 'c', 31.5, 38.6, 29.5, 38.2], ['키프로스', 33.2, 35.1, 'c'], ['그리스', 22.0, 39.4, 'c', 22.1, 37.3, 21.3, 38.8, 22.3, 36.9, 21.0, 39.6],
  ['이탈리아', 13.0, 42.6, 'c'], ['지중해', 18.0, 34.0, 's'], ['홍해', 37.6, 21.5, 's'], ['페르시아만', 51.3, 27.2, 's'],
  ['흑해', 34.5, 43.2, 's'], ['카스피해', 51.0, 41.5, 's'],
];

export function PlaceMap({ pts, onVerse }: { pts: MapPt[]; onVerse?: (v: number) => void }) {
  const { g } = useGeo();
  // 부모가 다시 그려질 때마다 새 배열이 오므로 내용으로 비교
  const ptsKey = pts.map(p => p.name + p.lon + ',' + p.lat).join('|');
  const view = useMemo(() => {
    if (!pts.length) return null;
    let x0 = Math.min(...pts.map(p => p.lon)), x1 = Math.max(...pts.map(p => p.lon));
    let y0 = Math.min(...pts.map(p => p.lat)), y1 = Math.max(...pts.map(p => p.lat));
    const midLat = (y0 + y1) / 2;
    const cos = Math.cos((midLat * Math.PI) / 180);
    // 점이 하나면 넓게(주변 나라까지), 여러 개면 그 곳들이 잘 보이게 가까이
    const uniq = new Set(pts.map(p => p.lon.toFixed(2) + ',' + p.lat.toFixed(2))).size;
    const minW = uniq <= 1 ? 4 : 1.1;
    let w = Math.max((x1 - x0) * cos, minW), h = Math.max(y1 - y0, minW * (H / W));
    w *= 1.35; h *= 1.35;
    if (w / h > W / H) h = w * (H / W); else w = h * (W / H);
    const cx = ((x0 + x1) / 2) * cos, cy = (y0 + y1) / 2;
    const k = W / w;
    const px = (lon: number) => (lon * cos - (cx - w / 2)) * k;
    const py = (lat: number) => ((cy + h / 2) - lat) * k;
    return { px, py, k, cos };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptsKey]);

  /* 🔍 확대 · 축소 · 옮기기 (두 손가락 벌리기/모으기, 확대한 뒤 한 손가락으로 옮기기, +/− 버튼) */
  const [z, setZ] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  useEffect(() => { setZ(1); setOff({ x: 0, y: 0 }); }, [ptsKey]);
  const lim = useMemo(() => view ? { min: Math.min(1, W / (75 * view.k)), max: Math.min(6, Math.max(1, W / (1.0 * view.k))) } : { min: 1, max: 1 }, [view]);
  const live = useRef({ z, off, lim });
  live.current = { z, off, lim };
  const svgRef = useRef<SVGSVGElement>(null);
  const moved = useRef(0);
  const zoomAt = (nz: number, cx = W / 2, cy = H / 2) => {
    const { z: z0, off: o0, lim: l } = live.current;
    nz = Math.min(l.max, Math.max(l.min, nz));
    // (cx, cy) 지점이 그대로 있게
    const vx0 = W / 2 + o0.x - W / (2 * z0), vy0 = H / 2 + o0.y - H / (2 * z0);
    const bx = vx0 + cx / z0, by = vy0 + cy / z0;
    const vx = bx - cx / nz, vy = by - cy / nz;
    setZ(nz); setOff({ x: vx + W / (2 * nz) - W / 2, y: vy + H / (2 * nz) - H / 2 });
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const unit = () => W / (el.clientWidth || W);
    const loc = (t: Touch) => { const r = el.getBoundingClientRect(); return { x: (t.clientX - r.left) * unit(), y: (t.clientY - r.top) * unit() }; };
    let mode: '' | 'pinch' | 'pan' = '';
    let d0 = 0, z0 = 1, o0 = { x: 0, y: 0 }, c0 = { x: 0, y: 0 }, p0 = { x: 0, y: 0 };
    const zoomed = () => live.current.z !== 1 || live.current.off.x !== 0 || live.current.off.y !== 0;
    const start = (e: TouchEvent) => {
      e.stopPropagation(); // 지도 위에서는 장 넘기기 안 함
      if (e.touches.length >= 2) {
        const a = loc(e.touches[0]), b = loc(e.touches[1]);
        mode = 'pinch'; d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; z0 = live.current.z; o0 = live.current.off;
        c0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        e.preventDefault();
      } else if (zoomed()) {
        mode = 'pan'; p0 = loc(e.touches[0]); o0 = live.current.off; moved.current = 0;
      } else mode = '';
    };
    const move = (e: TouchEvent) => {
      e.stopPropagation();
      if (mode === 'pinch' && e.touches.length >= 2) {
        e.preventDefault();
        const a = loc(e.touches[0]), b = loc(e.touches[1]);
        const l = live.current.lim;
        const nz = Math.min(l.max, Math.max(l.min, z0 * Math.hypot(a.x - b.x, a.y - b.y) / d0));
        const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const vx0 = W / 2 + o0.x - W / (2 * z0), vy0 = H / 2 + o0.y - H / (2 * z0);
        const bx = vx0 + c0.x / z0, by = vy0 + c0.y / z0;
        const vx = bx - c.x / nz, vy = by - c.y / nz;
        setZ(nz); setOff({ x: vx + W / (2 * nz) - W / 2, y: vy + H / (2 * nz) - H / 2 });
      } else if (mode === 'pan' && e.touches.length === 1) {
        e.preventDefault();
        const p = loc(e.touches[0]);
        moved.current = Math.hypot(p.x - p0.x, p.y - p0.y);
        const zz = live.current.z;
        setOff({ x: o0.x - (p.x - p0.x) / zz, y: o0.y - (p.y - p0.y) / zz });
      }
    };
    const end = (e: TouchEvent) => { e.stopPropagation(); if (e.touches.length === 0) mode = ''; else if (mode === 'pinch' && e.touches.length === 1) { mode = 'pan'; p0 = loc(e.touches[0]); o0 = live.current.off; } };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(live.current.z * (e.deltaY < 0 ? 1.25 : 0.8), (e.clientX - r.left) * unit(), (e.clientY - r.top) * unit());
    };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end); el.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, view]);

  const base = useMemo(() => {
    if (!g || !view) return null;
    const { px, py } = view;
    const path = (rings: number[][][], close: boolean) => rings.map(r => {
      let d = '';
      for (let i = 0; i < r.length; i++) d += (i ? 'L' : 'M') + px(r[i][0] / 100).toFixed(1) + ' ' + py(r[i][1] / 100).toFixed(1);
      return close ? d + 'Z' : d;
    }).join('');
    return { land: path(g.base.land, true), rivers: path(g.base.rivers, false), lakes: path(g.base.lakes, true) };
  }, [g, view]);

  if (!g || !view || !base) return null;
  const { px, py, k } = view;
  const vx = W / 2 + off.x - W / (2 * z), vy = H / 2 + off.y - H / (2 * z);
  const sx = (lon: number) => (px(lon) - vx) * z, sy = (lat: number) => (py(lat) - vy) * z;
  const isZoomed = z !== 1 || off.x !== 0 || off.y !== 0;

  // 이름표 겹치지 않게 (중요한 것부터 자리 잡기)
  const boxes: [number, number, number, number][] = [];
  boxes.push([W - 46, 0, W, 136]); // +/− 버튼 자리는 비워 둠
  const hit = (b: [number, number, number, number]) => boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  const seen = new Set<string>();
  const labels = pts.filter(p => (seen.has(p.name) ? false : (seen.add(p.name), true))).map(p => {
    const x = sx(p.lon), y = sy(p.lat);
    if (x < -10 || x > W + 10 || y < -10 || y > H + 10) return null;
    const tw = p.name.length * 12.5 + 4, th = 15;
    const cand: [number, number, 'start' | 'end' | 'middle'][] = [[x + 6, y + 4, 'start'], [x - 6, y + 4, 'end'], [x, y - 8, 'middle'], [x, y + 17, 'middle']];
    for (const [lx, ly, anc] of cand) {
      const left = anc === 'start' ? lx : anc === 'end' ? lx - tw : lx - tw / 2;
      const b: [number, number, number, number] = [left, ly - th + 3, left + tw, ly + 3];
      if (b[0] < 0 || b[2] > W || b[1] < 0 || b[3] > H || hit(b)) continue;
      boxes.push(b);
      return { p, x, y, lx, ly, anc };
    }
    return { p, x, y, lx: 0, ly: 0, anc: null as null | string };
  }).filter((l): l is NonNullable<typeof l> => !!l);
  labels.forEach(l => boxes.push([l.x - 4, l.y - 4, l.x + 4, l.y + 4]));
  // 넓게 볼 때(가로 5도 넘게)만 지금 나라 · 바다 이름
  const spanDeg = W / (k * z);
  const modern = spanDeg < 5 ? [] : MODERN.map(([n, lon0, lat0, t, ...alt]) => {
    const tries: [number, number][] = [[lon0, lat0]];
    for (let i = 0; i + 1 < alt.length; i += 2) tries.push([alt[i], alt[i + 1]]);
    for (const [lon, lat] of tries) {
      const x = sx(lon), y = sy(lat), tw = n.length * 11, b: [number, number, number, number] = [x - tw / 2, y - 11, x + tw / 2, y + 3];
      if (b[0] < 0 || b[2] > W || b[1] < 0 || b[3] > H || hit(b)) continue;
      boxes.push(b);
      return { n, x, y, t };
    }
    return null;
  }).filter((m): m is NonNullable<typeof m> => !!m);

  return (
    <div className="geo-wrap">
      <svg ref={svgRef} className={'geo-map' + (isZoomed ? ' zoomed' : '')} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="장소 지도">
        <rect x="0" y="0" width={W} height={H} className="geo-sea" />
        <g transform={`scale(${z}) translate(${-vx} ${-vy})`}>
          <path d={base.land} className="geo-land" vectorEffect="non-scaling-stroke" />
          <path d={base.rivers} className="geo-river" vectorEffect="non-scaling-stroke" />
          <path d={base.lakes} className="geo-lake" vectorEffect="non-scaling-stroke" />
        </g>
        {modern.map(m => <text key={m.n} x={m.x} y={m.y} textAnchor="middle" className={'geo-modern' + (m.t === 's' ? ' sea' : '')}>{m.n}</text>)}
        {labels.map((l, i) => (
          <g key={i} className={'geo-pt' + (l.p.kind === 'R' ? ' region' : '') + (onVerse && l.p.v ? ' tap' : '')}
            onClick={onVerse && l.p.v ? () => { if (moved.current < 6) onVerse(l.p.v!); } : undefined}>
            <circle cx={l.x} cy={l.y} r={l.p.kind === 'R' ? 4 : 5} />
            {l.anc && <text x={l.lx} y={l.ly} textAnchor={l.anc as 'start'}>{l.p.name}</text>}
          </g>
        ))}
      </svg>
      <div className="geo-zoom">
        <button onClick={() => zoomAt(z * 1.6)} disabled={z >= lim.max} aria-label="확대">+</button>
        <button onClick={() => zoomAt(z / 1.6)} disabled={z <= lim.min} aria-label="축소">−</button>
        {isZoomed && <button onClick={() => { setZ(1); setOff({ x: 0, y: 0 }); }} aria-label="원래대로">⟲</button>}
      </div>
    </div>
  );
}

/** 🗺️ 지도 상자 (1장 = 책 전체 / 2장부터 = 이 장) */
export function GeoMapBox({ book, chapter, bookWide, bookName, onVerse }: { book: number; chapter: number; bookWide: boolean; bookName: string; onVerse?: (v: number) => void }) {
  const { g } = useGeo();
  if (!g) return null;
  const pts = bookWide ? bookPlaces(g, book) : chapterPlaces(g, book, chapter);
  if (!pts.length) return null;
  return (
    <div className="bg-part geo-box">
      <div className="bg-keys-h">🗺️ {bookWide ? `${bookName}에 자주 나오는 곳` : '이 장에 나오는 곳'}</div>
      <PlaceMap pts={pts} onVerse={bookWide ? undefined : onVerse} />
      <div className="geo-names">
        {[...new Set(pts.map(p => p.name))].map(n => {
          const p = pts.find(x => x.name === n)!;
          return !bookWide && onVerse && p.v
            ? <button key={n} className="geo-chip" onClick={() => onVerse(p.v!)}>{n}<small>{p.v}절</small></button>
            : <span key={n} className="geo-chip">{n}</span>;
        })}
      </div>
    </div>
  );
}

/** 👤 이 장의 인물 — 이름을 누르면 짧은 소개 (Easton 성경사전 원문을 쉬운 말로) */
export function PeopleBox({ book, chapter }: { book: number; chapter: number }) {
  const { g } = useGeo();
  const [open, setOpen] = useState<string | null>(null);
  if (!g) return null;
  const ps = chapterPeople(g, book, chapter);
  if (!ps.length) return null;
  const cur = ps.find(p => p.id + p.name === open);
  return (
    <div className="bg-part people-box">
      <div className="bg-keys-h">👤 이 장의 인물</div>
      <div className="geo-names">
        {ps.map(p => (
          <button key={p.id + p.name} className={'geo-chip person' + (open === p.id + p.name ? ' on' : '')} onClick={() => setOpen(o => (o === p.id + p.name ? null : p.id + p.name))}>{p.name}</button>
        ))}
      </div>
      {cur && <PersonInfo key={cur.id} p={cur} />}
    </div>
  );
}

function PersonInfo({ p }: { p: Person }) {
  const [st, setSt] = useState<{ pts?: Pt[]; none?: boolean; err?: string; loading: boolean }>({ loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setSt(s => ({ ...s, loading: true, err: undefined }));
    askPerson(p, ctl.signal, n > 0)
      .then(r => setSt({ pts: r.pts, none: r.none, loading: false }))
      .catch(e => { if (!ctl.signal.aborted) setSt({ err: (e as Error).message, loading: false }); });
    return () => ctl.abort();
  }, [p, n]);
  return (
    <div className="person-info">
      {st.loading && !st.pts && <div className="busy" style={{ padding: '4px 0' }}><div className="spinner small" /> 번역 중…</div>}
      {st.err && <div className="ai-err">⚠️ {st.err} <button className="link-btn" onClick={() => setN(x => x + 1)}>다시 시도</button></div>}
      {st.pts && (st.pts.length ? <PtList pts={st.pts} /> : <p className="desc muted">소개 없음</p>)}
      {st.pts && <div className="person-src muted small">출처: Easton 성경사전</div>}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
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

export function PlaceMap({ pts, onVerse }: { pts: MapPt[]; onVerse?: (v: number) => void }) {
  const { g } = useGeo();
  const view = useMemo(() => {
    if (!pts.length) return null;
    let x0 = Math.min(...pts.map(p => p.lon)), x1 = Math.max(...pts.map(p => p.lon));
    let y0 = Math.min(...pts.map(p => p.lat)), y1 = Math.max(...pts.map(p => p.lat));
    const midLat = (y0 + y1) / 2;
    const cos = Math.cos((midLat * Math.PI) / 180);
    // 최소 범위 (점이 하나뿐이어도 주변이 보이게) + 여백
    // 점이 하나면 넓게(주변 나라까지), 여러 개면 그 곳들이 잘 보이게 가까이
    const uniq = new Set(pts.map(p => p.lon.toFixed(2) + ',' + p.lat.toFixed(2))).size;
    const minW = uniq <= 1 ? 4 : 1.1;
    let w = Math.max((x1 - x0) * cos, minW), h = Math.max(y1 - y0, minW * (H / W));
    w *= 1.35; h *= 1.35;
    // 화면 비율에 맞춤
    if (w / h > W / H) h = w * (H / W); else w = h * (W / H);
    const cx = ((x0 + x1) / 2) * cos, cy = (y0 + y1) / 2;
    const k = W / w;
    const px = (lon: number) => (lon * cos - (cx - w / 2)) * k;
    const py = (lat: number) => ((cy + h / 2) - lat) * k;
    return { px, py, k };
  }, [pts]);

  if (!g || !view) return null;
  const { px, py } = view;
  const path = (rings: number[][][], close: boolean) => rings.map(r => {
    let d = '';
    for (let i = 0; i < r.length; i++) d += (i ? 'L' : 'M') + px(r[i][0] / 100).toFixed(1) + ' ' + py(r[i][1] / 100).toFixed(1);
    return close ? d + 'Z' : d;
  }).join('');

  // 이름표 겹치지 않게 (중요한 것부터 자리 잡기)
  const boxes: [number, number, number, number][] = [];
  const hit = (b: [number, number, number, number]) => boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  const seen = new Set<string>();
  const labels = pts.filter(p => (seen.has(p.name) ? false : (seen.add(p.name), true))).map(p => {
    const x = px(p.lon), y = py(p.lat);
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
  });
  labels.forEach(l => boxes.push([l.x - 4, l.y - 4, l.x + 4, l.y + 4]));

  return (
    <svg className="geo-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="장소 지도">
      <rect x="0" y="0" width={W} height={H} className="geo-sea" />
      <path d={path(g.base.land, true)} className="geo-land" />
      <path d={path(g.base.rivers, false)} className="geo-river" />
      <path d={path(g.base.lakes, true)} className="geo-lake" />
      {labels.map((l, i) => (
        <g key={i} className={'geo-pt' + (l.p.kind === 'R' ? ' region' : '') + (onVerse && l.p.v ? ' tap' : '')}
          onClick={onVerse && l.p.v ? () => onVerse(l.p.v!) : undefined}>
          <circle cx={l.x} cy={l.y} r={l.p.kind === 'R' ? 3.2 : 4} />
          {l.anc && <text x={l.lx} y={l.ly} textAnchor={l.anc as 'start'}>{l.p.name}</text>}
        </g>
      ))}
    </svg>
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
      {st.loading && !st.pts && <div className="busy" style={{ padding: '4px 0' }}><div className="spinner small" /> {p.name} 소개를 찾아 번역하는 중…</div>}
      {st.err && <div className="ai-err">⚠️ {st.err} <button className="link-btn" onClick={() => setN(x => x + 1)}>다시 시도</button></div>}
      {st.pts && (st.pts.length ? <PtList pts={st.pts} /> : <p className="desc muted">성경사전에 이 인물의 소개가 없습니다.</p>)}
      {st.pts && <div className="person-src muted small">Easton 성경사전(1897) · 쉬운 말 번역</div>}
    </div>
  );
}

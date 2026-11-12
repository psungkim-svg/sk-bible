import { useEffect, useState } from 'react';
import { Chev } from './ToolIcons';
import { chapterDict, DictItem, loadDictGeo } from './dict';
import { setSettings, useStore } from './store';

/* ================================================================
   v1.10 📖 장 맨 위 "지명·낱말 풀이" — 그 장에 나오는 것만
   🗺️ 그때 이름 → 오늘날 어디 / 📏 단위·돈·시간 / 📖 옛 말
   앱 안의 사전(dict.json)이라 인터넷 없이 바로 보임
   ================================================================ */
const GROUPS: { key: string; title: string; cats: DictItem['cat'][] }[] = [
  { key: 'N', title: '🗺️ 지명 → 오늘날', cats: ['N', 'P'] },
  { key: 'U', title: '📏 단위·돈·시간', cats: ['U'] },
  { key: 'W', title: '📖 옛 말·낯선 말', cats: ['W'] },
];
const PLACE_MAX = 8;

export function WordBox({ book, chapter, onVerse }: { book: number; chapter: number; onVerse?: (v: number) => void }) {
  const open = useStore(s => s.settings.wordsOpen);
  const [items, setItems] = useState<DictItem[] | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let alive = true;
    setItems(null); setMore(false);
    loadDictGeo().then(({ d, g }) => { if (alive) setItems(chapterDict(d, g, book, chapter)); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [book, chapter]);
  if (!items || !items.length) return null;
  const names = items.map(x => x.name);
  return (
    <div className={'word-box' + (open ? ' open' : '')}>
      <button className="wb-head" onClick={() => setSettings({ wordsOpen: !open })}>
        <span className="wb-title">📖 지명·낱말</span>
        {!open && <span className="wb-names">{names.slice(0, 6).join(' · ')}{names.length > 6 ? ` 외 ${names.length - 6}` : ''}</span>}
        <span className="wb-arrow"><Chev open={open} /></span>
      </button>
      {open && (
        <div className="wb-body">
          {GROUPS.map(gr => {
            const list = items.filter(x => gr.cats.includes(x.cat));
            if (!list.length) return null;
            const cut = gr.key === 'N' && !more && list.length > PLACE_MAX + 2;
            return (
              <div key={gr.key} className="wb-group">
                <div className="wb-sec">{gr.title}</div>
                <DictList items={cut ? list.slice(0, PLACE_MAX) : list} onVerse={onVerse} />
                {cut && <button className="link-btn wb-more" onClick={() => setMore(true)}>{list.length - PLACE_MAX}곳 더 보기</button>}
              </div>
            );
          })}
          <p className="desc small muted wb-src">위치는 대략 · 단위는 대략 환산</p>
        </div>
      )}
    </div>
  );
}

export function DictList({ items, onVerse }: { items: DictItem[]; onVerse?: (v: number) => void }) {
  return (
    <div className="wb-list">
      {items.map((x, i) => (
        <div key={i} className="wb-item">
          <b className="wb-name">{x.name}</b>
          <span className="wb-text">{x.text}</span>
          {x.v && onVerse ? <button className="wb-v" onClick={() => onVerse(x.v!)}>{x.v}절</button> : null}
        </div>
      ))}
    </div>
  );
}

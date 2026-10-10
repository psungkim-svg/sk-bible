import { useMemo, useState } from 'react';
import { BibleData, buildCopyText, refLabel } from './bible';
import { goTo, openTab, removeBookmark, updateBookmark, useStore } from './store';
import { copyText, formatDate, toast } from './utils';

export default function BookmarksView({ data }: { data: BibleData }) {
  const bookmarks = useStore(s => s.bookmarks);
  const lastPage = useStore(s => s.lastPage);
  const pageCount = useStore(s => s.settings.pageCount);
  const settings = useStore(s => s.settings);
  const [sort, setSort] = useState<'recent' | 'bible'>('recent');
  const [target, setTarget] = useState(Math.min(lastPage, pageCount - 1));
  const [editing, setEditing] = useState<string | null>(null);
  const [memo, setMemo] = useState('');
  const [filter, setFilter] = useState('');

  const list = useMemo(() => {
    let l = [...bookmarks];
    if (sort === 'bible') l.sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verses[0] - b.verses[0]);
    if (filter.trim()) {
      const f = filter.trim();
      l = l.filter(b => b.memo.includes(f) || refLabel(b.book, b.chapter, b.verses).includes(f) ||
        b.verses.some(v => data[b.book][b.chapter - 1][v - 1]?.includes(f)));
    }
    return l;
  }, [bookmarks, sort, filter, data]);

  const open = (b: typeof bookmarks[number]) => {
    goTo(target, { book: b.book, chapter: b.chapter, verse: b.verses[0] });
    openTab(target as 0);
  };

  return (
    <div className="view">
      <header className="vhead"><h1>북마크</h1><span className="count">{bookmarks.length}개</span></header>
      <div className="view-body">
        <div className="toolbar">
          <div className="seg small">
            <button className={sort === 'recent' ? 'on' : ''} onClick={() => setSort('recent')}>최근순</button>
            <button className={sort === 'bible' ? 'on' : ''} onClick={() => setSort('bible')}>성경순</button>
          </div>
          <PageChooser value={target} count={pageCount} onChange={setTarget} />
        </div>
        {bookmarks.length > 3 && (
          <input className="filter" placeholder="북마크 안에서 찾기 (메모·본문)" value={filter} onChange={e => setFilter(e.target.value)} />
        )}

        {bookmarks.length === 0 && (
          <div className="empty">
            <div className="empty-icon">🔖</div>
            아직 북마크가 없습니다.<br />
            본문에서 절을 <b>눌러 선택</b>한 뒤 <b>북마크</b>를 누르세요.
          </div>
        )}

        {list.map(b => {
          const text = b.verses.map(v => data[b.book][b.chapter - 1][v - 1]).join(' ');
          return (
            <div className="card" key={b.id}>
              <button className="card-main" onClick={() => open(b)}>
                <div className="card-ref">{refLabel(b.book, b.chapter, b.verses)}</div>
                <div className="card-text">{text}</div>
                {b.memo && editing !== b.id && <div className="card-memo">✎ {b.memo}</div>}
              </button>
              {editing === b.id ? (
                <div className="memo-edit">
                  <textarea value={memo} onChange={e => setMemo(e.target.value)} placeholder="메모 (묵상, 설교 제목 등)" rows={3} autoFocus />
                  <div className="row-end">
                    <button onClick={() => setEditing(null)}>취소</button>
                    <button className="primary" onClick={() => { updateBookmark(b.id, { memo: memo.trim() }); setEditing(null); }}>저장</button>
                  </div>
                </div>
              ) : (
                <div className="card-actions">
                  <span className="date">{formatDate(b.createdAt)}</span>
                  <button onClick={async () => {
                    const t = buildCopyText(data, b.book, b.chapter, b.verses, { bookStyle: settings.copyBookStyle, refPosition: settings.copyRefPosition, verseNumbers: settings.copyVerseNumbers });
                    toast((await copyText(t)) ? '복사했습니다 📋' : '복사 실패');
                  }}>복사</button>
                  <button onClick={() => { setEditing(b.id); setMemo(b.memo); }}>메모</button>
                  <button className="danger" onClick={() => { if (confirm('이 북마크를 삭제할까요?')) removeBookmark(b.id); }}>삭제</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PageChooser({ value, count, onChange }: { value: number; count: number; onChange: (n: number) => void }) {
  return (
    <div className="page-chooser">
      <span>열 페이지</span>
      {Array.from({ length: count }, (_, i) => (
        <button key={i} className={value === i ? 'on' : ''} onClick={() => onChange(i)}>{i + 1}</button>
      ))}
    </div>
  );
}

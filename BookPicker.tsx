import { useState } from 'react';
import { BibleData, parseRef, Ref, refLabel } from './bible';
import { BOOKS } from './books';
import { useBackClose } from './utils';

interface Props {
  data: BibleData;
  currentBook: number;
  onSelect: (r: Ref) => void;
  onClose: () => void;
}

export default function BookPicker({ data, currentBook, onSelect, onClose }: Props) {
  const [testament, setTestament] = useState<'OT' | 'NT'>(BOOKS[currentBook].testament);
  const [book, setBook] = useState<number | null>(null);
  const [q, setQ] = useState('');
  useBackClose(true, onClose);

  const parsed = q.trim() ? parseRef(q, data) : null;
  const go = () => { if (parsed) onSelect(parsed); };

  return (
    <div className="overlay">
      <div className="ov-head">
        <button className="icon-btn" onClick={() => (book !== null ? setBook(null) : onClose())} aria-label="뒤로">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </button>
        <div className="ov-title">{book === null ? '성경 선택' : `${BOOKS[book].name} — 장 선택`}</div>
        <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
      </div>

      <div className="quick">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && go()}
          placeholder="빠른 이동  예) 요3:16 · 시23 · 롬8:28"
          enterKeyHint="go"
        />
        <button className="primary" disabled={!parsed} onClick={go}>이동</button>
      </div>
      {q.trim() && (
        <div className="quick-hint">
          {parsed ? <>→ <b>{refLabel(parsed.book, parsed.chapter, parsed.verse ? [parsed.verse] : undefined)}</b></> : '책 이름과 장을 입력하세요 (예: 창1, 요한복음 3:16)'}
        </div>
      )}

      {book === null ? (
        <>
          <div className="seg">
            <button className={testament === 'OT' ? 'on' : ''} onClick={() => setTestament('OT')}>구약 (39)</button>
            <button className={testament === 'NT' ? 'on' : ''} onClick={() => setTestament('NT')}>신약 (27)</button>
          </div>
          <div className="book-grid">
            {BOOKS.map((b, i) => b.testament !== testament ? null : (
              <button key={i} className={'book-btn ' + b.testament + (i === currentBook ? ' cur' : '')} onClick={() => {
                if (data[i].length === 1) onSelect({ book: i, chapter: 1 });
                else setBook(i);
              }}>
                <span className="abbr">{b.abbr}</span>
                <span className="full">{b.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="chap-grid">
          {data[book].map((_, i) => (
            <button key={i} onClick={() => onSelect({ book, chapter: i + 1 })}>{i + 1}</button>
          ))}
        </div>
      )}
    </div>
  );
}

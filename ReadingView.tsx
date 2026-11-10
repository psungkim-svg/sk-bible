import ToolIcons from './ToolIcons';
import { BibleData } from './bible';
import { BOOKS } from './books';
import { clearReadBooks, toggleReadBook, useStore } from './store';

/* ================================================================
   v1.9.3 📋 읽기표
   - 구약 39권 · 신약 27권을 네모 칸으로 (굵은 약자 + 그 아래 장 수)
   - 다 읽은 책의 칸을 누르면 색이 바뀌어 "읽음" 표시 / 다시 누르면 취소
   - 폰에 저장 (설정 → 백업에도 함께 들어감)
   ================================================================ */
export default function ReadingView({ data, active }: { data: BibleData; active: boolean }) {
  const read = useStore(s => s.readBooks);
  const n = (t: 'OT' | 'NT') => BOOKS.filter((b, i) => b.testament === t && read[i]).length;
  const ot = n('OT'), nt = n('NT');

  const grid = (t: 'OT' | 'NT') => (
    <div className="rd-grid">
      {BOOKS.map((b, i) => b.testament !== t ? null : (
        <button key={i} className={'rd-box ' + t + (read[i] ? ' done' : '')} onClick={() => toggleReadBook(i)}
          aria-label={`${b.name} ${data[i].length}${i === 18 ? '편' : '장'}${read[i] ? ' · 읽음' : ''}`} title={b.name}>
          <span className={'rd-ab' + (b.abbr.length > 1 ? ' two' : '')}>{b.abbr}</span>
          <span className="rd-n">{data[i].length}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className={'view' + (active ? '' : ' inactive')}>
      <header className="vhead"><h1>읽기표</h1><ToolIcons /></header>
      <div className="view-body reading">
        <div className="rd-sum">
          읽은 책 <b>{ot + nt}</b> / 66
          <span className="rd-bar"><span style={{ width: `${((ot + nt) / 66) * 100}%` }} /></span>
        </div>
        <p className="rd-help">다 읽은 책의 칸을 누르면 색이 바뀝니다. 잘못 눌렀으면 한 번 더 누르세요. 숫자는 그 책의 장 수입니다.</p>

        <h2 className="rd-h">구약 <span>{ot} / 39</span></h2>
        {grid('OT')}
        <h2 className="rd-h">신약 <span>{nt} / 27</span></h2>
        {grid('NT')}

        {ot + nt > 0 && (
          <button className="rd-clear" onClick={() => { if (confirm('읽기표의 표시를 모두 지울까요?')) clearReadBooks(); }}>
            표시 모두 지우기
          </button>
        )}
      </div>
    </div>
  );
}

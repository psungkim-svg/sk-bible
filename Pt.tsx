import { useState } from 'react';
import { useStore } from './store';

/* ================================================================
   v1.9: 주석 원문에서 고른 문장 하나 (한국어 번역 + 접힌 영어 원문)
   - 평소에는 한국어만 → 양이 늘지 않음
   - 문장 끝 "원문"을 누르면 그 문장의 영어 원문이 바로 아래에 펼쳐짐
   - 설정 → "영어 원문 늘 펼쳐 보기"를 켜면 처음부터 펼쳐짐
   ================================================================ */
export function PtLine({ en, ko, who }: { en: string; ko: string; who?: string }) {
  const always = useStore(s => s.settings.showOrig);
  const [open, setOpen] = useState(false);
  const show = always || open;
  return (
    <li className="pt">
      {who && <b className="pt-who">{who} · </b>}
      <span className="pt-ko">{ko}</span>
      {!always && <button className={'pt-orig-btn' + (open ? ' on' : '')} onClick={() => setOpen(o => !o)} aria-label="영어 원문 보기">원문</button>}
      {show && <div className="pt-en" lang="en">{en}</div>}
    </li>
  );
}

export function PtList({ pts }: { pts: { en: string; ko: string; who?: string }[] }) {
  return <ul className="pt-list">{pts.map((p, i) => <PtLine key={i} en={p.en} ko={p.ko} who={p.who} />)}</ul>;
}

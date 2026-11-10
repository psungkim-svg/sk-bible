import { useState } from 'react';
import { useStore } from './store';

/* ================================================================
   v1.9: 주석 원문에서 고른 문장 하나 (한국어 번역 + 접힌 영어 원문)
   - 평소에는 한국어만 → 양이 늘지 않음
   - 문장 끝 "원문"을 누르면 그 문장의 영어 원문이 바로 아래에 펼쳐짐
   - 설정 → "영어 원문 늘 펼쳐 보기"를 켜면 처음부터 펼쳐짐
   ================================================================ */
export function PtLine({ en, ko, who, tag, noOrig }: { en: string; ko: string; who?: string; tag?: string; noOrig?: boolean }) {
  const always = useStore(s => s.settings.showOrig) && !noOrig;
  const [open, setOpen] = useState(false);
  const show = always || open;
  return (
    <li className="pt">
      {tag && <span className="ps-tag">{tag}</span>}
      {who && <b className="pt-who">{who} · </b>}
      <span className="pt-ko">{ko}</span>
      {!always && !noOrig && <button className={'pt-orig-btn' + (open ? ' on' : '')} onClick={() => setOpen(o => !o)} aria-label="영어 원문 보기">원문</button>}
      {show && <div className="pt-en" lang="en">{en}</div>}
    </li>
  );
}

export function PtList({ pts, noOrig }: { pts: { en: string; ko: string; who?: string }[]; noOrig?: boolean }) {
  return <ul className="pt-list">{pts.map((p, i) => <PtLine key={i} en={p.en} ko={p.ko} who={p.who} noOrig={noOrig} />)}</ul>;
}

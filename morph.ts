/* ================================================================
   원어 문법 코드 → 한국어 설명
   - 히브리어/아람어: OSHB 형태 코드 (예: HVqp3ms = 동사 칼 완료 3인칭 남성 단수)
   - 헬라어: Robinson 코드 (예: V-PAP-NPM = 동사 현재 능동 분사 주격 복수 남성)
   자료: STEPBible.org (CC BY 4.0)
   ================================================================ */

const H_GENDER: Record<string, string> = { m: '남성', f: '여성', b: '양성', c: '공성' };
const H_NUMBER: Record<string, string> = { s: '단수', p: '복수', d: '쌍수' };
const H_STATE: Record<string, string> = { a: '절대형', c: '연계형', d: '한정형' };
const H_PERSON: Record<string, string> = { '1': '1인칭', '2': '2인칭', '3': '3인칭' };

const HEB_STEM: Record<string, string> = {
  q: '칼(단순 능동)', N: '니팔(단순 수동·재귀)', p: '피엘(강조 능동)', P: '푸알(강조 수동)',
  h: '히필(사역 능동)', H: '호팔(사역 수동)', t: '히트파엘(재귀·상호)', o: '포엘', O: '포알',
  r: '히트포엘', m: '포엘', M: '포알', k: '팔렐', K: '풀랄', Q: '칼 수동', l: '필펠', L: '폴팔',
  f: '히트팔펠', D: '니트파엘', j: '페알랄', i: '필렐', u: '호트파알', c: '티필', v: '히쉬타펠',
  w: '니트팔렐', y: '니트포엘', z: '히트포엘',
};
const ARAM_STEM: Record<string, string> = {
  q: '프알(단순 능동)', Q: '프일(단순 수동)', u: '히트프엘(수동·재귀)', p: '파엘(강조 능동)',
  P: '이트파알(강조 수동)', M: '히트파알(강조 재귀)', a: '아펠(사역)', h: '하펠(사역 능동)',
  s: '사펠', e: '샤펠', H: '호팔(사역 수동)', i: '이트프엘', t: '히쉬타펠', v: '이쉬타펠',
  w: '히트하펠', o: '폴렐', z: '이트포엘', r: '히트폴렐', f: '히트팔펠', b: '헤팔', c: '티펠',
  m: '포엘', l: '팔펠', L: '이트팔펠', O: '이트폴렐', G: '이타팔',
};
const H_CONJ: Record<string, string> = {
  p: '완료', q: '바브연속 완료', i: '미완료', w: '바브연속 미완료', h: '청유형', j: '지시형',
  v: '명령형', r: '능동 분사', s: '수동 분사', a: '부정사 절대형', c: '부정사 연계형',
};

function hebPart(code: string, aram: boolean): string {
  if (!code) return '';
  const pos = code[0];
  const r = code.slice(1);
  const g = (s: string) => H_GENDER[s] ?? '';
  const n = (s: string) => H_NUMBER[s] ?? '';
  const st = (s: string) => H_STATE[s] ?? '';
  const pe = (s: string) => H_PERSON[s] ?? '';
  const join = (...a: string[]) => a.filter(Boolean).join(' ');
  switch (pos) {
    case 'V': {
      const stem = (aram ? ARAM_STEM : HEB_STEM)[r[0]] ?? r[0];
      const conj = H_CONJ[r[1]] ?? '';
      if (r[1] === 'r' || r[1] === 's') return join('동사', stem, conj, g(r[2]), n(r[3]), st(r[4]));
      if (r[1] === 'a' || r[1] === 'c') return join('동사', stem, conj);
      return join('동사', stem, conj, pe(r[2]), g(r[3]), n(r[4]));
    }
    case 'N': {
      const t = r[0] === 'p' ? '고유명사' : r[0] === 'g' ? '족속 명사' : '명사';
      if (r[0] === 'p') return t + (r[1] === 'm' ? '(남자 이름)' : r[1] === 'f' ? '(여자 이름)' : r[1] === 'l' ? '(지명)' : r[1] === 't' ? '(칭호)' : '');
      return join(t, g(r[1]), n(r[2]), st(r[3]));
    }
    case 'A': {
      const t = r[0] === 'c' ? '기수' : r[0] === 'o' ? '서수' : r[0] === 'g' ? '족속 형용사' : '형용사';
      return join(t, g(r[1]), n(r[2]), st(r[3]));
    }
    case 'P': {
      const t: Record<string, string> = { d: '지시대명사', f: '부정대명사', i: '의문대명사', p: '인칭대명사', r: '관계대명사' };
      if (r[0] === 'p') return join(t.p, pe(r[1]), g(r[2]), n(r[3]));
      return join(t[r[0]] ?? '대명사', g(r[1]), n(r[2]));
    }
    case 'S': {
      if (r[0] === 'd') return '방향 접미어(~로)';
      if (r[0] === 'h') return '첨가 헤';
      if (r[0] === 'n') return '첨가 눈';
      return join('대명사 접미어', pe(r[1]), g(r[2]), n(r[3])) + suffixMeaning(r[1], r[2], r[3]);
    }
    case 'T': {
      const t: Record<string, string> = {
        a: '긍정 불변사', d: '정관사(그)', e: '권유 불변사', i: '의문 불변사', j: '감탄사',
        m: '지시 불변사', n: '부정어(아니)', o: '목적격 표지(에트)', r: '관계 불변사',
      };
      return t[r[0]] ?? '불변사';
    }
    case 'R': return r[0] === 'd' ? '전치사(+정관사)' : '전치사';
    case 'C': return '접속사';
    case 'D': return '부사';
    default: return code;
  }
}

function suffixMeaning(p: string, g: string, n: string) {
  const k = p + (n || 's');
  const m: Record<string, string> = {
    '1s': '나의/나를', '1p': '우리의/우리를', '2s': g === 'f' ? '너(여)의' : '너의/너를', '2p': '너희의/너희를',
    '3s': g === 'f' ? '그녀의/그녀를' : '그의/그를', '3p': '그들의/그들을',
  };
  return m[k] ? ` (${m[k]})` : '';
}

export function decodeHebrew(code: string): string {
  if (!code) return '';
  const aram = code[0] === 'A';
  const body = code.slice(1);
  return body.split('/').map(p => hebPart(p, aram)).filter(Boolean).join(' + ') + (aram ? ' · 아람어' : '');
}

/* ---------- 헬라어 ---------- */
const G_CASE: Record<string, string> = { N: '주격', G: '속격', D: '여격', A: '대격', V: '호격' };
const G_NUM: Record<string, string> = { S: '단수', P: '복수' };
const G_GEN: Record<string, string> = { M: '남성', F: '여성', N: '중성' };
const G_TENSE: Record<string, string> = { P: '현재', I: '미완료', F: '미래', A: '부정과거', R: '완료', L: '과거완료', X: '' };
const G_VOICE: Record<string, string> = {
  A: '능동', M: '중간', P: '수동', E: '중간/수동', D: '중간(디포넌트)', O: '수동(디포넌트)', N: '중간/수동(디포넌트)', Q: '능동', X: '',
};
const G_MOOD: Record<string, string> = { I: '직설법', S: '가정법', O: '희구법', M: '명령법', N: '부정사', P: '분사', R: '분사(명령 뜻)' };
const G_POS: Record<string, string> = {
  N: '명사', A: '형용사', T: '관사', P: '인칭대명사', R: '관계대명사', C: '상호대명사', D: '지시대명사',
  K: '상관대명사', I: '의문대명사', X: '부정대명사', Q: '상관 의문사', F: '재귀대명사', S: '소유대명사',
};
const G_WORD: Record<string, string> = {
  CONJ: '접속사', 'CONJ-N': '접속사(부정)', COND: '조건 접속사', PREP: '전치사', ADV: '부사', 'ADV-N': '부사(부정)',
  'ADV-I': '의문 부사', 'ADV-C': '부사(비교급)', 'ADV-S': '부사(최상급)', PRT: '불변사', 'PRT-N': '부정어(아니)',
  'PRT-I': '의문 불변사', INJ: '감탄사', HEB: '히브리어 음역', ARAM: '아람어 음역', 'ARAM-T': '아람어 음역',
};

function caseNumGen(s: string) {
  const out: string[] = [];
  for (const ch of s) {
    if (G_CASE[ch] && out.length === 0) out.push(G_CASE[ch]);
    else if (G_NUM[ch] && !out.some(x => x === '단수' || x === '복수')) out.push(G_NUM[ch]);
    else if (G_GEN[ch]) out.push(G_GEN[ch]);
  }
  return out;
}

export function decodeGreek(code: string): string {
  if (!code) return '';
  if (G_WORD[code]) return G_WORD[code];
  const parts = code.split('-');
  const pos = parts[0];
  if (pos === 'V') {
    let tvm = parts[1] ?? '';
    let second = '';
    if (tvm[0] === '2') { second = '제2'; tvm = tvm.slice(1); }
    const tense = (second ? second + ' ' : '') + (G_TENSE[tvm[0]] ?? '');
    const voice = G_VOICE[tvm[1]] ?? '';
    const mood = G_MOOD[tvm[2]] ?? '';
    const rest = parts[2] ?? '';
    let tail: string[] = [];
    if (/^[123]/.test(rest)) tail = [rest[0] + '인칭', G_NUM[rest[1]] ?? ''];
    else if (rest) tail = caseNumGen(rest);
    return ['동사', tense, voice, mood, ...tail].filter(Boolean).join(' ');
  }
  if (pos === 'N' && parts[1] === 'PRI') return '고유명사(격변화 없음)';
  if (pos === 'N' && parts[1] === 'LI') return '문자';
  if (pos === 'N' && parts[1] === 'OI') return '명사(격변화 없음)';
  if (pos === 'A' && parts[1] === 'NUI') return '수사(격변화 없음)';
  const name = G_POS[pos];
  if (!name) return code;
  let p1 = parts[1] ?? '';
  const extra: string[] = [];
  if (/^[123]/.test(p1)) {
    extra.push(p1[0] + '인칭');
    p1 = p1.slice(1);
    if (pos === 'S' && p1.length === 4) { extra.push('(소유자 ' + (G_NUM[p1[0]] ?? '') + ')'); p1 = p1.slice(1); }
  }
  const tail = caseNumGen(p1);
  const suf = parts[2] === 'C' ? '비교급' : parts[2] === 'S' ? '최상급' : '';
  return [name, ...extra, ...tail, suf].filter(Boolean).join(' ');
}

export function decodeMorph(code: string, greek: boolean) {
  try { return greek ? decodeGreek(code) : decodeHebrew(code); } catch { return code; }
}

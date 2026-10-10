import { useRef } from 'react';
import { DEFAULT_SETTINGS, exportBackup, importBackup, setSettings, Settings, useStore } from '../store';
import { toast } from '../utils';

const PRESETS: [string, number][] = [['작게', 16], ['보통', 19], ['크게', 23], ['아주 크게', 28]];

export default function SettingsView() {
  const s = useStore(st => st.settings);
  const bmCount = useStore(st => st.bookmarks.length);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ [k]: v } as Partial<Settings>);

  const doExport = async () => {
    const json = exportBackup();
    const d = new Date();
    const name = `SK성경-백업-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    const file = new File([json], name, { type: 'application/json' });
    // 휴대폰: 공유(카카오톡, 드라이브 등)로 보내기 / 안 되면 다운로드
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'SK-성경 백업' }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('백업 파일을 저장했습니다');
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      const replace = confirm('확인 = 지금 데이터를 백업 내용으로 "바꾸기"\n취소 = 지금 데이터에 "합치기" (북마크·형광펜만)');
      importBackup(text, replace ? 'replace' : 'merge');
      toast('백업을 불러왔습니다 ✅');
    } catch (err) {
      alert('불러오기 실패: ' + (err as Error).message);
    }
  };

  return (
    <div className="view">
      <header className="vhead"><h1>설정</h1></header>
      <div className="view-body settings">

        <section>
          <h3>글자 크기</h3>
          <div className="seg">
            {PRESETS.map(([label, size]) => (
              <button key={label} className={s.fontSize === size ? 'on' : ''} onClick={() => set('fontSize', size)}>{label}</button>
            ))}
          </div>
          <div className="slider-row">
            <span style={{ fontSize: 14 }}>가</span>
            <input type="range" min={13} max={40} step={1} value={s.fontSize} onChange={e => set('fontSize', +e.target.value)} />
            <span style={{ fontSize: 26 }}>가</span>
            <span className="val">{s.fontSize}</span>
          </div>
          <h3>줄 간격</h3>
          <div className="slider-row">
            <span>좁게</span>
            <input type="range" min={1.3} max={2.4} step={0.05} value={s.lineHeight} onChange={e => set('lineHeight', +e.target.value)} />
            <span>넓게</span>
            <span className="val">{s.lineHeight.toFixed(2)}</span>
          </div>
          <div className="preview" style={{ fontSize: s.fontSize, lineHeight: s.lineHeight }}>
            <span className="vnum">16</span>하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 그를 믿는 자마다 멸망하지 않고 영생을 얻게 하려 하심이라
          </div>
        </section>

        <section>
          <h3>화면 밝기 (테마)</h3>
          <div className="theme-row">
            {([['light', '밝게', '☀️'], ['sepia', '종이색', '📜'], ['dark', '어둡게', '🌙']] as const).map(([v, label, ico]) => (
              <button key={v} className={'theme-btn t-' + v + (s.theme === v ? ' on' : '')} onClick={() => set('theme', v)}>
                <span className="ico">{ico}</span>{label}
              </button>
            ))}
          </div>
          <h3>글꼴</h3>
          <div className="seg">
            <button className={s.fontFamily === 'sans' ? 'on' : ''} onClick={() => set('fontFamily', 'sans')}>고딕체</button>
            <button className={s.fontFamily === 'serif' ? 'on serif' : 'serif'} onClick={() => set('fontFamily', 'serif')}>명조체</button>
          </div>
        </section>

        <section>
          <h3>읽기</h3>
          <Toggle label="읽는 동안 화면 꺼짐 방지" value={s.keepAwake} onChange={v => set('keepAwake', v)} />
          <Toggle label="좌우로 밀어서 장 넘기기" value={s.swipe} onChange={v => set('swipe', v)} />
          <div className="row">
            <span>페이지 개수</span>
            <div className="seg small">
              {[1, 2, 3, 4, 5].map(n => <button key={n} className={s.pageCount === n ? 'on' : ''} onClick={() => set('pageCount', n)}>{n}</button>)}
            </div>
          </div>
        </section>

        <section>
          <h3>복사 형식</h3>
          <div className="row">
            <span>책 이름</span>
            <div className="seg small">
              <button className={s.copyBookStyle === 'full' ? 'on' : ''} onClick={() => set('copyBookStyle', 'full')}>요한복음</button>
              <button className={s.copyBookStyle === 'short' ? 'on' : ''} onClick={() => set('copyBookStyle', 'short')}>요</button>
            </div>
          </div>
          <div className="row">
            <span>장절 위치</span>
            <div className="seg small">
              <button className={s.copyRefPosition === 'top' ? 'on' : ''} onClick={() => set('copyRefPosition', 'top')}>위</button>
              <button className={s.copyRefPosition === 'bottom' ? 'on' : ''} onClick={() => set('copyRefPosition', 'bottom')}>아래</button>
            </div>
          </div>
          <div className="row">
            <span>절 번호</span>
            <div className="seg small">
              <button className={s.copyVerseNumbers === 'auto' ? 'on' : ''} onClick={() => set('copyVerseNumbers', 'auto')}>여러 절일 때</button>
              <button className={s.copyVerseNumbers === 'always' ? 'on' : ''} onClick={() => set('copyVerseNumbers', 'always')}>항상</button>
              <button className={s.copyVerseNumbers === 'never' ? 'on' : ''} onClick={() => set('copyVerseNumbers', 'never')}>안 함</button>
            </div>
          </div>
          <pre className="copy-sample">{sample(s)}</pre>
        </section>

        <section>
          <h3>백업 · 폰 바꿀 때</h3>
          <p className="desc">북마크 {bmCount}개, 형광펜, 설정을 파일 하나로 저장합니다. 폰을 바꾸기 전에 저장해 두고(카카오톡 ‘나와의 채팅’, 구글 드라이브 등), 새 폰에서 <b>불러오기</b>하면 그대로 옮겨집니다.</p>
          <div className="btn-row">
            <button className="primary" onClick={doExport}>백업 파일 내보내기</button>
            <button onClick={() => fileRef.current?.click()}>백업 불러오기</button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
          </div>
        </section>

        <section>
          <h3>기타</h3>
          <div className="btn-row">
            <button onClick={() => { if (confirm('보기 설정을 기본값으로 되돌릴까요? (북마크는 그대로입니다)')) setSettings(DEFAULT_SETTINGS); }}>설정 초기화</button>
          </div>
          <p className="desc small">SK-성경 v1.2 · 성경전서 개역개정판 (개인 사용)</p>
        </section>
      </div>
    </div>
  );
}

function sample(s: Settings) {
  const name = s.copyBookStyle === 'full' ? '요한복음' : '요';
  const num = s.copyVerseNumbers === 'always';
  const body = (num ? '16 ' : '') + '하나님이 세상을 이처럼 사랑하사...';
  return s.copyRefPosition === 'top' ? `${name} 3:16\n${body}` : `${body}\n(${name} 3:16)`;
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="row toggle-row" onClick={() => onChange(!value)}>
      <span>{label}</span>
      <span className={'switch' + (value ? ' on' : '')}><span /></span>
    </button>
  );
}


/* ================================================================
   SK-성경 서버 (Cloudflare Worker)
   - 앱 화면/파일: 그대로 전달 (dist 폴더)
   - /api/ask : "문장으로 찾기" AI 설명 (Cloudflare Workers AI, 무료 사용량 안에서)
   ================================================================ */

// 위에서부터 차례로 시도합니다 (첫 번째가 안 되면 두 번째)
const MODELS = [
  '@cf/openai/gpt-oss-120b',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
];

const FIND_PROMPT = `당신은 한국어 성경(개역개정) 구절 찾기 도우미입니다.
사용자의 질문은 휴대폰 음성 입력으로 쓴 것이라 소리가 비슷한 엉뚱한 단어가 섞여 있을 수 있습니다.
(예: 노화→노아, 달리→다니엘, 권원→구원, 성역구절→성경구절, 이따→있다, 요부→욥)
할 일:
1) 질문을 바르게 고쳐 씁니다.
2) 성경 지식을 사용해, 질문이 가리키는 성경 구절을 찾습니다.
   아래 "앱 검색 후보"는 글자 모양이 비슷한 구절일 뿐이라 정답이 아닐 수 있습니다.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"corrected":"바르게 고친 질문","refs":["겔 14:14","겔 14:20"]}
- refs: 가장 알맞은 순서로 1~6개, "책이름 장:절" 형식 (예: "요한복음 3:16", "시 23:1", "겔 14:14-20")`;

const EXPLAIN_PROMPT = `당신은 한국어 성경(개역개정) 해설 도우미입니다.
사용자는 휴대폰 음성 입력으로 질문해서 오타가 있을 수 있습니다.
아래 "확인된 구절"은 개역개정 실제 본문입니다. 이 중에서 질문에 해당하는 구절을 골라 설명하세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"matches":["에스겔 14:14","에스겔 14:20"],
 "intro":"질문하신 내용은 구약 성경 에스겔 14장 14절과 20절 말씀입니다.",
 "interpretation":"질문에서 '노화와 모세'라고 표현하신 부분은 성경의 대표적인 의인인 노아, 다니엘, 욥을 뜻하며, ... (질문의 표현이 무엇을 뜻하는지와 구절의 뜻을 2~3문장으로)",
 "points":[{"title":"구원의 개인성","body":"..."},{"title":"심판의 엄중함","body":"..."}]}
규칙:
- matches 에는 "확인된 구절" 목록에 있는 구절만, 관련이 큰 순서로 1~4개 넣습니다.
- 맞는 구절이 없으면 matches 는 [] 로 하고, intro 에 "정확히 일치하는 구절을 찾지 못했습니다"라고 쓴 뒤 다시 물어볼 방법을 짧게 안내합니다.
- points 는 "구절의 핵심 의미" 2~3개, 각 body 는 1~3문장.
- 존댓말(~입니다)로 쓰고, 성경 본문과 일반적인 해석에 없는 내용은 지어내지 마세요.`;

const HEADINGS_PROMPT = `당신은 한국어 성경(개역개정) 편집자입니다.
주어진 장을 내용에 따라 단락으로 나누고, 각 단락이 시작하는 절 번호와 짧은 한국어 소제목을 붙이세요.
또 그 장 전체의 주제를 한 문장으로 쓰세요.
- 단락 수: 10절 이하 1~2개, 11~30절 2~5개, 그보다 길면 3~8개 (시편 119편처럼 아주 긴 장은 히브리어 알파벳 연에 맞춰 22개)
- 첫 단락은 반드시 1절에서 시작합니다.
- 소제목: 4~18자, 개역개정 낱말을 살린 자연스러운 한국어. 예) "팔복", "소금과 빛", "믿음은 들음에서 나며", "아브라함이 믿음으로 의롭게 되다"
- 참고용 영어 소제목(BSB)이 주어지면 단락 나누기에 참고하되 그대로 번역하지 말고 더 자연스럽게 쓰세요.
- 장 주제: 40자 이내 한 문장.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"topic":"장 주제","heads":[[1,"소제목"],[14,"소제목"]]}`;

const ORIGINAL_PROMPT = `당신은 성경 원어(히브리어·아람어·헬라어) 전문가이자 친절한 목회자입니다.
주어진 구절의 원문 단어 분석 자료(STEPBible: 원어, 음역, 영어 직역, 스트롱 번호, 문법, 사전형)를 바탕으로
성경을 사랑하는 일반 성도가 이해할 수 있게 한국어로 원어 설명과 분석을 쓰세요.
반드시 아래 형식의 JSON 하나만 출력하세요. 다른 글은 절대 쓰지 마세요.
{"summary":"이 구절을 원문으로 볼 때의 핵심을 2~4문장",
 "words":[{"i":0,"ko":"한국어 뜻(짧게)","pron":"한글 발음","note":"중요한 단어만: 어원·쓰임·다른 구절 용례·신학적 의미 1~3문장"}],
 "points":[{"title":"짧은 제목","body":"2~4문장"}]}
규칙:
- words: 모든 단어(i = 0부터 차례대로)에 대해 ko 와 pron 을 씁니다. note 는 뜻이 깊은 핵심 단어 2~5개에만 씁니다.
- pron: 원어를 한글로 읽는 소리 (예: 마카리오이, 베레쉬트, 엘로힘).
- points: 2~4개. 핵심 단어의 깊은 뜻, 문법(시제·태·어순 등)이 주는 의미, 개역개정 번역에서 잘 드러나지 않는 뉘앙스 등.
- 존댓말(~입니다)로 쓰고, 확실하지 않은 내용은 지어내지 마세요.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function clip(s, n) { return String(s ?? '').slice(0, n); }

/** 모델마다 답 모양이 조금씩 달라서 글자만 꺼냅니다 */
function extractText(r) {
  if (!r) return '';
  if (typeof r === 'string') return r;
  if (typeof r.response === 'string') return r.response;
  if (r.response && typeof r.response === 'object') return JSON.stringify(r.response);
  const c = r.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (typeof r.output_text === 'string') return r.output_text;
  if (Array.isArray(r.output)) {
    for (const o of r.output) {
      if (o?.type === 'message' && Array.isArray(o.content)) {
        for (const p of o.content) if (typeof p?.text === 'string') return p.text;
      }
    }
  }
  return '';
}

/** 글 속에서 JSON 부분만 찾아 읽기 */
function parseJson(text) {
  if (!text) return null;
  const t = text.replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

async function runLLM(env, system, user) {
  let lastErr = new Error('AI를 사용할 수 없습니다');
  for (const model of MODELS) {
    try {
      const r = await env.AI.run(model, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 6000,
        temperature: 0.2,
      });
      const out = parseJson(extractText(r));
      if (out) return out;
      lastErr = new Error('AI 답을 읽지 못했습니다');
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr;
}

async function handleAsk(request, env) {
  if (request.headers.get('x-sk-app') !== '1') return json({ error: 'forbidden' }, 403);
  if (!env.AI) return json({ error: 'AI 연결(binding)이 없습니다. wrangler.jsonc 를 확인하세요.' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  const q = clip(body.q, 400).trim();
  if (!q) return json({ error: '질문이 비어 있습니다' }, 400);

  try {
    if (body.step === 'headings') {
      const verses = (Array.isArray(body.verses) ? body.verses : []).slice(0, 200);
      const per = verses.length > 60 ? 70 : 160;
      const text = verses.map((t, i) => `${i + 1} ${clip(t, per)}`).join('\n').slice(0, 14000);
      const hints = (Array.isArray(body.hints) ? body.hints : []).slice(0, 30)
        .map(h => `${Number(h?.[0]) || 1}절: ${clip(h?.[1], 80)}`).join(', ');
      const out = await runLLM(env, HEADINGS_PROMPT,
        `${clip(body.book, 20)} ${Number(body.chapter) || 1}장 (모두 ${verses.length}절)\n참고 영어 소제목(BSB): ${hints || '(없음)'}\n\n본문:\n${text}`);
      return json({
        topic: clip(out.topic, 120),
        heads: (Array.isArray(out.heads) ? out.heads : []).slice(0, 30)
          .map(h => [Number(Array.isArray(h) ? h[0] : h?.v) || 0, clip(Array.isArray(h) ? h[1] : h?.title, 60)]),
      });
    }
    if (body.step === 'original') {
      const words = (Array.isArray(body.words) ? body.words : []).slice(0, 120);
      const list = words.map(w =>
        `${Number(w.i)}. ${clip(w.w, 40)} [${clip(w.tr, 40)}] "${clip(w.en, 60)}" ${clip(w.s, 12)} / ${clip(w.g, 80)}${w.lemma ? ` / 사전형 ${clip(w.lemma, 40)}=${clip(w.lg, 60)}` : ''}`,
      ).join('\n');
      const out = await runLLM(env, ORIGINAL_PROMPT,
        `구절: ${q} (${clip(body.lang, 10)})\n개역개정: ${clip(body.korean, 600)}\n\n원문 단어:\n${list}`);
      return json({
        summary: clip(out.summary, 1500),
        words: (Array.isArray(out.words) ? out.words : []).slice(0, 120).map(w => ({
          i: Number(w?.i), ko: clip(w?.ko, 80), pron: clip(w?.pron, 40), note: clip(w?.note, 500),
        })),
        points: (Array.isArray(out.points) ? out.points : []).slice(0, 5)
          .map(p => ({ title: clip(p?.title, 80), body: clip(p?.body, 900) })),
      });
    }
    if (body.step === 'find') {
      const cands = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 10)
        .map(c => `- ${clip(c.ref, 30)} ${clip(c.text, 300)}`).join('\n');
      const out = await runLLM(env, FIND_PROMPT, `질문: ${q}\n\n앱 검색 후보:\n${cands || '(없음)'}`);
      return json({
        corrected: clip(out.corrected, 400),
        refs: (Array.isArray(out.refs) ? out.refs : []).slice(0, 6).map(r => clip(r, 40)),
      });
    }
    if (body.step === 'explain') {
      const verses = (Array.isArray(body.verses) ? body.verses : []).slice(0, 16)
        .map(v => `- ${clip(v.ref, 30)}: ${clip(v.text, 400)}`).join('\n');
      const corrected = clip(body.corrected, 400);
      const out = await runLLM(env, EXPLAIN_PROMPT,
        `원래 질문(음성 입력): ${q}\n고친 질문: ${corrected || q}\n\n확인된 구절:\n${verses || '(없음)'}`);
      return json({
        matches: (Array.isArray(out.matches) ? out.matches : []).slice(0, 5).map(r => clip(r, 40)),
        intro: clip(out.intro, 600),
        interpretation: clip(out.interpretation, 1500),
        points: (Array.isArray(out.points) ? out.points : []).slice(0, 4)
          .map(p => ({ title: clip(p?.title, 80), body: clip(p?.body, 800) })),
      });
    }
    return json({ error: '알 수 없는 요청' }, 400);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/neuron|quota|limit|4006|exceeded/i.test(msg)) {
      return json({ error: '오늘 무료 AI 사용량을 다 썼습니다. 내일 다시 쓰거나, 아래의 폰 안 검색 결과를 보세요.' }, 429);
    }
    return json({ error: 'AI 답변 실패: ' + msg.slice(0, 200) }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ask') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      return handleAsk(request, env);
    }
    if (url.pathname === '/api/health') return json({ ok: true, ai: !!env.AI });
    return env.ASSETS.fetch(request);
  },
};

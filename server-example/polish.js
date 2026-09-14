/**
 * /api/polish 백엔드 예제 (Express 기준, Gemini API 사용)
 *
 * 왜 필요한가요?
 * - 클라이언트(index.html)는 API 키를 가질 수 없어요. 브라우저 JS에 키를 넣으면
 *   누구나 개발자 도구로 복사해갈 수 있어요.
 * - 그래서 이 서버가 대신 Gemini API를 호출하고, 정리된 JSON만 클라이언트에 돌려줘요.
 *
 * 사용 방법
 *   npm install express
 *   GEMINI_API_KEY=여기에_키_입력 node server-example/polish.js
 *
 * 주의
 * - GEMINI_API_KEY는 반드시 환경변수(.env, 배포 플랫폼의 Secret 설정 등)로만 넣어주세요.
 *   이 파일이나 다른 소스 코드에 키 값을 직접 적지 마세요.
 * - 실제 배포 시에는 이 서버를 파트너사 자체 인프라에 올리고,
 *   apps-in-toss 콘솔/문서의 "서버 API 이용하기" 가이드에 따라 도메인을 등록해 주세요.
 */

import express from 'express';

const app = express();
app.use(express.json());

// 토스 앱 웹뷰에서 오는 크로스 오리진 요청을 허용해요.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (req, res) => {
  res.send('message-polisher server is running');
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.6-flash'; // 최신 모델은 ai.google.dev/gemini-api/docs/models 참고

if (!GEMINI_API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY 환경변수가 설정되지 않았어요. 서버를 시작하기 전에 설정해주세요.');
}

const SYSTEM_INSTRUCTION = `당신은 한국 직장 커뮤니케이션 코치입니다. 사용자가 그대로 쓴 직설적인 말을, 받는 사람과의 관계에 맞게 예의 있는 버전으로 다듬어주세요.

원칙:
- 실제 한국 직장인이 카톡이나 메일에 쓸 법한 자연스러운 문장으로 작성하세요. 번역투나 과도하게 격식적인 문어체는 피하세요.
- 정중하게(격식형, 관계상 윗사람·거래처에 적합), 부드럽게(쿠션어 활용, 관계 유지 중심), 단호하게(예의는 지키되 할 말은 명확히 하는 버전) 3가지를 만드세요.
- 각 버전은 원문의 핵심 의도(거절/요청/불만 등)를 흐리지 않으면서 표현만 다듬어야 해요.
- 이모지는 자연스러운 경우에만 최대 1개까지 허용하고, 남발하지 마세요.
- 각 버전마다 어떤 화법 기법을 썼는지 12자 내외의 짧은 코멘트를 붙이세요.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    polite: {
      type: 'OBJECT',
      properties: { text: { type: 'STRING' }, note: { type: 'STRING' } },
      required: ['text', 'note'],
    },
    soft: {
      type: 'OBJECT',
      properties: { text: { type: 'STRING' }, note: { type: 'STRING' } },
      required: ['text', 'note'],
    },
    firm: {
      type: 'OBJECT',
      properties: { text: { type: 'STRING' }, note: { type: 'STRING' } },
      required: ['text', 'note'],
    },
  },
  required: ['polite', 'soft', 'firm'],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 503(일시적 과부하)만 재시도해요. 429(할당량 초과)는 재시도해도 다시 막힐 뿐이라 바로 실패 처리해요.
 */
async function callGeminiWithRetry(userPrompt, maxRetries = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: 'low' },
    },
  });

  let lastResponse;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body,
    });

    if (response.ok) return response;

    lastResponse = response;
    const retriable = response.status === 503;
    if (!retriable || attempt === maxRetries) return response;

    const waitMs = 800 * (attempt + 1);
    console.warn(`Gemini ${response.status}, ${waitMs}ms 후 재시도 (${attempt + 1}/${maxRetries})`);
    await sleep(waitMs);
  }
  return lastResponse;
}

app.post('/api/polish', async (req, res) => {
  try {
    const { audience, rawMessage, context } = req.body;

    if (!rawMessage || !rawMessage.trim()) {
      return res.status(400).json({ error: '하고 싶은 말을 입력해주세요.' });
    }

    const userPrompt = `받는 사람: ${audience || '동료'}
원문: ${rawMessage}
${context ? '상황: ' + context : ''}`;

    const response = await callGeminiWithRetry(userPrompt);

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', response.status, errText);
      if (response.status === 429) {
        return res.status(429).json({ error: '지금 이용량이 많아요. 잠시 후 다시 시도해주세요.' });
      }
      return res.status(502).json({ error: 'AI 순화 서버 호출에 실패했어요.' });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error('Gemini 응답에 text가 없어요. finishReason:', data.candidates?.[0]?.finishReason, 'usage:', data.usageMetadata);
      return res.status(502).json({ error: 'AI 응답이 비어있어요.' });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      console.error('JSON 파싱 실패. finishReason:', data.candidates?.[0]?.finishReason);
      console.error('원문(마지막 300자):', text.slice(-300));
      return res.status(502).json({ error: '결과가 잘려서 도착했어요. 다시 시도해주세요.' });
    }

    res.json(parsed);
  } catch (err) {
    console.error('polish error:', err);
    res.status(500).json({ error: '순화하는 중 문제가 생겼어요.' });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`polish server (Gemini) listening on :${PORT}`);
});


import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import {
  UserProfile, Concert, ChatMessage, ChatIntent, HistoryStats, FeedbackEntry,
  AgentStep, ProgramEnrichment,
} from "../types";
import {
  OCR_MODEL, OCR_PROMPT, OCR_RESPONSE_SCHEMA, OCR_GENERATION_CONFIG,
  postProcessOCR, extractComposers, mergeOCRRuns, needsSecondPass,
  type OCRResult,
} from "./ocrSchema";
import { MODELS } from "./models";

/* ------------------------------------------------------------------ *
 * API 키 확인
 *
 * ⚠️ 이 키는 vite.config.ts의 `define`으로 번들에 평문으로 박힌다.
 *    로컬 개발 전용이다. 배포 금지 — vite.config.ts 주석 참고.
 * ------------------------------------------------------------------ */

/**
 * 플레이스홀더 판별. **접두사로 형식 검사를 하지 않는다** —
 * 유효한 신형 키가 `AQ.` 로 시작해서 `AIza` 검사를 하면 정상 키를 막는다.
 * "비어 있는가 / 자리표시자인가"만 본다.
 */
const PLACEHOLDER_KEYS = new Set([
  '', 'undefined', 'null', 'none',
  'your_api_key_here', 'your-api-key-here', 'your_gemini_api_key',
  'gemini_api_key', 'api_key', 'changeme', 'todo', 'xxx',
]);

function looksLikePlaceholder(key: string): boolean {
  const k = key.toLowerCase();
  if (PLACEHOLDER_KEYS.has(k)) return true;
  // <여기에_붙여넣기>, {{KEY}}, ... 같은 자리표시자
  if (/^[<{\[].*[>}\]]$/.test(key)) return true;
  if (/^\.+$/.test(key)) return true;
  return key.length < 10;
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      'Gemini API 키가 설정되지 않았습니다.\n' +
      'app/.env 파일에 GEMINI_API_KEY=발급받은키 를 넣고 개발 서버를 다시 시작하세요.\n' +
      '(vite의 define은 빌드 시점에 값을 넣기 때문에 서버 재시작이 필요합니다.)'
    );
    this.name = 'MissingApiKeyError';
  }
}

export function getApiKey(): string | null {
  const key = (typeof process !== 'undefined' ? process.env?.API_KEY : undefined) ?? '';
  const trimmed = String(key).trim();
  return looksLikePlaceholder(trimmed) ? null : trimmed;
}

export function hasApiKey(): boolean {
  return getApiKey() !== null;
}

/** 조용히 실패하지 않는다. 키가 없으면 명확한 에러를 던진다. */
function client(): GoogleGenAI {
  const apiKey = getApiKey();
  if (!apiKey) throw new MissingApiKeyError();
  return new GoogleGenAI({ apiKey });
}

/** 어떤 오류든 사용자에게 보여줄 한국어 문장으로 */
export function describeError(err: unknown): string {
  if (err instanceof MissingApiKeyError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  if (/API key not valid|API_KEY_INVALID|401|403/i.test(msg)) {
    return 'Gemini API 키가 유효하지 않습니다. app/.env의 GEMINI_API_KEY를 확인한 뒤 개발 서버를 재시작하세요.';
  }
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return 'Gemini API 사용량 한도에 걸렸습니다. 잠시 후 다시 시도하세요.';
  }
  if (/fetch|network|Failed to fetch/i.test(msg)) {
    return '네트워크 오류로 Gemini API에 연결하지 못했습니다.';
  }
  return `요청에 실패했습니다: ${msg}`;
}

/**
 * 답이 짧고 정형인 태스크(판독/분류/추출)의 thinking 예산.
 *
 * 실측: OCR 1건당 thinking 1,475토큰 vs 출력 168토큰 (9배), 평균 지연 20.3초.
 * 티켓에서 글자를 읽는 데 그만큼의 추론은 필요 없다. 지연·비용이 함께 준다.
 * (ARCHITECTURE 4-2 B5)
 */
const MINIMAL_THINKING = { thinkingLevel: ThinkingLevel.MINIMAL } as const;

/* ------------------------------------------------------------------ *
 * 통계 빠른 경로 (D3 / F3)
 * ------------------------------------------------------------------ */

/** 규칙 기반 프리라우팅 — 정형 통계 질의는 분류 호출조차 하지 않는다 */
const STATS_PATTERNS = [
  /통계/, /몇\s*번/, /몇\s*회/, /관람\s*(분석|이력|기록)/,
  /얼마나\s*(봤|갔|관람)/, /누적/, /총\s*(비용|금액|얼마)/, /얼마\s*(썼|나왔)/,
];

export function ruleRoute(message: string): ChatIntent | null {
  return STATS_PATTERNS.some(re => re.test(message)) ? 'statistics' : null;
}

/** 관람 이력 집계. LLM을 쓰지 않는다 (~5s → ~1ms) */
export function calculateStats(history: Concert[]): HistoryStats {
  const tally = (pairs: (string | undefined)[]) => {
    const counts: Record<string, number> = {};
    pairs.forEach(v => {
      const k = (v || '').trim();
      if (!k) return;
      counts[k] = (counts[k] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  };

  // 작곡가는 concert.composer 하나만 보지 않고 program에서 뽑은 전체를 센다.
  const composerMentions: string[] = [];
  history.forEach(c => {
    const list = c.composers?.length ? c.composers : extractComposers(c.program || []);
    if (list.length) composerMentions.push(...list);
    else if (c.composer) composerMentions.push(c.composer);
  });

  const monthlyCount: Record<string, number> = {};
  const isoDates: string[] = [];
  history.forEach(c => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date || '')) return;
    isoDates.push(c.date);
    const month = c.date.slice(0, 7);
    monthlyCount[month] = (monthlyCount[month] || 0) + 1;
  });
  isoDates.sort();

  return {
    totalCount: history.length,
    topComposers: tally(composerMentions),
    topVenues: tally(history.map(c => c.venue)),
    topArtists: tally(history.map(c => c.artist)),
    monthlyAttendance: Object.entries(monthlyCount)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({ month, count })),
    totalSpent: history.reduce((sum, c) => sum + (c.price || 0), 0),
    firstDate: isoDates[0] ?? null,
    lastDate: isoDates[isoDates.length - 1] ?? null,
  };
}

/** 집계 결과를 사람이 읽을 문장으로. LLM 호출 없음 */
export function renderStats(stats: HistoryStats): string {
  if (stats.totalCount === 0) {
    return '아직 아카이브에 등록된 관람 기록이 없습니다. [티켓 등록]에서 티켓 사진을 올려 주세요.';
  }
  const lines: string[] = [];
  lines.push(`총 ${stats.totalCount}회 관람하셨습니다.`);
  if (stats.firstDate && stats.lastDate) {
    lines.push(`기간: ${stats.firstDate} ~ ${stats.lastDate}`);
  }
  lines.push(`누적 관람 비용: ₩${stats.totalSpent.toLocaleString('ko-KR')}`);

  if (stats.topComposers.length) {
    lines.push('', '가장 많이 만난 작곡가');
    stats.topComposers.forEach((c, i) => lines.push(`  ${i + 1}. ${c.name} — ${c.count}회`));
  }
  if (stats.topArtists.length) {
    lines.push('', '가장 많이 본 연주자');
    stats.topArtists.forEach((a, i) => lines.push(`  ${i + 1}. ${a.name} — ${a.count}회`));
  }
  if (stats.topVenues.length) {
    lines.push('', '자주 간 공연장');
    stats.topVenues.forEach((v, i) => lines.push(`  ${i + 1}. ${v.name} — ${v.count}회`));
  }
  if (stats.monthlyAttendance.length) {
    lines.push('', '월별 관람');
    stats.monthlyAttendance.forEach(m => lines.push(`  ${m.month}  ${'●'.repeat(Math.min(m.count, 20))} ${m.count}회`));
  }
  lines.push('', '※ 이 답변은 로컬 아카이브를 직접 집계한 결과입니다 (LLM 미사용).');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * 에이전트
 * ------------------------------------------------------------------ */

const VALID_INTENTS: ChatIntent[] = ['recommendation', 'statistics', 'information', 'general'];

export class ClassicAgent {
  private profile: UserProfile;
  private history: Concert[];
  private feedbackHistory: FeedbackEntry[];

  constructor(profile: UserProfile, history: Concert[], feedbackHistory: FeedbackEntry[] = []) {
    this.profile = profile;
    this.history = history;
    this.feedbackHistory = feedbackHistory;
  }

  /** F2: 정규식 파싱 제거. responseSchema로 강제한다 */
  private async expandQuery(query: string): Promise<string[]> {
    const response = await client().models.generateContent({
      model: MODELS.expand,
      contents:
        `사용자 검색어 "${query}"를 클래식 공연 검색에 쓸 연관 키워드 3개로 확장하세요.\n` +
        `연주자명·작곡가명·곡명·공연 형식 중심으로, 서로 다른 각도의 키워드를 주세요.\n` +
        `예: "조성진 리사이틀" → ["조성진 피아노 독주회", "조성진 쇼팽 리사이틀", "피아노 리사이틀 예술의전당"]`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            expandedQueries: {
              type: Type.ARRAY,
              description: '연관 검색 키워드 3개',
              items: { type: Type.STRING },
            },
          },
          required: ['expandedQueries'],
        },
        thinkingConfig: MINIMAL_THINKING,
      },
    });
    try {
      const parsed = JSON.parse(response.text || '{}');
      const list = Array.isArray(parsed.expandedQueries)
        ? parsed.expandedQueries.filter((s: unknown): s is string => typeof s === 'string' && !!s.trim())
        : [];
      return list.length ? list : [query];
    } catch {
      return [query];
    }
  }

  async chat(
    message: string,
    chatHistory: ChatMessage[],
  ): Promise<{ response: string; updatedHistory: ChatMessage[]; intent: ChatIntent }> {
    const agentSteps: AgentStep[] = [];

    // 0. 규칙 기반 빠른 경로 — LLM 호출 0회
    const fast = ruleRoute(message);
    let intent: ChatIntent;
    let entities: string[] = [];

    if (fast) {
      intent = fast;
      agentSteps.push({
        step: 'rule_route',
        label: '⚡ 규칙 라우팅',
        input: message,
        output: `${intent} (정규식 매칭, LLM 호출 없음)`,
        durationMs: 0,
      });
    } else {
      // 1. 의도 분류
      const intentStart = performance.now();
      const intentResponse = await client().models.generateContent({
        model: MODELS.intent,
        contents: `사용자 메시지를 분류하세요: "${message}"
        카테고리: recommendation(공연 추천), statistics(관람 통계/분석), information(곡/작곡가 정보), general(일반 대화)`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              intent: {
                type: Type.STRING,
                enum: VALID_INTENTS as unknown as string[],
              },
              entities: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['intent', 'entities'],
          },
          thinkingConfig: MINIMAL_THINKING,
        },
      });

      let intentData: any = {};
      try {
        intentData = JSON.parse(intentResponse.text || '{}');
      } catch { /* 기본값으로 */ }

      intent = VALID_INTENTS.includes(intentData.intent) ? intentData.intent : 'general';
      entities = Array.isArray(intentData.entities) ? intentData.entities : [];

      agentSteps.push({
        step: 'intent_classification',
        label: '🧠 의도 분석',
        input: message,
        output: `${intent} (키워드: ${entities.join(', ') || '없음'})`,
        durationMs: Math.round(performance.now() - intentStart),
      });
    }

    // 2. statistics는 LLM을 아예 타지 않는다 (D3)
    if (intent === 'statistics') {
      const statStart = performance.now();
      const stats = calculateStats(this.history);
      const text = renderStats(stats);
      agentSteps.push({
        step: 'local_aggregation',
        label: '📊 로컬 집계',
        input: `아카이브 ${this.history.length}건`,
        output: `LLM 미사용 · 관람 ${stats.totalCount}회 · 누적 ₩${stats.totalSpent.toLocaleString('ko-KR')}`,
        durationMs: Math.round(performance.now() - statStart),
      });
      return {
        response: text,
        intent,
        updatedHistory: [
          ...chatHistory,
          { role: 'user', parts: [{ text: message }] },
          { role: 'model', parts: [{ text }], agentSteps, intent, recommendations: [] },
        ],
      };
    }

    // 3. 컨텍스트 구성
    const concertContext = this.history
      .slice(-20) // 이력 전량 주입은 토큰이 선형 증가한다. 로컬 프로토타입에서는 최근 20건으로 잘라 둔다.
      .map(c => `[${c.date}] ${c.title} - ${c.artist} | 프로그램: ${(c.program || []).join(', ')}`)
      .join('\n');

    const likedPatterns = this.feedbackHistory.filter(f => f.liked).map(f => f.reason).filter(Boolean).slice(-10).join(', ');
    const dislikedPatterns = this.feedbackHistory.filter(f => !f.liked).map(f => f.reason).filter(Boolean).slice(-10).join(', ');

    let systemPrompt = `당신은 '클래식 리언즈'의 전문 큐레이터 에이전트입니다.
    오늘 날짜: ${new Date().toISOString().slice(0, 10)}
    사용자 취향: ${JSON.stringify(this.profile)}
    최근 관람 기록:
    ${concertContext || '기록 없음'}
    피드백 패턴: (좋아함) ${likedPatterns || '없음'}, (싫어함) ${dislikedPatterns || '없음'}`;

    if (intent === 'recommendation') {
      const expandStart = performance.now();
      const expanded = await this.expandQuery(entities.join(' ') || message);
      agentSteps.push({
        step: 'query_expansion',
        label: '🔍 쿼리 확장',
        input: entities.join(' ') || message,
        output: expanded.join(' | '),
        durationMs: Math.round(performance.now() - expandStart),
      });
      systemPrompt +=
        `\n추천 모드: [${expanded.join(', ')}] 관련 **실제로 예매 가능한** 공연을 검색해서 찾으세요.` +
        `\n오늘 이후 날짜의 공연만 추천하세요. 검색으로 확인되지 않은 공연은 만들어내지 마세요.` +
        `\n각 추천마다 공연명 / 연주자 / 공연장 / 날짜(YYYY-MM-DD)를 명시하고, 사용자의 과거 이력과 연결해 이유를 쓰세요.`;
    }

    // 4. 최종 응답 생성
    const genStart = performance.now();
    const response = await client().models.generateContent({
      model: intent === 'general' ? MODELS.general : MODELS.chat,
      contents: [
        ...chatHistory.map(m => ({ role: m.role, parts: m.parts })),
        { role: 'user', parts: [{ text: message }] },
      ],
      config: {
        systemInstruction: systemPrompt,
        // general(잡담)에는 검색을 붙이지 않는다. 요청당 과금이고 도움도 안 된다.
        tools: intent === 'general' ? [] : [{ googleSearch: {} }],
      },
    });

    const finalResponseText = response.text || '';
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => ({ title: chunk.web?.title, uri: chunk.web?.uri }))
      .filter((s: any) => s.uri) || [];

    agentSteps.push({
      step: 'response_generation',
      label: intent === 'recommendation' ? '🎭 큐레이션 생성' : '💬 응답 생성',
      input: 'System Instruction & History',
      output: finalResponseText.slice(0, 50) + '...',
      durationMs: Math.round(performance.now() - genStart),
    });

    const displayHistory: ChatMessage[] = [
      ...chatHistory,
      { role: 'user', parts: [{ text: message }] },
      {
        role: 'model',
        parts: [{ text: finalResponseText }],
        sources,
        agentSteps,
        intent,
        // recommendation이면 Dashboard가 백그라운드로 카드를 추출해 채운다.
        recommendations: intent === 'recommendation' ? undefined : [],
      },
    ];

    return { response: finalResponseText, updatedHistory: displayHistory, intent };
  }
}

/* ------------------------------------------------------------------ *
 * 추천 카드 추출 (F1 — 피드백이 더미를 학습하던 문제의 해결)
 *
 * 채팅 응답은 자유 텍스트라 "무엇을 추천했는지"가 구조화돼 있지 않았다.
 * 생성이 끝난 뒤 값싼 Flash 1콜로 추천 대상을 뽑아 카드로 만든다.
 * 이 호출은 화면 표시를 막지 않는다(백그라운드) — TTFT에 영향 없음.
 * ------------------------------------------------------------------ */

export const extractRecommendations = async (responseText: string): Promise<Concert[]> => {
  if (!responseText.trim()) return [];
  const response = await client().models.generateContent({
    model: MODELS.utility,
    contents:
      `다음은 클래식 공연 추천 답변입니다. 여기서 **실제로 추천된 공연**만 뽑아 구조화하세요.\n` +
      `답변에 명시되지 않은 정보는 빈 문자열로 두세요. 지어내지 마세요.\n` +
      `추천된 공연이 없으면 빈 배열을 반환하세요.\n\n---\n${responseText}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          concerts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                artist: { type: Type.STRING },
                venue: { type: Type.STRING },
                date: { type: Type.STRING, description: 'YYYY-MM-DD 또는 빈 문자열' },
                composer: { type: Type.STRING },
                reason: { type: Type.STRING, description: '답변에 쓰인 추천 이유 한 문장' },
              },
              required: ['title', 'artist', 'venue', 'date', 'composer', 'reason'],
            },
          },
        },
        required: ['concerts'],
      },
      thinkingConfig: MINIMAL_THINKING,
    },
  });

  try {
    const parsed = JSON.parse(response.text || '{}');
    const list = Array.isArray(parsed.concerts) ? parsed.concerts : [];
    return list
      .filter((c: any) => c && typeof c.title === 'string' && c.title.trim())
      .map((c: any, i: number): Concert => ({
        id: `rec-${Date.now()}-${i}`,
        title: String(c.title).trim(),
        artist: String(c.artist || '').trim(),
        venue: String(c.venue || '').trim(),
        date: String(c.date || '').trim(),
        program: [],
        type: 'upcoming',
        composer: String(c.composer || '').trim() || undefined,
        reason: String(c.reason || '').trim() || undefined,
      }));
  } catch {
    return [];
  }
};

export const summarizeFeedback = async (concert: Concert, liked: boolean): Promise<string> => {
  const descriptor = [
    concert.title,
    concert.artist && `연주: ${concert.artist}`,
    concert.composer && `작곡가: ${concert.composer}`,
    concert.venue && `장소: ${concert.venue}`,
  ].filter(Boolean).join(' / ');

  const response = await client().models.generateContent({
    model: MODELS.utility,
    contents:
      `사용자가 이 공연 추천을 ${liked ? '좋아했' : '싫어했'}습니다.\n${descriptor}\n` +
      `이 피드백에서 읽을 수 있는 취향 패턴을 한 문장으로 요약하세요. ` +
      `공연명 자체가 아니라 작곡가/시대/편성/연주자 같은 일반화 가능한 속성으로 쓰세요. ` +
      `예: "임윤찬의 라흐마니노프 같은 낭만주의 피아노 협주곡을 선호함"`,
    config: { thinkingConfig: MINIMAL_THINKING },
  });
  return response.text?.trim() || '';
};

export const enrichProgramNotes = async (ocrResult: OCRResult): Promise<ProgramEnrichment> => {
  if (!ocrResult.program.length) return { notes: [], sources: [] };

  const response = await client().models.generateContent({
    model: MODELS.enrich,
    contents: `다음 클래식 공연 프로그램의 각 곡에 대해 해설을 작성하세요:
    공연: ${ocrResult.title}, 연주자: ${ocrResult.artist}, 프로그램: ${ocrResult.program.join(', ')}`,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            composer: { type: Type.STRING },
            opus: { type: Type.STRING },
            background: { type: Type.STRING },
            listeningTip: { type: Type.STRING },
            recommendedRecording: { type: Type.STRING },
          },
          required: ['title', 'composer', 'background', 'listeningTip'],
        },
      },
    },
  });
  const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.map((chunk: any) => ({ title: chunk.web?.title, uri: chunk.web?.uri }))
    .filter((s: any) => s.uri) || [];

  let notes = [];
  try {
    notes = JSON.parse(response.text || '[]');
  } catch {
    notes = [];
  }
  return { notes: Array.isArray(notes) ? notes : [], sources };
};

/* ------------------------------------------------------------------ *
 * OCR — 프롬프트/스키마는 ocrSchema.ts가 단일 출처
 * ------------------------------------------------------------------ */


/** 1회 판독. 프롬프트/스키마는 ocrSchema.ts가 단일 출처 */
async function ocrOnce(base64Image: string, mimeType: string): Promise<OCRResult> {
  const response = await client().models.generateContent({
    model: OCR_MODEL,
    contents: {
      parts: [
        { inlineData: { mimeType, data: base64Image } },
        { text: OCR_PROMPT },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: OCR_RESPONSE_SCHEMA as any,
      // 평가 하네스와 **같은 설정**을 쓰려고 ocrSchema에서 가져온다. 여기 값을 따로 적지 말 것.
      ...(OCR_GENERATION_CONFIG as any),
    },
  });

  const text = response.text;
  if (!text) throw new Error('OCR 응답이 비어 있습니다. 이미지가 너무 어둡거나 잘렸을 수 있습니다.');
  return postProcessOCR(text);
}

export interface PerformOCROptions {
  /**
   * self-consistency 2차 패스 허용 여부 (기본 true).
   * 1차 결과가 미덥지 않을 때만(needsSecondPass) 한 번 더 호출해 값이 갈리는지 본다.
   * 모델 자기신고 confidence는 실측상 변별력이 없어서(상관 -0.042),
   * "두 번 돌려서 갈리는가"를 실제 불확실성 신호로 쓴다.
   */
  selfConsistency?: boolean;
}

/**
 * 티켓 이미지에서 필드를 뽑아 후처리까지 마친 결과를 돌려준다.
 * 조용히 null을 반환하지 않는다 — 실패는 던져서 UI가 이유를 보여주게 한다.
 *
 * @param base64Image data URL 프리픽스를 뗀 base64 (imagePrep.prepareTicketImage의 결과)
 */
export const performOCR = async (
  base64Image: string,
  mimeType: string = 'image/jpeg',
  options: PerformOCROptions = {},
): Promise<OCRResult> => {
  const first = await ocrOnce(base64Image, mimeType);
  if (options.selfConsistency === false || !needsSecondPass(first)) return first;

  try {
    const second = await ocrOnce(base64Image, mimeType);
    return mergeOCRRuns([first, second]);
  } catch (err) {
    // 2차 패스는 어디까지나 보너스다. 실패해도 1차 결과를 버리지 않는다.
    console.warn('OCR self-consistency 2차 패스 실패, 1차 결과 사용:', err);
    return first;
  }
};

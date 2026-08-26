
import { GoogleGenAI, Type, FunctionDeclaration, GenerateContentResponse } from "@google/genai";
import { OCRResult, UserProfile, Concert, ChatMessage, HistoryStats, FeedbackEntry, AgentStep, ProgramEnrichment } from "../types";

export class ClassicAgent {
  private profile: UserProfile;
  private history: Concert[];
  private feedbackHistory: FeedbackEntry[];

  constructor(profile: UserProfile, history: Concert[], feedbackHistory: FeedbackEntry[] = []) {
    this.profile = profile;
    this.history = history;
    this.feedbackHistory = feedbackHistory;
  }

  private async expandQuery(query: string): Promise<string[]> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `사용자 검색어 "${query}"를 기반으로 클래식 공연 검색을 위한 연관 키워드 3개를 생성하세요. 예: "조성진 리사이틀" -> ["조성진 피아노 독주회", "조성진 2025 투어", "쇼팽 피아노 협주곡"]`
    });
    const text = response.text || "";
    try {
      // 대략적인 파싱 (배열 형태가 아니더라도 추출 시도)
      return text.match(/"([^"]+)"|'([^']+)'/g)?.map(m => m.replace(/"|'/g, "")) || [query];
    } catch {
      return [query];
    }
  }

  async chat(message: string, chatHistory: ChatMessage[]): Promise<{ response: string; updatedHistory: ChatMessage[] }> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const agentSteps: AgentStep[] = [];

    // 1. Intent Classification
    const intentStart = performance.now();
    const intentResponse = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `사용자 메시지를 분류하세요: "${message}"
      카테고리: recommendation(공연 추천), statistics(관람 통계/분석), information(곡/작곡가 정보), general(일반 대화)
      JSON으로 응답: {"intent": "카테고리", "entities": ["추출된 키워드"]}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: { type: Type.STRING },
            entities: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        }
      }
    });
    
    const intentData = JSON.parse(intentResponse.text || '{}');
    const intent = intentData.intent || 'general';
    const entities = intentData.entities || [];

    agentSteps.push({
      step: "intent_classification",
      label: "🧠 의도 분석",
      input: message,
      output: `${intent} (키워드: ${entities.join(', ')})`,
      durationMs: Math.round(performance.now() - intentStart)
    });

    // 2. Context Construction
    const concertContext = this.history.map(c =>
      `[${c.date}] ${c.title} - ${c.artist} | 프로그램: ${c.program.join(', ')}`
    ).join('\n');

    const likedPatterns = this.feedbackHistory.filter(f => f.liked).map(f => f.reason).join(', ');
    const dislikedPatterns = this.feedbackHistory.filter(f => !f.liked).map(f => f.reason).join(', ');

    let systemPrompt = `당신은 '클래식 리언즈'의 전문 큐레이터 에이전트입니다.
    사용자 취향: ${JSON.stringify(this.profile)}
    과거 관람 기록:
    ${concertContext || '기록 없음'}
    피드백 패턴: (좋아함) ${likedPatterns || '없음'}, (싫어함) ${dislikedPatterns || '없음'}`;

    let expanded: string[] = [];
    if (intent === 'recommendation') {
      const expandStart = performance.now();
      expanded = await this.expandQuery(entities.join(' ') || message);
      agentSteps.push({
        step: "query_expansion",
        label: "🔍 쿼리 확장",
        input: entities.join(' '),
        output: expanded.join(' | '),
        durationMs: Math.round(performance.now() - expandStart)
      });
      systemPrompt += `\n추천 모드: 검색어 확장을 통해 [${expanded.join(', ')}]와 연관된 실제 공연을 찾으세요. 왜 추천하는지 과거 이력과 연결하세요.`;
    } else if (intent === 'statistics') {
      systemPrompt += `\n분석 모드: 관람 이력을 데이터 기반으로 분석하여 답변하세요.`;
    }

    // 3. Final Response Generation
    const genStart = performance.now();
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [
        ...chatHistory.map(m => ({ role: m.role, parts: m.parts })),
        { role: 'user', parts: [{ text: message }] }
      ],
      config: {
        systemInstruction: systemPrompt,
        tools: intent === 'statistics' ? [] : [{ googleSearch: {} }]
      }
    });

    const finalResponseText = response.text || "";
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => ({ title: chunk.web?.title, uri: chunk.web?.uri }))
      .filter((s: any) => s.uri) || [];

    agentSteps.push({
      step: "response_generation",
      label: intent === 'recommendation' ? "🎭 큐레이션 생성" : "💬 응답 생성",
      input: "System Instruction & History",
      output: finalResponseText.slice(0, 50) + "...",
      durationMs: Math.round(performance.now() - genStart)
    });

    const displayHistory: ChatMessage[] = [
      ...chatHistory,
      { role: 'user', parts: [{ text: message }] },
      { 
        role: 'model', 
        parts: [{ text: finalResponseText }],
        sources,
        agentSteps
      }
    ];

    return { response: finalResponseText, updatedHistory: displayHistory };
  }

  private calculateStats(): HistoryStats {
    const composerCount: Record<string, number> = {};
    this.history.forEach(c => {
      const comp = c.composer || "Unknown";
      composerCount[comp] = (composerCount[comp] || 0) + 1;
    });
    const monthlyCount: Record<string, number> = {};
    this.history.forEach(c => {
      const d = new Date(c.date);
      if(!isNaN(d.getTime())) {
        const month = d.getMonth() + 1 + "월";
        monthlyCount[month] = (monthlyCount[month] || 0) + 1;
      }
    });
    return {
      topComposers: Object.entries(composerCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
      monthlyAttendance: Object.entries(monthlyCount).map(([month, count]) => ({ month, count })),
      totalSpent: this.history.reduce((sum, c) => sum + (c.price || 0), 0)
    };
  }
}

export const summarizeFeedback = async (concert: Concert, liked: boolean): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `사용자가 이 공연 추천을 ${liked ? '좋아했' : '싫어했'}습니다: "${concert.title}" by ${concert.artist}. 이 피드백의 취향 패턴을 한 문장으로 요약하세요. 예: "임윤찬의 라흐마니노프 연주를 선호함"`
  });
  return response.text?.trim() || '';
};

export const enrichProgramNotes = async (ocrResult: OCRResult): Promise<ProgramEnrichment> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `다음 클래식 공연 프로그램의 각 곡에 대해 해설을 작성하세요:
    공연: ${ocrResult.title}, 연주자: ${ocrResult.artist}, 프로그램: ${ocrResult.program.join(', ')}`,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
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
            recommendedRecording: { type: Type.STRING }
          },
          required: ["title", "composer", "background", "listeningTip"]
        }
      }
    }
  });
  const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.map((chunk: any) => ({ title: chunk.web?.title, uri: chunk.web?.uri }))
    .filter((s: any) => s.uri) || [];
  return { notes: JSON.parse(response.text || '[]'), sources };
};

export const performOCR = async (base64Image: string): Promise<OCRResult | null> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
          { text: "티켓 텍스트 추출: title, artist, venue, date(YYYY-MM-DD), program(배열) JSON만 출력." }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            artist: { type: Type.STRING },
            venue: { type: Type.STRING },
            date: { type: Type.STRING },
            program: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        }
      }
    });
    return response.text ? JSON.parse(response.text) : null;
  } catch (error) {
    console.error("OCR Error:", error);
    return null;
  }
};

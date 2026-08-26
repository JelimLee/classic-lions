
import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Send, Bot, User, BarChart3, Receipt, Music, Sparkles, Loader2, BrainCircuit,
  ExternalLink, ThumbsUp, ThumbsDown, AlertTriangle, MapPin, CalendarDays,
} from 'lucide-react';
import { UserProfile, Concert, ChatMessage, FeedbackEntry } from '../types';
import {
  ClassicAgent, summarizeFeedback, extractRecommendations, calculateStats,
  describeError, hasApiKey,
} from '../services/geminiService';
import AgentTimeline from './AgentTimeline';

interface DashboardProps {
  profile: UserProfile;
  concerts: Concert[];
  feedbackHistory: FeedbackEntry[];
  onAddFeedback: (feedback: FeedbackEntry) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ profile, concerts, feedbackHistory, onAddFeedback }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<number | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const agent = useMemo(
    () => new ClassicAgent(profile, concerts, feedbackHistory),
    [profile, concerts, feedbackHistory],
  );

  // 하드코딩된 진행바(85 - i*15) 대신 실제 아카이브 집계
  const stats = useMemo(() => calculateStats(concerts), [concerts]);
  const apiKeyMissing = !hasApiKey();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSend = async (text: string = input) => {
    if (!text.trim() || isTyping) return;

    const userMsg = text.trim();
    setMessages(prev => [...prev, { role: 'user', parts: [{ text: userMsg }] }]);
    setInput('');
    setIsTyping(true);

    try {
      const { updatedHistory, intent } = await agent.chat(userMsg, messages);
      setMessages(updatedHistory);
      setIsTyping(false);

      // 추천 턴이면 어떤 공연을 추천했는지 백그라운드로 구조화한다.
      // 응답 표시를 막지 않는다 — 피드백 버튼만 뒤늦게 활성화된다.
      if (intent === 'recommendation') {
        const targetIndex = updatedHistory.length - 1;
        const responseText = updatedHistory[targetIndex]?.parts?.[0]?.text ?? '';
        extractRecommendations(responseText)
          .then(cards => {
            setMessages(prev => {
              if (!prev[targetIndex] || prev[targetIndex].role !== 'model') return prev;
              const next = [...prev];
              next[targetIndex] = { ...next[targetIndex], recommendations: cards };
              return next;
            });
          })
          .catch(err => {
            console.error('Recommendation extraction failed:', err);
            setMessages(prev => {
              if (!prev[targetIndex] || prev[targetIndex].role !== 'model') return prev;
              const next = [...prev];
              next[targetIndex] = { ...next[targetIndex], recommendations: [] };
              return next;
            });
          });
      }
    } catch (err) {
      console.error('Chat Error:', err);
      setMessages(prev => [...prev, { role: 'model', parts: [{ text: describeError(err) }], recommendations: [] }]);
      setIsTyping(false);
    }
  };

  /**
   * 피드백은 **실제 추천된 공연 객체**를 받는다.
   * (이전에는 {title:"추천 공연", artist:"아티스트"} 더미를 넘겨서
   *  "추천 공연 by 아티스트를 좋아함" 같은 무의미한 문장을 학습시키고 있었다.)
   */
  const handleFeedback = async (concert: Concert, liked: boolean) => {
    const busyKey = `${concert.id}:${liked}`;
    setFeedbackBusy(busyKey);
    try {
      const reason = await summarizeFeedback(concert, liked);
      onAddFeedback({
        concertId: concert.id,
        concertTitle: concert.title,
        artist: concert.artist,
        composer: concert.composer || 'Unknown',
        liked,
        reason,
        timestamp: Date.now(),
      });
      setToast(`"${concert.title}" ${liked ? '👍' : '👎'} 반영됨 — ${reason || '취향 프로필 갱신'}`);
    } catch (err) {
      console.error('Feedback Error:', err);
      setToast(describeError(err));
    } finally {
      setFeedbackBusy(null);
    }
  };

  const maxComposerCount = stats.topComposers[0]?.count || 1;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-700">
      <div className="lg:col-span-1 space-y-6">
        <section className="bg-[#2d1b14] border border-[#3e271c] p-6 rounded-[32px] shadow-2xl">
          <h3 className="text-lg font-bold serif text-amber-500 mb-6 flex items-center gap-2">
            <BarChart3 size={20} /> 나의 관람 분석
          </h3>
          <div className="space-y-6">
            <div>
              <p className="text-xs text-amber-200/40 mb-2 font-bold uppercase tracking-wider">
                가장 많이 만난 작곡가
              </p>
              {stats.topComposers.length === 0 ? (
                <p className="text-xs text-amber-200/25 italic leading-relaxed">
                  아직 집계할 프로그램이 없습니다. [티켓 등록]에서 곡목이 있는 티켓을 올리면
                  실제 관람 데이터로 채워집니다.
                </p>
              ) : (
                <div className="space-y-2">
                  {stats.topComposers.slice(0, 3).map((comp, i) => (
                    <div key={comp.name} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#120a06] flex items-center justify-center text-xs font-bold text-amber-500 shadow-inner">{i + 1}</div>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-amber-100 font-medium">{comp.name}</span>
                          <span className="text-amber-200/30">{comp.count}회</span>
                        </div>
                        <div className="h-1 bg-[#120a06] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-600 rounded-full"
                            style={{ width: `${Math.round((comp.count / maxComposerCount) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 bg-[#120a06] rounded-2xl border border-[#3e271c]">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-amber-200/40">누적 관람 비용</span>
                <Receipt size={14} className="text-amber-700" />
              </div>
              <p className="text-xl font-bold text-amber-100">₩{stats.totalSpent.toLocaleString('ko-KR')}</p>
              <p className="text-[10px] text-amber-200/30 mt-1 font-medium italic">
                아카이브 {stats.totalCount}건 기준 · 금액이 기록된 티켓만 합산
              </p>
            </div>
          </div>
        </section>

        <section className="bg-gradient-to-br from-amber-600 to-amber-800 p-6 rounded-[32px] text-[#1a0f0a] shadow-lg shadow-amber-900/40 border border-amber-500/30">
          <h3 className="font-bold serif flex items-center gap-2 mb-2">
            <Sparkles size={18} /> Lions Intelligence
          </h3>
          <p className="text-sm leading-relaxed font-medium opacity-90 italic">
            {feedbackHistory.length === 0
              ? '추천 카드의 👍/👎를 눌러주시면 취향을 학습합니다.'
              : `피드백 ${feedbackHistory.length}건을 학습해 큐레이션에 반영하고 있습니다.`}
          </p>
        </section>
      </div>

      <div className="lg:col-span-2 flex flex-col bg-[#2d1b14] border border-[#3e271c] rounded-[32px] overflow-hidden shadow-2xl min-h-[650px] max-h-[85vh]">
        <header className="px-6 py-4 border-b border-[#3e271c] bg-[#120a06]/80 backdrop-blur flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center text-[#1a0f0a] shadow-lg border border-amber-500/50">
              <Bot size={24} />
            </div>
            <div>
              <h3 className="font-bold serif text-amber-50">AI 큐레이터 리언즈</h3>
              <p className="text-[10px] text-amber-500/80 flex items-center gap-1 font-bold uppercase tracking-widest">
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse shadow-[0_0_5px_#d97706]"></span> Agentic Pipeline
              </p>
            </div>
          </div>
        </header>

        {apiKeyMissing && (
          <div className="flex gap-2 px-6 py-3 bg-red-950/50 border-b border-red-900 text-red-100 text-xs">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-red-400" />
            <span>
              Gemini API 키가 없습니다. <code className="bg-black/40 px-1 rounded">app/.env</code> 에
              <code className="bg-black/40 px-1 rounded mx-1">GEMINI_API_KEY</code>를 설정하고
              개발 서버를 재시작하세요.
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#1a0f0a]/40">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-6 py-10 opacity-60">
              <div className="p-5 bg-[#2d1b14] rounded-full text-amber-900 border border-[#3e271c]">
                <Music size={48} />
              </div>
              <div>
                <p className="text-amber-100/60 font-medium italic serif">클래식 리언즈에게 취향을 물어보세요</p>
                <div className="flex flex-wrap justify-center gap-2 mt-4">
                  {['이번 주 추천 공연', '내 관람 통계', '브람스 연주회'].map(q => (
                    <button key={q} onClick={() => handleSend(q)} className="px-3 py-1.5 rounded-full bg-[#120a06] border border-[#3e271c] text-[11px] text-amber-100/40 hover:text-amber-500 hover:border-amber-500 transition-all">{q}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] flex flex-col gap-2 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-lg flex shrink-0 items-center justify-center ${m.role === 'user' ? 'bg-[#3e271c] text-amber-100/60' : 'bg-amber-600 text-[#1a0f0a]'}`}>
                    {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                  </div>
                  <div className={`p-4 rounded-2xl text-sm leading-relaxed shadow-lg whitespace-pre-wrap ${m.role === 'user' ? 'bg-[#3e271c] text-amber-50 rounded-tr-none' : 'bg-[#120a06] border border-[#3e271c] text-amber-100/90 rounded-tl-none'}`}>
                    {m.parts?.[0]?.text}

                    {m.sources && m.sources.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-[#3e271c] flex flex-wrap gap-2">
                        {m.sources.map((s, si) => (
                          <a key={si} href={s.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2 py-1 bg-[#2d1b14] rounded text-[10px] text-amber-200/30 hover:text-amber-500 transition-colors">
                            <ExternalLink size={10} /> {s.title || 'Source'}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 추천 카드 — 피드백은 메시지가 아니라 이 카드 단위로 붙는다 */}
                {m.role === 'model' && m.intent === 'recommendation' && (
                  <div className="ml-11 w-full space-y-2">
                    {m.recommendations === undefined && (
                      <p className="text-[10px] text-amber-200/30 flex items-center gap-1.5">
                        <Loader2 size={10} className="animate-spin" /> 추천 공연을 카드로 정리하는 중…
                      </p>
                    )}
                    {m.recommendations?.length === 0 && (
                      <p className="text-[10px] text-amber-200/30 italic leading-relaxed">
                        이 답변에서 특정 가능한 추천 공연을 찾지 못해 피드백을 받을 수 없습니다.
                        공연명이 명시된 추천을 요청해 보세요.
                      </p>
                    )}
                    {m.recommendations?.map(rec => (
                      <div key={rec.id} className="bg-[#120a06] border border-[#3e271c] rounded-2xl p-3 flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-bold text-amber-100 truncate">{rec.title}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-amber-200/35">
                            {rec.artist && <span className="flex items-center gap-1"><User size={9} />{rec.artist}</span>}
                            {rec.venue && <span className="flex items-center gap-1"><MapPin size={9} />{rec.venue}</span>}
                            {rec.date && <span className="flex items-center gap-1"><CalendarDays size={9} />{rec.date}</span>}
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={() => handleFeedback(rec, true)}
                            disabled={feedbackBusy !== null}
                            className="p-1.5 bg-[#1a0f0a] rounded-lg text-amber-200/30 hover:text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-40 transition-all"
                            title="이런 공연 좋아요"
                          >
                            {feedbackBusy === `${rec.id}:true` ? <Loader2 size={14} className="animate-spin" /> : <ThumbsUp size={14} />}
                          </button>
                          <button
                            onClick={() => handleFeedback(rec, false)}
                            disabled={feedbackBusy !== null}
                            className="p-1.5 bg-[#1a0f0a] rounded-lg text-amber-200/30 hover:text-red-500 hover:bg-red-500/10 disabled:opacity-40 transition-all"
                            title="취향이 아니에요"
                          >
                            {feedbackBusy === `${rec.id}:false` ? <Loader2 size={14} className="animate-spin" /> : <ThumbsDown size={14} />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {m.agentSteps && (
                  <div className="ml-11 w-full max-w-sm">
                    <button
                      onClick={() => setExpandedSteps(expandedSteps === i ? null : i)}
                      className="flex items-center gap-2 text-[10px] font-bold text-amber-200/30 hover:text-amber-500 transition-colors bg-[#120a06]/50 px-3 py-1.5 rounded-full border border-[#3e271c]"
                    >
                      <BrainCircuit size={12} />
                      AI 사고 과정 ({m.agentSteps.length}단계) {expandedSteps === i ? '접기' : '보기'}
                    </button>
                    {expandedSteps === i && <AgentTimeline steps={m.agentSteps} />}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-[#120a06] border border-[#3e271c] p-4 rounded-2xl flex items-center gap-3 shadow-xl">
                <Loader2 size={16} className="animate-spin text-amber-500" />
                <span className="text-xs text-amber-200/40 font-medium italic">리언즈가 최적의 결과를 위해 추론 중입니다...</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {toast && (
          <div className="px-6 py-2 bg-[#120a06] border-t border-[#3e271c] text-[11px] text-amber-200/60 truncate">
            {toast}
          </div>
        )}

        <footer className="p-4 bg-[#120a06] border-t border-[#3e271c] shrink-0">
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="공연 추천이나 통계 분석을 요청해보세요..."
              className="w-full bg-[#1a0f0a] border border-[#3e271c] rounded-2xl pl-5 pr-12 py-4 text-sm focus:outline-none focus:border-amber-500 transition-all placeholder:text-amber-200/10 text-amber-50"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isTyping}
              className="absolute right-2 p-3 bg-amber-600 text-[#1a0f0a] rounded-xl hover:bg-amber-500 disabled:opacity-50 disabled:hover:bg-amber-600 transition-all shadow-xl border border-amber-400/20"
            >
              <Send size={18} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Dashboard;


import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Send, Bot, User, BarChart3, Receipt, Music, Sparkles, Loader2, BrainCircuit, ExternalLink, ThumbsUp, ThumbsDown } from 'lucide-react';
import { UserProfile, Concert, ChatMessage, FeedbackEntry } from '../types';
import { ClassicAgent, summarizeFeedback } from '../services/geminiService';
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
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const agent = useMemo(() => new ClassicAgent(profile, concerts, feedbackHistory), [profile, concerts, feedbackHistory]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = async (text: string = input) => {
    if (!text.trim() || isTyping) return;

    const userMsg = text.trim();
    const newUserMessage: ChatMessage = { role: 'user', parts: [{ text: userMsg }] };
    setMessages(prev => [...prev, newUserMessage]);
    setInput('');
    setIsTyping(true);

    try {
      const { updatedHistory } = await agent.chat(userMsg, messages);
      setMessages(updatedHistory);
    } catch (err) {
      console.error("Chat Error:", err);
      setMessages(prev => [...prev, { role: 'model', parts: [{ text: "오류가 발생했습니다." }] }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleFeedback = async (messageIndex: number, liked: boolean) => {
    const reason = await summarizeFeedback({ title: "추천 공연", artist: "아티스트", program: [], venue: "", date: "", id: "0", type: "upcoming" } as Concert, liked);
    onAddFeedback({
      concertTitle: "AI 추천",
      composer: "Unknown",
      liked,
      reason,
      timestamp: Date.now()
    });
    alert(`${liked ? '긍정' : '부정'} 피드백이 반영되었습니다. 다음 추천에 참고할게요!`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-700">
      <div className="lg:col-span-1 space-y-6">
        <section className="bg-[#2d1b14] border border-[#3e271c] p-6 rounded-[32px] shadow-2xl">
          <h3 className="text-lg font-bold serif text-amber-500 mb-6 flex items-center gap-2">
            <BarChart3 size={20} /> 나의 관람 분석
          </h3>
          <div className="space-y-6">
            <div>
              <p className="text-xs text-amber-200/40 mb-2 font-bold uppercase tracking-wider">가장 많이 만난 작곡가</p>
              <div className="space-y-2">
                {profile.favoriteComposers.slice(0, 3).map((comp, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#120a06] flex items-center justify-center text-xs font-bold text-amber-500 shadow-inner">{i+1}</div>
                    <div className="flex-1">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-amber-100 font-medium">{comp}</span>
                        <span className="text-amber-200/30">취향 일치</span>
                      </div>
                      <div className="h-1 bg-[#120a06] rounded-full overflow-hidden">
                        <div className="h-full bg-amber-600 rounded-full" style={{ width: `${85 - (i*15)}%` }}></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="p-4 bg-[#120a06] rounded-2xl border border-[#3e271c]">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-amber-200/40">누적 관람 비용 (평가)</span>
                <Receipt size={14} className="text-amber-700" />
              </div>
              <p className="text-xl font-bold text-amber-100">₩{concerts.reduce((sum, c) => sum + (c.price || 0), 0).toLocaleString()}</p>
              <p className="text-[10px] text-emerald-400 mt-1 font-medium italic">관리 데이터 기반 분석 완료</p>
            </div>
          </div>
        </section>

        <section className="bg-gradient-to-br from-amber-600 to-amber-800 p-6 rounded-[32px] text-[#1a0f0a] shadow-lg shadow-amber-900/40 border border-amber-500/30">
          <h3 className="font-bold serif flex items-center gap-2 mb-2">
            <Sparkles size={18} /> Lions Intelligence
          </h3>
          <p className="text-sm leading-relaxed font-medium opacity-90 italic">
            "당신의 피드백 {feedbackHistory.length}건을 학습하여 더욱 정교한 큐레이션을 준비 중입니다."
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
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse shadow-[0_0_5px_#d97706]"></span> Agentic RAG Pipeline
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#1a0f0a]/40">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-6 py-10 opacity-60">
              <div className="p-5 bg-[#2d1b14] rounded-full text-amber-900 border border-[#3e271c]">
                <Music size={48} />
              </div>
              <div>
                <p className="text-amber-100/60 font-medium italic serif">클래식 리언즈에게 취향을 물어보세요</p>
                <div className="flex flex-wrap justify-center gap-2 mt-4">
                  {["이번 주 추천 공연", "내 관람 통계", "브람스 연주회"].map(q => (
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
                    {m.role === 'user' ? <User size={16}/> : <Bot size={16}/>}
                  </div>
                  <div className={`p-4 rounded-2xl text-sm leading-relaxed shadow-lg whitespace-pre-wrap ${m.role === 'user' ? 'bg-[#3e271c] text-amber-50 rounded-tr-none' : 'bg-[#120a06] border border-[#3e271c] text-amber-100/90 rounded-tl-none'}`}>
                    {m.parts?.[0]?.text}
                    
                    {m.sources && m.sources.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-[#3e271c] flex flex-wrap gap-2">
                        {m.sources.map((s, si) => (
                          <a key={si} href={s.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2 py-1 bg-[#2d1b14] rounded text-[10px] text-amber-200/30 hover:text-amber-500 transition-colors">
                            <ExternalLink size={10} /> {s.title || "Source"}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

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
                    
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => handleFeedback(i, true)} className="p-1.5 bg-[#120a06] rounded-lg text-amber-200/30 hover:text-emerald-500 hover:bg-emerald-500/10 transition-all"><ThumbsUp size={14} /></button>
                      <button onClick={() => handleFeedback(i, false)} className="p-1.5 bg-[#120a06] rounded-lg text-amber-200/30 hover:text-red-500 hover:bg-red-500/10 transition-all"><ThumbsDown size={14} /></button>
                    </div>
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

        <footer className="p-4 bg-[#120a06] border-t border-[#3e271c] shrink-0">
          <div className="relative flex items-center">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
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

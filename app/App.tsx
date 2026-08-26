
import React, { useState, useEffect, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Calendar, Ticket, User, Music2, AlertTriangle, X } from 'lucide-react';
import Dashboard from './components/Dashboard';
import CalendarView from './components/CalendarView';
import TicketOCR from './components/TicketOCR';
import ProfileSettings from './components/ProfileSettings';
import { UserProfile, Concert, FeedbackEntry } from './types';
import { INITIAL_PROFILE, MOCK_PAST_CONCERTS } from './constants';
import { STORAGE_KEYS, loadState, saveState, saveConcerts } from './services/storage';

const App: React.FC = () => {
  // E. 새로고침해도 살아남게 localStorage에서 복원한다.
  const [profile, setProfile] = useState<UserProfile>(
    () => loadState<UserProfile>(STORAGE_KEYS.profile, INITIAL_PROFILE),
  );
  const [concerts, setConcerts] = useState<Concert[]>(
    () => loadState<Concert[]>(STORAGE_KEYS.concerts, MOCK_PAST_CONCERTS),
  );
  const [feedbackHistory, setFeedbackHistory] = useState<FeedbackEntry[]>(
    () => loadState<FeedbackEntry[]>(STORAGE_KEYS.feedback, []),
  );
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  // 첫 렌더의 저장 왕복을 건너뛴다 (막 복원한 값을 곧바로 되쓸 이유가 없다)
  const hydrated = useRef(false);
  useEffect(() => { hydrated.current = true; }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    const r = saveState(STORAGE_KEYS.profile, profile);
    if (!r.ok) setStorageWarning(r.message ?? null);
  }, [profile]);

  useEffect(() => {
    if (!hydrated.current) return;
    // 티켓 이미지가 base64라 여기서만 용량 초과가 난다 → 이미지를 떼고라도 살린다.
    const r = saveConcerts(concerts);
    if (!r.ok) setStorageWarning(r.message ?? null);
    else if (r.degraded) setStorageWarning(r.message ?? null);
    else setStorageWarning(null);
  }, [concerts]);

  useEffect(() => {
    if (!hydrated.current) return;
    const r = saveState(STORAGE_KEYS.feedback, feedbackHistory);
    if (!r.ok) setStorageWarning(r.message ?? null);
  }, [feedbackHistory]);

  const addConcert = (newConcert: Concert) => {
    setConcerts(prev => [...prev, newConcert]);
  };

  const addFeedback = (feedback: FeedbackEntry) => {
    setFeedbackHistory(prev => [...prev, feedback]);
  };

  return (
    <Router>
      <div className="flex flex-col min-h-screen bg-[#1a0f0a] text-[#fdf8f1] pb-20 md:pb-0 md:pl-64">
        {/* Sidebar */}
        <nav className="hidden md:flex flex-col fixed left-0 top-0 w-64 h-full bg-[#120a06] border-r border-[#3e271c] p-6 z-50">
          <div className="flex items-center gap-2 mb-10">
            <div className="p-2 bg-amber-600 rounded-lg shadow-lg">
              <Music2 className="text-[#1a0f0a]" size={24} />
            </div>
            <h1 className="text-xl font-bold serif text-amber-500 tracking-wider">CLASSIC LIONS</h1>
          </div>
          <div className="flex flex-col gap-4">
            <NavLink to="/" icon={<LayoutDashboard size={20} />} label="대시보드" />
            <NavLink to="/calendar" icon={<Calendar size={20} />} label="공연 달력" />
            <NavLink to="/upload" icon={<Ticket size={20} />} label="티켓 등록" />
            <NavLink to="/profile" icon={<User size={20} />} label="내 취향" />
          </div>
          <div className="mt-auto p-4 bg-[#2d1b14] rounded-xl border border-[#3e271c]">
            <p className="text-xs text-amber-200/50 mb-1">관람 아카이브</p>
            <p className="text-2xl font-bold text-amber-500">{concerts.length}회</p>
          </div>
        </nav>

        {/* Mobile Nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#120a06] border-t border-[#3e271c] flex justify-around items-center z-50">
          <MobileNavLink to="/" icon={<LayoutDashboard size={24} />} />
          <MobileNavLink to="/calendar" icon={<Calendar size={24} />} />
          <MobileNavLink to="/upload" icon={<Ticket size={24} />} />
          <MobileNavLink to="/profile" icon={<User size={24} />} />
        </nav>

        {storageWarning && (
          <div className="sticky top-0 z-40 flex items-start gap-2 px-4 py-2.5 bg-amber-900/40 border-b border-amber-700/50 text-amber-100 text-xs backdrop-blur">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-400" />
            <span className="flex-1 leading-relaxed">{storageWarning}</span>
            <button onClick={() => setStorageWarning(null)} className="shrink-0 text-amber-300/60 hover:text-amber-100">
              <X size={14} />
            </button>
          </div>
        )}

        <main className="p-4 md:p-8 max-w-5xl mx-auto w-full">
          <Routes>
            <Route path="/" element={<Dashboard profile={profile} concerts={concerts} feedbackHistory={feedbackHistory} onAddFeedback={addFeedback} />} />
            <Route path="/calendar" element={<CalendarView concerts={concerts} />} />
            <Route path="/upload" element={<TicketOCR onAddConcert={addConcert} />} />
            <Route path="/profile" element={<ProfileSettings profile={profile} onSave={setProfile} />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
};

const NavLink: React.FC<{ to: string; icon: React.ReactNode; label: string }> = ({ to, icon, label }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link to={to} className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 ${isActive ? 'bg-amber-600 text-[#1a0f0a] shadow-lg translate-x-1' : 'hover:bg-[#2d1b14] text-amber-100/60'}`}>
      {icon}
      <span className="font-semibold">{label}</span>
    </Link>
  );
};

const MobileNavLink: React.FC<{ to: string; icon: React.ReactNode }> = ({ to, icon }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link to={to} className={`p-2 rounded-lg transition-colors ${isActive ? 'text-amber-500' : 'text-amber-100/40'}`}>
      {icon}
    </Link>
  );
};

export default App;


import React, { useState } from 'react';
import { Concert } from '../types';
import { ChevronLeft, ChevronRight, Music, MapPin, ExternalLink, Ticket as TicketIcon, User } from 'lucide-react';

interface CalendarViewProps {
  concerts: Concert[];
}

const CalendarView: React.FC<CalendarViewProps> = ({ concerts }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const month = currentDate.getMonth();
  const year = currentDate.getFullYear();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const concertMap: Record<number, Concert[]> = {};
  concerts.forEach(c => {
    const d = new Date(c.date);
    if (d.getMonth() === month && d.getFullYear() === year) {
      const day = d.getDate();
      if (!concertMap[day]) concertMap[day] = [];
      concertMap[day].push(c);
    }
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold serif text-amber-500">공연 캘린더</h2>
          <p className="text-amber-100/40 mt-1">당신의 모든 클래식 여정이 달력 위에 살아납니다.</p>
        </div>
        <div className="flex items-center gap-4 bg-[#120a06] p-2 rounded-2xl border border-[#3e271c] self-start md:self-auto shadow-2xl">
          <button onClick={prevMonth} className="p-2 hover:bg-[#2d1b14] rounded-xl transition-colors text-amber-200/30 hover:text-amber-500"><ChevronLeft size={20}/></button>
          <span className="font-bold serif text-lg min-w-[140px] text-center text-amber-100">{year}년 {month + 1}월</span>
          <button onClick={nextMonth} className="p-2 hover:bg-[#2d1b14] rounded-xl transition-colors text-amber-200/30 hover:text-amber-500"><ChevronRight size={20}/></button>
        </div>
      </header>

      <div className="bg-[#2d1b14] rounded-[40px] border border-[#3e271c] overflow-hidden shadow-2xl">
        <div className="grid grid-cols-7 border-b border-[#3e271c] bg-[#120a06]/50">
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
            <div key={d} className={`p-4 text-center text-[10px] font-black uppercase tracking-widest ${i === 0 ? 'text-red-800' : i === 6 ? 'text-blue-800' : 'text-amber-200/20'}`}>
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {Array.from({ length: firstDayOfMonth }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[140px] border-r border-b border-[#3e271c]/30 bg-[#120a06]/10"></div>
          ))}
          
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dailyConcerts = concertMap[day] || [];
            const representativeImage = dailyConcerts.find(c => c.imageUrl)?.imageUrl;

            return (
              <div 
                key={day} 
                className="relative min-h-[140px] p-2 border-r border-b border-[#3e271c]/50 group transition-all duration-500 overflow-hidden hover:bg-[#120a06]/40"
              >
                {representativeImage && (
                  <div className="absolute inset-0 z-0">
                    <img 
                      src={representativeImage} 
                      className="w-full h-full object-cover opacity-20 grayscale group-hover:grayscale-0 group-hover:opacity-60 group-hover:scale-110 transition-all duration-700" 
                      alt=""
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#1a0f0a] via-transparent to-transparent"></div>
                  </div>
                )}

                <span className={`relative z-10 text-xs font-bold transition-colors ${dailyConcerts.length > 0 ? 'text-amber-500' : 'text-amber-100/20'}`}>
                  {day}
                </span>

                <div className="relative z-10 mt-2 space-y-1">
                  {dailyConcerts.map(c => (
                    <div 
                      key={c.id} 
                      className="group/item flex items-center gap-1.5 p-1.5 bg-[#120a06]/80 backdrop-blur-sm border border-[#3e271c] rounded-lg text-[10px] text-amber-100/70 truncate cursor-pointer hover:bg-amber-600 hover:text-[#1a0f0a] hover:border-amber-400 transition-all shadow-lg"
                    >
                      <div className="w-1 h-1 rounded-full bg-amber-500 group-hover/item:bg-[#1a0f0a]"></div>
                      <span className="truncate font-medium">{c.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <section className="space-y-6">
        <div className="flex items-center justify-between border-b border-[#3e271c] pb-4">
          <h3 className="text-xl font-bold serif flex items-center gap-2">
            <TicketIcon size={20} className="text-amber-500" />
            {month + 1}월 공연 아카이브
          </h3>
          <span className="text-xs text-amber-200/30 font-bold uppercase tracking-widest">{Object.values(concertMap).flat().length} Entries</span>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Object.values(concertMap).flat().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map(c => (
            <div key={c.id} className="group flex flex-col bg-[#2d1b14] border border-[#3e271c] rounded-[32px] overflow-hidden hover:border-amber-500/50 transition-all shadow-2xl hover:shadow-amber-900/40 hover:-translate-y-1">
              <div className="relative h-48 overflow-hidden bg-[#120a06]">
                <img 
                  src={c.imageUrl || `https://api.dicebear.com/7.x/shapes/svg?seed=${c.id}`} 
                  className="w-full h-full object-cover grayscale opacity-80 transition-all duration-700 group-hover:scale-110 group-hover:grayscale-0 group-hover:opacity-100" 
                  alt={c.title}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#2d1b14] via-transparent to-transparent"></div>
                <div className="absolute top-4 left-4">
                  <span className="px-3 py-1 bg-amber-600 text-[#1a0f0a] text-[10px] font-black rounded-full shadow-xl border border-amber-400/30">
                    {new Date(c.date).toLocaleDateString('ko-KR', { day: 'numeric', weekday: 'short' })}
                  </span>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <h4 className="font-bold text-amber-50 serif text-lg truncate group-hover:text-amber-500 transition-colors">{c.title}</h4>
                  <p className="text-xs text-amber-200/40 font-medium flex items-center gap-1.5">
                    <User size={12} className="text-amber-600" /> {c.artist}
                  </p>
                </div>
                <div className="pt-4 border-t border-[#3e271c] flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-200/30 font-medium italic">
                    <MapPin size={12} /> {c.venue}
                  </div>
                  <button className="p-2 bg-[#120a06] rounded-xl text-amber-700 hover:text-amber-500 transition-all border border-[#3e271c]">
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default CalendarView;

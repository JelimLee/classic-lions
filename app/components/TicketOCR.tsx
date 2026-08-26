
import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Check, Loader2, X, Music, Plus, Edit3, BookOpen, BookText, ExternalLink } from 'lucide-react';
import { performOCR, enrichProgramNotes } from '../services/geminiService';
import { Concert, OCRResult, ProgramNote, GroundingSource } from '../types';

interface TicketOCRProps {
  onAddConcert: (concert: Concert) => void;
}

const TicketOCR: React.FC<TicketOCRProps> = ({ onAddConcert }) => {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [ocrData, setOcrData] = useState<OCRResult | null>(null);
  const [programNotes, setProgramNotes] = useState<ProgramNote[]>([]);
  const [enrichSources, setEnrichSources] = useState<GroundingSource[]>([]);
  const [success, setSuccess] = useState(false);
  const [newProgramItem, setNewProgramItem] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editForm, setEditForm] = useState<OCRResult | null>(null);

  useEffect(() => {
    if (ocrData) {
      setEditForm(ocrData);
    }
  }, [ocrData]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        processImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const processImage = async (base64: string) => {
    setLoading(true);
    setOcrData(null);
    setEditForm(null);
    setProgramNotes([]);
    const base64Data = base64.split(',')[1];
    const result = await performOCR(base64Data);
    if (result) {
      setOcrData(result);
      setEnrichLoading(true);
      try {
        const enrichment = await enrichProgramNotes(result);
        setProgramNotes(enrichment.notes);
        setEnrichSources(enrichment.sources);
      } catch (err) {
        console.error("Enrichment Error:", err);
      } finally {
        setEnrichLoading(false);
      }
    }
    setLoading(false);
  };

  const handleInputChange = (field: keyof OCRResult, value: string) => {
    if (!editForm) return;
    setEditForm({ ...editForm, [field]: value });
  };

  const removeProgramItem = (index: number) => {
    if (!editForm) return;
    const newProgram = [...editForm.program];
    newProgram.splice(index, 1);
    setEditForm({ ...editForm, program: newProgram });
  };

  const addProgramItem = () => {
    if (!editForm || !newProgramItem.trim()) return;
    setEditForm({ ...editForm, program: [...editForm.program, newProgramItem.trim()] });
    setNewProgramItem('');
  };

  const handleConfirm = () => {
    if (editForm) {
      let normalizedDate = editForm.date.replace(/년|월/g, '-').replace(/일/g, '').replace(/\s/g, '');
      if (normalizedDate.endsWith('-')) normalizedDate = normalizedDate.slice(0, -1);
      
      const newConcert: Concert = {
        id: Date.now().toString(),
        title: editForm.title,
        artist: editForm.artist,
        venue: editForm.venue,
        date: normalizedDate,
        program: editForm.program,
        type: 'past',
        imageUrl: image || undefined,
        composer: editForm.artist.includes('임윤찬') ? 'Rachmaninoff' : undefined
      };
      
      onAddConcert(newConcert);
      setSuccess(true);
      setTimeout(() => {
        setImage(null);
        setOcrData(null);
        setEditForm(null);
        setSuccess(false);
      }, 2000);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-8 animate-in zoom-in duration-300">
      <header className="text-center">
        <h2 className="text-3xl font-bold serif text-amber-500">티켓 아카이빙</h2>
        <p className="text-amber-100/40 mt-2">AI로 곡 정보와 해설까지 한 번에 아카이빙하세요.</p>
      </header>

      {!image ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center gap-4 p-12 bg-[#2d1b14] border-2 border-dashed border-[#3e271c] rounded-3xl hover:border-amber-500/50 transition-all group shadow-xl">
            <div className="p-4 bg-[#120a06] rounded-full group-hover:bg-amber-600 group-hover:text-[#1a0f0a] transition-all shadow-inner"><Camera size={32} /></div>
            <div className="text-center"><p className="font-bold text-lg text-amber-50">카메라 촬영</p></div>
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center gap-4 p-12 bg-[#2d1b14] border-2 border-dashed border-[#3e271c] rounded-3xl hover:border-amber-500/50 transition-all group shadow-xl">
            <div className="p-4 bg-[#120a06] rounded-full group-hover:bg-amber-600 group-hover:text-[#1a0f0a] transition-all shadow-inner"><Upload size={32} /></div>
            <div className="text-center"><p className="font-bold text-lg text-amber-50">파일 업로드</p></div>
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="relative aspect-[3/2] w-full bg-[#120a06] rounded-3xl overflow-hidden border border-[#3e271c] shadow-2xl">
            <img src={image} alt="Ticket Preview" className="w-full h-full object-contain" />
            <button onClick={() => {setImage(null); setOcrData(null); setEditForm(null);}} className="absolute top-4 right-4 p-2 bg-[#1a0f0a]/80 rounded-full text-white hover:bg-red-900 transition-colors"><X size={20} /></button>
            {(loading || enrichLoading) && (
              <div className="absolute inset-0 bg-[#120a06]/70 backdrop-blur-md flex flex-col items-center justify-center z-20">
                <Loader2 className="animate-spin text-amber-500 mb-4" size={48} />
                <p className="text-amber-500 font-bold serif animate-pulse">
                  {loading ? "AI가 티켓 판독 중..." : "AI가 프로그램 노트를 작성 중..."}
                </p>
              </div>
            )}
          </div>

          {editForm && !loading && (
            <div className="bg-[#2d1b14] p-6 rounded-3xl border border-[#3e271c] space-y-6 animate-in slide-in-from-bottom duration-500 shadow-2xl">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {['title', 'artist', 'date', 'venue'].map(f => (
                  <div key={f} className="space-y-1">
                    <label className="text-[10px] font-bold text-amber-200/20 uppercase tracking-widest">{f}</label>
                    <input type="text" value={(editForm as any)[f]} onChange={(e) => handleInputChange(f as any, e.target.value)} className="w-full bg-[#120a06] border border-[#3e271c] rounded-xl px-4 py-3 text-sm text-amber-50 focus:border-amber-500 outline-none transition-all" />
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-amber-200/20 uppercase tracking-widest">Program List</label>
                <div className="flex flex-wrap gap-2">
                  {editForm.program.map((p, i) => (
                    <span key={i} className="px-3 py-1.5 bg-[#120a06] rounded-lg text-xs flex items-center gap-2 border border-[#3e271c] text-amber-100/70">
                      <Music size={10} className="text-amber-600" /> {p}
                      <button onClick={() => removeProgramItem(i)} className="hover:text-red-500 transition-colors"><X size={12} /></button>
                    </span>
                  ))}
                </div>
              </div>

              {programNotes.length > 0 && (
                <div className="space-y-4 pt-6 border-t border-[#3e271c]">
                  <h4 className="text-amber-500 font-bold flex items-center gap-2 text-sm uppercase tracking-wider italic">
                    <BookOpen size={18} /> AI Generated Program Notes
                  </h4>
                  <div className="space-y-3">
                    {programNotes.map((note, i) => (
                      <details key={i} className="bg-[#120a06] border border-[#3e271c] rounded-2xl overflow-hidden group shadow-inner">
                        <summary className="p-4 cursor-pointer font-bold text-xs flex items-center justify-between text-amber-100/80">
                          <span className="flex items-center gap-2"><BookText size={14} className="text-amber-800" /> {note.composer} - {note.title}</span>
                          <span className="text-[10px] text-amber-900 group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <div className="p-4 pt-0 space-y-3 text-xs text-amber-100/40 leading-relaxed border-t border-[#3e271c]/30">
                          <p><strong className="text-amber-500/60">Background:</strong> {note.background}</p>
                          <p><strong className="text-emerald-700">Listening Tip:</strong> {note.listeningTip}</p>
                          <p><strong className="text-blue-800">Recommendation:</strong> {note.recommendedRecording}</p>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={handleConfirm} disabled={success} className={`w-full py-5 rounded-2xl font-black text-lg flex items-center justify-center gap-2 transition-all shadow-xl border border-amber-500/20 ${success ? 'bg-emerald-800 text-white' : 'bg-amber-600 text-[#1a0f0a] hover:bg-amber-500 active:scale-95'}`}>
                {success ? <><Check size={24} /> 저장 완료!</> : <><Check size={20} /> 데이터 저장 및 분석 반영</>}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TicketOCR;

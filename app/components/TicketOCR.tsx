
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera, Upload, Check, Loader2, X, Music, BookOpen, BookText,
  AlertTriangle, Armchair, Plus, ExternalLink,
} from 'lucide-react';
import { performOCR, enrichProgramNotes, describeError, hasApiKey } from '../services/geminiService';
import { prepareTicketImage, MAX_EDGE } from '../services/imagePrep';
import {
  parseSeat, extractComposers, LOW_CONFIDENCE_THRESHOLD,
  type OCRResult,
} from '../services/ocrSchema';
import { Concert, ProgramNote, GroundingSource } from '../types';

interface TicketOCRProps {
  onAddConcert: (concert: Concert) => void;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

type EditableField = 'title' | 'artist' | 'venue' | 'date' | 'time' | 'seatRaw' | 'gradeRaw' | 'priceRaw';

const FIELDS: { key: EditableField; confKey: string; label: string; placeholder: string }[] = [
  { key: 'title',    confKey: 'title',  label: '공연명',              placeholder: '예: 임윤찬 피아노 리사이틀' },
  { key: 'artist',   confKey: 'artist', label: '연주자',              placeholder: '예: 임윤찬' },
  { key: 'venue',    confKey: 'venue',  label: '공연장',              placeholder: '예: 롯데콘서트홀' },
  { key: 'date',     confKey: 'date',   label: '관람일 (YYYY-MM-DD)', placeholder: '2025-03-15' },
  { key: 'time',     confKey: 'time',   label: '시작 시각 (HH:MM)',   placeholder: '19:30' },
  { key: 'seatRaw',  confKey: 'seat',   label: '좌석',                placeholder: '예: 객석 1층 B구역 15열 01번' },
  { key: 'gradeRaw', confKey: 'grade',  label: '좌석 등급',            placeholder: '예: R석 / 회원석 / 일반석' },
  { key: 'priceRaw', confKey: 'price',  label: '금액',                placeholder: '예: 70,000원' },
];

/** 파싱된 좌석을 사람이 읽을 한 줄로 */
function seatSummary(seat: OCRResult['seat']): string | null {
  const bits: string[] = [];
  if (seat.grade) bits.push(seat.grade);
  if (seat.floor !== null) bits.push(`${seat.floor}층`);
  if (seat.block) bits.push(`${seat.block}구역`);
  if (seat.row !== null) bits.push(`${seat.row}열`);
  if (seat.number !== null) bits.push(`${seat.number}번`);
  return bits.length ? bits.join(' · ') : null;
}

const TicketOCR: React.FC<TicketOCRProps> = ({ onAddConcert }) => {
  const [image, setImage] = useState<string | null>(null);
  const [prepInfo, setPrepInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<OCRResult | null>(null);
  const [programNotes, setProgramNotes] = useState<ProgramNote[]>([]);
  const [enrichSources, setEnrichSources] = useState<GroundingSource[]>([]);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [newProgramItem, setNewProgramItem] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 요청 세대 카운터 — 사용자가 새 사진을 올리면 이전 응답을 버린다 */
  const reqIdRef = useRef(0);

  const apiKeyMissing = !hasApiKey();

  useEffect(() => () => { reqIdRef.current++; }, []);

  const reset = () => {
    reqIdRef.current++;
    setImage(null);
    setPrepInfo(null);
    setEditForm(null);
    setProgramNotes([]);
    setEnrichSources([]);
    setEnrichError(null);
    setError(null);
    setSaveError(null);
    setLoading(false);
    setEnrichLoading(false);
  };

  /** OCR 결과가 나오면 즉시 폼을 띄우고, enrich는 백그라운드로 돌린다 (D5) */
  const runEnrichInBackground = useCallback((result: OCRResult, reqId: number) => {
    if (!result.program.length) return;
    setEnrichLoading(true);
    setEnrichError(null);
    enrichProgramNotes(result)
      .then(enrichment => {
        if (reqIdRef.current !== reqId) return;
        setProgramNotes(enrichment.notes);
        setEnrichSources(enrichment.sources);
      })
      .catch(err => {
        if (reqIdRef.current !== reqId) return;
        console.error('Enrichment Error:', err);
        setEnrichError(describeError(err));
      })
      .finally(() => {
        if (reqIdRef.current === reqId) setEnrichLoading(false);
      });
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 같은 파일을 다시 고를 수 있게 값 초기화
    e.target.value = '';
    if (!file) return;

    const reqId = ++reqIdRef.current;
    setError(null);
    setSaveError(null);
    setEditForm(null);
    setProgramNotes([]);
    setEnrichSources([]);
    setEnrichError(null);
    setLoading(true);

    try {
      // C. EXIF 회전 보정 + 장변 1568 리사이즈 + JPEG 0.85
      const prepared = await prepareTicketImage(file);
      if (reqIdRef.current !== reqId) return;

      setImage(prepared.dataUrl);
      setPrepInfo(
        `${prepared.originalWidth}×${prepared.originalHeight} → ${prepared.width}×${prepared.height}` +
        `${prepared.resized ? ` (장변 ${MAX_EDGE}px로 축소)` : ' (원본 유지)'} · ${Math.round(prepared.bytes / 1024)}KB`
      );

      const result = await performOCR(prepared.base64, prepared.mimeType);
      if (reqIdRef.current !== reqId) return;

      setEditForm(result);
      setLoading(false);          // ← 폼 즉시 표시. enrich를 기다리지 않는다.
      runEnrichInBackground(result, reqId);
    } catch (err) {
      if (reqIdRef.current !== reqId) return;
      console.error('OCR Error:', err);
      setError(describeError(err));
      setLoading(false);
    }
  };

  const handleInputChange = (field: EditableField, confKey: string, value: string) => {
    setEditForm(prev => {
      if (!prev) return prev;
      const next: OCRResult = { ...prev, confidence: { ...prev.confidence, [confKey]: 1 } };

      if (field === 'date') {
        next.date = value.trim() || null;
      } else if (field === 'time') {
        next.time = value.trim() || null;
      } else if (field === 'seatRaw' || field === 'gradeRaw') {
        (next as any)[field] = value;
        // 등급은 좌석과 다른 영역에 인쇄되므로 둘을 함께 넣어 다시 판정한다.
        next.seat = parseSeat(next.seatRaw, next.gradeRaw);
        next.parseConfidence = { ...next.parseConfidence, seat: next.seat.confidence };
      } else {
        (next as any)[field] = value;
      }
      return next;
    });
    setSaveError(null);
  };

  const setProgram = (program: string[]) => {
    setEditForm(prev => prev ? { ...prev, program, composers: extractComposers(program) } : prev);
  };

  const removeProgramItem = (index: number) => {
    if (!editForm) return;
    const next = [...editForm.program];
    next.splice(index, 1);
    setProgram(next);
  };

  const addProgramItem = () => {
    if (!editForm || !newProgramItem.trim()) return;
    setProgram([...editForm.program, newProgramItem.trim()]);
    setNewProgramItem('');
  };

  const handleConfirm = () => {
    if (!editForm) return;

    // B. 깨진 날짜를 조용히 저장하지 않는다.
    if (!editForm.date || !ISO_DATE.test(editForm.date)) {
      setSaveError(
        editForm.dateRaw
          ? `날짜 "${editForm.dateRaw}" 를 자동 해석하지 못했습니다. YYYY-MM-DD 형식으로 직접 입력해 주세요.`
          : '관람일을 YYYY-MM-DD 형식으로 입력해 주세요.'
      );
      return;
    }
    if (!editForm.title.trim()) {
      setSaveError('공연명을 입력해 주세요.');
      return;
    }
    if (editForm.time && !HHMM.test(editForm.time)) {
      setSaveError('시작 시각은 HH:MM 형식으로 입력해 주세요. (비워 두어도 됩니다)');
      return;
    }

    const composers = editForm.composers.length ? editForm.composers : extractComposers(editForm.program);

    const newConcert: Concert = {
      id: `${Date.now()}`,
      title: editForm.title.trim(),
      artist: editForm.artist.trim(),
      venue: editForm.venue.trim(),
      date: editForm.date,
      dateRaw: editForm.dateRaw || undefined,
      time: editForm.time || undefined,
      program: editForm.program,
      type: 'past',
      imageUrl: image || undefined,
      // F4. 하드코딩 제거 — program에서 뽑는다
      composer: composers[0],
      composers: composers.length ? composers : undefined,
      seatRaw: editForm.seatRaw || undefined,
      seat: (editForm.seatRaw || editForm.gradeRaw) ? editForm.seat : undefined,
      price: editForm.price ?? undefined,
      ocrConfidence: editForm.confidence,
    };

    onAddConcert(newConcert);
    setSuccess(true);
    setTimeout(() => {
      setSuccess(false);
      reset();
    }, 1600);
  };

  const fieldValue = (f: EditableField): string => {
    if (!editForm) return '';
    if (f === 'date') return editForm.date ?? '';
    if (f === 'time') return editForm.time ?? '';
    return String((editForm as any)[f] ?? '');
  };

  /**
   * 어떤 필드를 노랗게 강조할까.
   *
   * ⚠️ 모델 자기신고 confidence만 보면 **아무것도 노랗게 안 된다** — 실측에서
   *    139개 필드 중 130개가 0.9~1.0에 몰렸고 정답률과의 상관은 -0.042였다.
   *    그래서 세 신호를 OR로 묶는다:
   *      1) 자기신고 confidence < 0.8      (self-consistency 병합 시엔 '실행 간 일치율')
   *      2) 코드 파싱 실패 (날짜/좌석)      — 자기신고와 독립된 진짜 신호
   *      3) 값이 비어 있음                  — 검수가 필요하다는 가장 확실한 신호
   */
  const lowConf = (key: string) => {
    if (!editForm) return false;
    if ((editForm.confidence[key] ?? 0) < LOW_CONFIDENCE_THRESHOLD) return true;
    if (key === 'date' && !editForm.date) return true;
    if (key === 'seat' && editForm.seatRaw && editForm.seat.confidence === 0) return true;
    const f = FIELDS.find(x => x.confKey === key);
    if (f && !fieldValue(f.key).trim()) return true;
    return false;
  };

  const lowConfCount = editForm
    ? FIELDS.filter(f => lowConf(f.confKey)).length + (lowConf('program') && editForm.program.length ? 1 : 0)
    : 0;

  return (
    <div className="max-w-xl mx-auto space-y-8 animate-in zoom-in duration-300">
      <header className="text-center">
        <h2 className="text-3xl font-bold serif text-amber-500">티켓 아카이빙</h2>
        <p className="text-amber-100/40 mt-2">AI로 좌석·곡 정보와 해설까지 한 번에 아카이빙하세요.</p>
      </header>

      {apiKeyMissing && (
        <div className="flex gap-3 p-4 rounded-2xl bg-red-950/60 border border-red-800 text-red-100 text-sm">
          <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-400" />
          <div className="space-y-1">
            <p className="font-bold">Gemini API 키가 설정되지 않았습니다.</p>
            <p className="text-red-200/70 leading-relaxed text-xs">
              <code className="bg-black/40 px-1 rounded">app/.env.local</code> 에
              <code className="bg-black/40 px-1 rounded mx-1">GEMINI_API_KEY=발급받은키</code>
              를 넣고 <code className="bg-black/40 px-1 rounded">npm run dev</code> 를 다시 실행하세요.
            </p>
          </div>
        </div>
      )}

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
            <button onClick={reset} className="absolute top-4 right-4 p-2 bg-[#1a0f0a]/80 rounded-full text-white hover:bg-red-900 transition-colors"><X size={20} /></button>
            {loading && (
              <div className="absolute inset-0 bg-[#120a06]/70 backdrop-blur-md flex flex-col items-center justify-center z-20">
                <Loader2 className="animate-spin text-amber-500 mb-4" size={48} />
                <p className="text-amber-500 font-bold serif animate-pulse">AI가 티켓 판독 중...</p>
              </div>
            )}
          </div>

          {prepInfo && (
            <p className="text-[10px] text-amber-200/25 text-center font-mono">{prepInfo}</p>
          )}

          {error && (
            <div className="flex gap-3 p-4 rounded-2xl bg-red-950/60 border border-red-800 text-red-100 text-sm">
              <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-400" />
              <p className="whitespace-pre-wrap leading-relaxed">{error}</p>
            </div>
          )}

          {editForm && !loading && (
            <div className="bg-[#2d1b14] p-6 rounded-3xl border border-[#3e271c] space-y-6 animate-in slide-in-from-bottom duration-500 shadow-2xl">
              {lowConfCount > 0 && (
                <div className="flex items-center gap-2 text-[11px] text-amber-300/80 bg-amber-900/20 border border-amber-700/40 rounded-xl px-3 py-2">
                  <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                  <span>
                    AI 신뢰도가 낮은 <b>{lowConfCount}개</b> 항목을 노란 테두리로 표시했습니다. 이 부분만 확인하세요.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {FIELDS.map(f => {
                  const low = lowConf(f.confKey);
                  const conf = editForm.confidence[f.confKey] ?? 0;
                  return (
                    <div key={f.key} className="space-y-1">
                      <label className="text-[10px] font-bold text-amber-200/30 uppercase tracking-widest flex items-center justify-between">
                        <span>{f.label}</span>
                        <span className={low ? 'text-amber-400' : 'text-amber-200/20'}>
                          {Math.round(conf * 100)}%
                        </span>
                      </label>
                      <input
                        type="text"
                        value={fieldValue(f.key)}
                        placeholder={f.placeholder}
                        onChange={e => handleInputChange(f.key, f.confKey, e.target.value)}
                        className={`w-full bg-[#120a06] rounded-xl px-4 py-3 text-sm text-amber-50 outline-none transition-all border ${
                          low
                            ? 'border-amber-400 ring-1 ring-amber-400/40 focus:border-amber-300'
                            : 'border-[#3e271c] focus:border-amber-500'
                        }`}
                      />
                      {f.key === 'date' && editForm.dateRaw && (
                        <p className={`text-[10px] ${editForm.date ? 'text-amber-200/25' : 'text-red-400'}`}>
                          {editForm.date
                            ? `원문: "${editForm.dateRaw}"`
                            : `"${editForm.dateRaw}" 를 해석하지 못했습니다. 직접 입력해 주세요.`}
                        </p>
                      )}
                      {f.key === 'seatRaw' && (editForm.seatRaw || editForm.gradeRaw) && (
                        <p className="text-[10px] text-amber-200/30 flex items-center gap-1">
                          <Armchair size={10} className="text-amber-600" />
                          {seatSummary(editForm.seat) ?? '층/구역/열/번을 인식하지 못했습니다 (원문은 보존됩니다)'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-amber-200/30 uppercase tracking-widest flex items-center justify-between">
                  <span>Program List</span>
                  {editForm.program.length > 0 && (
                    <span className={lowConf('program') ? 'text-amber-400' : 'text-amber-200/20'}>
                      {Math.round((editForm.confidence.program ?? 0) * 100)}%
                    </span>
                  )}
                </label>
                <div className={`flex flex-wrap gap-2 rounded-xl ${lowConf('program') && editForm.program.length ? 'p-2 border border-amber-400 ring-1 ring-amber-400/30' : ''}`}>
                  {editForm.program.length === 0 && (
                    <span className="text-xs text-amber-200/25 italic">티켓에서 곡목을 찾지 못했습니다. 직접 추가할 수 있습니다.</span>
                  )}
                  {editForm.program.map((p, i) => (
                    <span key={`${p}-${i}`} className="px-3 py-1.5 bg-[#120a06] rounded-lg text-xs flex items-center gap-2 border border-[#3e271c] text-amber-100/70">
                      <Music size={10} className="text-amber-600" /> {p}
                      <button onClick={() => removeProgramItem(i)} className="hover:text-red-500 transition-colors"><X size={12} /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newProgramItem}
                    onChange={e => setNewProgramItem(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addProgramItem()}
                    placeholder="곡 추가: 예) Chopin - Ballade No.1 Op.23"
                    className="flex-1 bg-[#120a06] border border-[#3e271c] rounded-xl px-4 py-2.5 text-xs text-amber-50 focus:border-amber-500 outline-none transition-all placeholder:text-amber-200/15"
                  />
                  <button onClick={addProgramItem} className="px-3 bg-[#120a06] border border-[#3e271c] rounded-xl text-amber-500 hover:border-amber-500 transition-all"><Plus size={16} /></button>
                </div>
                {editForm.composers.length > 0 && (
                  <p className="text-[10px] text-amber-200/30">
                    추출된 작곡가: <span className="text-amber-500/70">{editForm.composers.join(', ')}</span>
                  </p>
                )}
              </div>

              {(enrichLoading || programNotes.length > 0 || enrichError) && (
                <div className="space-y-4 pt-6 border-t border-[#3e271c]">
                  <h4 className="text-amber-500 font-bold flex items-center gap-2 text-sm uppercase tracking-wider italic">
                    <BookOpen size={18} /> AI Generated Program Notes
                    {enrichLoading && (
                      <span className="flex items-center gap-1.5 text-[10px] font-medium normal-case not-italic text-amber-200/40">
                        <Loader2 size={12} className="animate-spin" /> 백그라운드 작성 중… (검수는 계속하셔도 됩니다)
                      </span>
                    )}
                  </h4>
                  {enrichError && (
                    <p className="text-[11px] text-red-300/80">프로그램 노트 생성 실패: {enrichError}</p>
                  )}
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
                          {note.recommendedRecording && <p><strong className="text-blue-800">Recommendation:</strong> {note.recommendedRecording}</p>}
                        </div>
                      </details>
                    ))}
                  </div>
                  {enrichSources.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {enrichSources.slice(0, 6).map((s, i) => (
                        <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2 py-1 bg-[#120a06] rounded text-[10px] text-amber-200/30 hover:text-amber-500 transition-colors">
                          <ExternalLink size={10} /> {s.title || 'Source'}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {saveError && (
                <div className="flex gap-2 p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-100 text-xs">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5 text-red-400" />
                  <p>{saveError}</p>
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

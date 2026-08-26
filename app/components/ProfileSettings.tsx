
import React, { useState } from 'react';
import { UserProfile, Era, Instrument } from '../types';
import { Save, Heart, MapPin, Plus, X, Music, Check, Settings2, RefreshCw, User } from 'lucide-react';
import AvatarMaker from './avatar/AvatarMaker';
import { loadAvatar } from '../services/storage';

interface ProfileSettingsProps {
  profile: UserProfile;
  onSave: (profile: UserProfile) => void;
}

const ProfileSettings: React.FC<ProfileSettingsProps> = ({ profile, onSave }) => {
  const [localProfile, setLocalProfile] = useState<UserProfile>(profile);
  const [newComposer, setNewComposer] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle');
  // 아바타는 프로필과 별도 키에 저장한다(App.tsx를 건드리지 않기 위해).
  const [avatarInit] = useState(() => loadAvatar());

  const toggleEra = (era: Era) => {
    setLocalProfile(prev => ({
      ...prev,
      preferredEras: prev.preferredEras.includes(era)
        ? prev.preferredEras.filter(e => e !== era)
        : [...prev.preferredEras, era]
    }));
  };

  const toggleInstrument = (inst: Instrument) => {
    setLocalProfile(prev => ({
      ...prev,
      preferredInstruments: prev.preferredInstruments.includes(inst)
        ? prev.preferredInstruments.filter(i => i !== inst)
        : [...prev.preferredInstruments, inst]
    }));
  };

  const addComposer = () => {
    if (newComposer.trim() && !localProfile.favoriteComposers.includes(newComposer.trim())) {
      setLocalProfile(prev => ({
        ...prev,
        favoriteComposers: [...prev.favoriteComposers, newComposer.trim()]
      }));
      setNewComposer('');
    }
  };

  const removeComposer = (name: string) => {
    setLocalProfile(prev => ({
      ...prev,
      favoriteComposers: prev.favoriteComposers.filter(c => c !== name)
    }));
  };

  const handleSave = () => {
    setSaveStatus('saving');
    onSave(localProfile);
    setTimeout(() => {
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 800);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-12 pb-24 animate-in fade-in duration-500">
      <header className="text-center">
        <div className="inline-flex p-3 bg-amber-600/10 rounded-full text-amber-500 mb-4 shadow-xl border border-amber-500/20">
          <Settings2 size={32} />
        </div>
        <h2 className="text-4xl font-bold serif text-amber-50">나의 취향 페르소나</h2>
        <p className="text-amber-100/40 mt-3 leading-relaxed italic">
          AI Agent가 당신의 음악적 취향을 학습하여<br/>
          서울의 수천 개 공연 중 가장 완벽한 무대를 엄선합니다.
        </p>
      </header>

      {/* 아바타 메이커 — 객석에 앉힐 나만의 캐릭터 */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 text-amber-500">
          <User size={22} />
          <h3 className="text-2xl font-bold serif">나의 관객 캐릭터</h3>
        </div>
        <AvatarMaker initial={avatarInit.config} loadWarnings={avatarInit.warnings} />
      </section>

      {/* Favorite Composers */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 text-amber-500">
          <Music size={22} />
          <h3 className="text-2xl font-bold serif">좋아하는 작곡가</h3>
        </div>
        <div className="bg-[#2d1b14] p-8 rounded-[32px] border border-[#3e271c] space-y-6 shadow-2xl">
          <div className="flex gap-3">
            <input 
              type="text" 
              value={newComposer}
              onChange={(e) => setNewComposer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addComposer()}
              className="flex-1 bg-[#120a06] border border-[#3e271c] rounded-2xl px-5 py-4 text-amber-50 focus:outline-none focus:border-amber-500 transition-all placeholder:text-amber-200/10"
              placeholder="예: Mahler, Brahms, 정재일..."
            />
            <button onClick={addComposer} className="p-4 bg-amber-600 text-[#1a0f0a] rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-xl border border-amber-400/20">
              <Plus size={24} />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {localProfile.favoriteComposers.map((comp) => (
              <span key={comp} className="flex items-center gap-2 px-4 py-2 bg-[#120a06] rounded-xl text-sm text-amber-100/70 border border-[#3e271c] group shadow-inner">
                {comp}
                <button onClick={() => removeComposer(comp)} className="text-amber-800 hover:text-red-500 transition-colors">
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Preferred Instruments */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 text-amber-400">
          <Music size={22} />
          <h3 className="text-2xl font-bold serif">선호 악기</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Object.values(Instrument).map((inst) => (
            <button
              key={inst}
              onClick={() => toggleInstrument(inst)}
              className={`py-4 px-6 rounded-2xl text-sm font-black border transition-all duration-300 ${
                localProfile.preferredInstruments.includes(inst) 
                ? 'bg-amber-600 border-amber-400 text-[#1a0f0a] shadow-xl shadow-amber-900/50' 
                : 'bg-[#120a06] border-[#3e271c] text-amber-200/20 hover:border-amber-700'
              }`}
            >
              {inst}
            </button>
          ))}
        </div>
      </section>

      {/* Save Button */}
      <div className="pt-8">
        <button 
          onClick={handleSave}
          disabled={saveStatus !== 'idle'}
          className={`w-full py-6 font-black text-xl rounded-[24px] flex items-center justify-center gap-3 transition-all shadow-2xl border border-amber-500/20 ${
            saveStatus === 'success' 
            ? 'bg-emerald-800 text-white' 
            : 'bg-amber-600 text-[#1a0f0a] hover:bg-amber-500 active:scale-95'
          }`}
        >
          {saveStatus === 'saving' ? <RefreshCw className="animate-spin" /> : 
           saveStatus === 'success' ? <Check /> : <Save />}
          {saveStatus === 'success' ? '업데이트 완료' : '시스템 취향 데이터 반영하기'}
        </button>
      </div>
    </div>
  );
};

export default ProfileSettings;

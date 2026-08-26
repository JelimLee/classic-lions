/**
 * AvatarMaker.tsx — 프리셋 조합형 픽셀아트 아바타 메이커
 *
 * 파트 8종(헤어45/눈12/입23/옷23/모자10/안경14/수염8/소품4) × 색상 8군.
 * 선택지는 전부 **실제로 렌더한 썸네일**로 보여준다(텍스트 목록 금지).
 * 저장은 localStorage — services/storage.ts 의 saveAvatar.
 */

import React, { useMemo, useState } from 'react';
import { Check, Dice5, RotateCcw, Save, AlertTriangle } from 'lucide-react';
import {
  AvatarConfig,
  DEFAULT_AVATAR,
  DEFAULT_PART_COLORS,
  PALETTES,
  PART_VARIANTS,
  OPTIONAL_PARTS,
  PartKey,
  avatarToCompactSvgString,
  randomAvatar,
  styleVersionMismatch,
} from './parts';
import { Avatar } from './Avatar';
import { saveAvatar } from '../../services/storage';

interface TabDef {
  key: PartKey;
  label: string;
  /** 이 파트와 함께 고를 색상 팔레트 (없으면 색상 선택 없음) */
  palette?: keyof typeof PALETTES;
  colorField?: keyof AvatarConfig;
}

const TABS: TabDef[] = [
  { key: 'hair', label: '헤어', palette: 'hair', colorField: 'hairColor' },
  { key: 'eyes', label: '눈', palette: 'eyes', colorField: 'eyesColor' },
  { key: 'mouth', label: '입', palette: 'mouth', colorField: 'mouthColor' },
  { key: 'clothes', label: '옷', palette: 'clothes', colorField: 'clothesColor' },
  { key: 'hat', label: '모자', palette: 'hat', colorField: 'hatColor' },
  { key: 'glasses', label: '안경', palette: 'glasses', colorField: 'glassesColor' },
  { key: 'beard', label: '수염' },
  { key: 'accessories', label: '소품', palette: 'accessories', colorField: 'accessoriesColor' },
];

const THUMB = 64; // 16의 4배 — 정수 배율만 쓴다(비정수면 픽셀 폭이 흔들린다)

interface ThumbProps {
  config: AvatarConfig;
  selected: boolean;
  label: string;
  onClick: () => void;
}

const Thumb: React.FC<ThumbProps> = ({ config, selected, label, onClick }) => {
  const svg = useMemo(() => avatarToCompactSvgString(config, THUMB), [config]);
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={`p-1.5 rounded-xl border transition-all ${
        selected
          ? 'bg-amber-600/20 border-amber-500 shadow-lg shadow-amber-900/40'
          : 'bg-[#120a06] border-[#3e271c] hover:border-amber-700'
      }`}
    >
      <span
        style={{ display: 'block', width: THUMB, height: THUMB, imageRendering: 'pixelated', lineHeight: 0 }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </button>
  );
};

const NoneThumb: React.FC<{ selected: boolean; onClick: () => void }> = ({ selected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title="없음"
    aria-label="없음"
    aria-pressed={selected}
    className={`rounded-xl border text-xs font-bold transition-all ${
      selected
        ? 'bg-amber-600/20 border-amber-500 text-amber-300'
        : 'bg-[#120a06] border-[#3e271c] text-amber-200/30 hover:border-amber-700'
    }`}
    style={{ width: THUMB + 12, height: THUMB + 12 }}
  >
    없음
  </button>
);

export interface AvatarMakerProps {
  initial: AvatarConfig;
  /** 저장 시점(또는 변경 시점)에 상위로 알려주고 싶을 때 */
  onChange?: (config: AvatarConfig) => void;
  /** 저장소에서 복원하며 발생한 경고 (버전 불일치 등) */
  loadWarnings?: string[];
}

export const AvatarMaker: React.FC<AvatarMakerProps> = ({ initial, onChange, loadWarnings = [] }) => {
  const [config, setConfigState] = useState<AvatarConfig>(initial);
  const [tab, setTab] = useState<PartKey>('hair');
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const setConfig = (next: AvatarConfig) => {
    setConfigState(next);
    setStatus('idle');
    onChange?.(next);
  };

  const active = TABS.find(t => t.key === tab)!;
  const isOptional = OPTIONAL_PARTS.includes(tab);
  const currentVariant = config[tab] as string | undefined;

  // 썸네일은 "현재 아바타에서 이 파트만 바꾼 모습" — 그래야 색·다른 파트가 반영된다
  const variantConfigs = useMemo(
    () => PART_VARIANTS[tab].map(v => ({ v, cfg: { ...config, [tab]: v } as AvatarConfig })),
    [tab, config],
  );

  const mismatch = styleVersionMismatch(config);

  const handleSave = () => {
    const outcome = saveAvatar(config);
    if (outcome.ok) {
      setStatus('saved');
      setErrorMsg(null);
      window.setTimeout(() => setStatus('idle'), 2000);
    } else {
      setStatus('error');
      setErrorMsg(outcome.message ?? '아바타를 저장하지 못했습니다.');
    }
  };

  return (
    <div className="space-y-6">
      {(loadWarnings.length > 0 || mismatch) && (
        <div className="flex gap-3 items-start bg-amber-900/20 border border-amber-700/40 rounded-2xl p-4 text-sm text-amber-200/80">
          <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            {mismatch && <p>아바타 스타일 버전이 바뀌었습니다 ({mismatch}). 다시 저장하면 현재 버전으로 갱신됩니다.</p>}
            {loadWarnings.map((w, i) => <p key={i}>{w}</p>)}
          </div>
        </div>
      )}

      {/* 큰 미리보기 */}
      <div className="bg-[#2d1b14] rounded-[32px] border border-[#3e271c] p-6 flex flex-col sm:flex-row items-center gap-6 shadow-2xl">
        <div className="bg-[#120a06] rounded-3xl border border-[#3e271c] p-4 shadow-inner">
          <Avatar config={config} size={128} />
        </div>
        <div className="flex-1 w-full space-y-3">
          <p className="text-amber-100/50 text-sm leading-relaxed">
            객석에 앉힐 나만의 캐릭터를 만듭니다. 16×16 픽셀아트 — 좌석 단면도에 그대로 앉습니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setConfig(randomAvatar())}
              className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-[#120a06] border border-[#3e271c] text-amber-200/70 hover:border-amber-600 hover:text-amber-300 transition-all text-sm font-bold"
            >
              <Dice5 size={18} /> 랜덤
            </button>
            <button
              type="button"
              onClick={() => setConfig({ ...DEFAULT_AVATAR })}
              className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-[#120a06] border border-[#3e271c] text-amber-200/70 hover:border-amber-600 hover:text-amber-300 transition-all text-sm font-bold"
            >
              <RotateCcw size={18} /> 초기화
            </button>
            <button
              type="button"
              onClick={handleSave}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-sm border transition-all ${
                status === 'saved'
                  ? 'bg-emerald-800 border-emerald-600 text-white'
                  : 'bg-amber-600 border-amber-400/30 text-[#1a0f0a] hover:bg-amber-500 active:scale-95'
              }`}
            >
              {status === 'saved' ? <Check size={18} /> : <Save size={18} />}
              {status === 'saved' ? '저장됨' : '아바타 저장'}
            </button>
          </div>
          {status === 'error' && errorMsg && (
            <p className="text-red-400 text-xs">{errorMsg}</p>
          )}
          {/* 피부색은 파트와 무관하게 항상 보이게 둔다 */}
          <div className="flex items-center gap-3 pt-1">
            <span className="text-xs text-amber-200/40 w-10 shrink-0">피부</span>
            <div className="flex flex-wrap gap-2">
              {PALETTES.skin.map(hex => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`피부색 ${hex}`}
                  onClick={() => setConfig({ ...config, skinColor: hex })}
                  className={`w-7 h-7 rounded-lg border-2 transition-transform ${
                    config.skinColor === hex ? 'border-amber-400 scale-110' : 'border-[#3e271c] hover:scale-105'
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 파트 탭 */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
              tab === t.key
                ? 'bg-amber-600 border-amber-400 text-[#1a0f0a]'
                : 'bg-[#120a06] border-[#3e271c] text-amber-200/40 hover:border-amber-700'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-[10px] opacity-60">{PART_VARIANTS[t.key].length}</span>
          </button>
        ))}
      </div>

      {/* 선택지 그리드 + 색상 */}
      <div className="bg-[#2d1b14] rounded-[32px] border border-[#3e271c] p-6 space-y-5 shadow-2xl">
        {active.palette && active.colorField && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-amber-200/40 w-10 shrink-0">색상</span>
            {PALETTES[active.palette].map(hex => {
              const cur = (config[active.colorField!] as string | undefined)
                ?? (DEFAULT_PART_COLORS as Record<string, string>)[active.palette!]
                ?? PALETTES[active.palette!][0];
              return (
                <button
                  key={hex}
                  type="button"
                  aria-label={`${active.label} 색상 ${hex}`}
                  onClick={() => setConfig({ ...config, [active.colorField!]: hex } as AvatarConfig)}
                  className={`w-7 h-7 rounded-lg border-2 transition-transform ${
                    cur === hex ? 'border-amber-400 scale-110' : 'border-[#3e271c] hover:scale-105'
                  }`}
                  style={{ backgroundColor: hex }}
                />
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {isOptional && (
            <NoneThumb
              selected={!currentVariant}
              onClick={() => {
                const next = { ...config };
                delete next[tab as 'hat' | 'glasses' | 'beard' | 'accessories'];
                setConfig(next);
              }}
            />
          )}
          {variantConfigs.map(({ v, cfg }) => (
            <Thumb
              key={v}
              config={cfg}
              label={`${active.label} ${v}`}
              selected={currentVariant === v}
              onClick={() => setConfig(cfg)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default AvatarMaker;

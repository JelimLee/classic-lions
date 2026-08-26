
import React from 'react';
import { AgentStep } from '../types';

interface AgentTimelineProps {
  steps: AgentStep[];
}

const AgentTimeline: React.FC<AgentTimelineProps> = ({ steps }) => {
  const totalMs = steps.reduce((sum, s) => sum + s.durationMs, 0);

  return (
    <div className="bg-[#120a06]/90 rounded-2xl p-4 border border-[#3e271c] mt-2 animate-in fade-in slide-in-from-top-2 duration-300 shadow-2xl backdrop-blur-md">
      <p className="text-[10px] text-amber-200/20 uppercase tracking-widest mb-4 flex justify-between items-center font-black">
        <span>Agent Reasoning Pipeline</span>
        <span className="text-amber-500 font-bold">{totalMs}ms</span>
      </p>
      
      <div className="space-y-4">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-4">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-600 shadow-[0_0_10px_rgba(217,119,6,0.5)] border border-amber-400/20" />
              {i < steps.length - 1 && <div className="w-0.5 h-10 bg-[#3e271c] mt-1" />}
            </div>

            <div className="flex-1 pb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-amber-100">{step.label}</span>
                <span className="text-[10px] text-amber-200/20">{step.durationMs}ms</span>
              </div>
              <p className="text-[11px] text-amber-100/40 line-clamp-2 leading-relaxed bg-[#1a0f0a]/60 p-2 rounded-lg border border-[#3e271c]/50 italic">
                {step.output}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex h-1.5 rounded-full overflow-hidden mt-4 bg-[#1a0f0a] border border-[#3e271c]/30 shadow-inner">
        {steps.map((step, i) => (
          <div
            key={i}
            style={{ width: `${(step.durationMs / totalMs) * 100}%` }}
            className={`${['bg-amber-900', 'bg-amber-700', 'bg-amber-600', 'bg-amber-500'][i % 4]}`}
            title={`${step.label}: ${step.durationMs}ms`}
          />
        ))}
      </div>
    </div>
  );
};

export default AgentTimeline;

import { useEffect, useRef } from 'react';
import type { AudioRecorder } from './AudioRecorder.ts';

/** Live input level, updated straight in the DOM every frame (no React renders). */
export function LevelMeter({ recorder, active }: { recorder: AudioRecorder; active: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      recorder.onLevel((level) => {
        const el = bar.current;
        if (!el) return;
        el.style.transform = `scaleX(${level})`;
        el.style.backgroundColor = level > 0.85 ? '#dc2626' : level > 0.6 ? '#d97706' : '#059669';
      }),
    [recorder],
  );
  return (
    <div className="flex items-center gap-2" aria-label="Microphone input level">
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div ref={bar} className="absolute inset-0 origin-left bg-emerald-600" style={{ transform: 'scaleX(0)' }} />
      </div>
      <span className="w-20 text-right text-[11px] text-slate-500">{active ? 'Sound level' : ''}</span>
    </div>
  );
}

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** A small "i" button that opens a plain-language explanation (click/tap; Escape or outside click closes). */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={root} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-5 items-center justify-center rounded-full border border-slate-300 bg-white font-serif text-[11px] font-bold text-slate-600 italic hover:border-accent-500 hover:text-accent-700"
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute top-7 left-0 z-30 w-72 max-w-[80vw] rounded-md border border-slate-200 bg-white p-3 text-xs leading-relaxed font-normal text-slate-700 normal-case shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}

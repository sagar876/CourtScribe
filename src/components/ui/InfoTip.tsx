import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * A small "i" that shows a plain-language explanation on hover.
 * Also opens on keyboard focus, and on tap for touch screens (which have no hover).
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setOpen(true);
  };
  // Short delay so the pointer can move from the icon into the explanation without it closing.
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => void (closeTimer.current && clearTimeout(closeTimer.current)), []);

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
    <span ref={root} className="relative inline-flex align-middle" onPointerEnter={(e) => e.pointerType === 'mouse' && show()} onPointerLeave={(e) => e.pointerType === 'mouse' && hide()}>
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={show}
        onBlur={hide}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-white font-serif text-[11px] font-bold text-slate-600 italic hover:border-accent-500 hover:text-accent-700"
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute top-7 left-0 z-30 w-72 max-w-[80vw] rounded-md border border-slate-200 bg-white p-3 text-xs leading-relaxed font-normal text-slate-700 normal-case shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}

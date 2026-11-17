import 'pdfjs-dist/web/pdf_viewer.css';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { memo, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button.tsx';
import { Icon } from '../../components/ui/Icon.tsx';

GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_SCALE = 0.4;
const MAX_SCALE = 3;

interface PageProps {
  pdf: PDFDocumentProxy;
  number: number;
  scale: number;
  baseWidth: number;
  baseHeight: number;
  query: string;
  root: HTMLElement | null;
  onVisible: (page: number) => void;
}

/** One page: rendered only while near the viewport, released when far away (long documents). */
const PdfPage = memo(function PdfPage({ pdf, number, scale, baseWidth, baseHeight, query, root, onVisible }: PageProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !root) return;
    const nearObs = new IntersectionObserver(([e]) => setNear(Boolean(e?.isIntersecting)), { root, rootMargin: '1200px 0px' });
    const currentObs = new IntersectionObserver(([e]) => e?.isIntersecting && onVisible(number), { root, threshold: 0.5 });
    nearObs.observe(el);
    currentObs.observe(el);
    return () => {
      nearObs.disconnect();
      currentObs.disconnect();
    };
  }, [root, number, onVisible]);

  useEffect(() => {
    const c = canvas.current;
    const tl = textLayer.current;
    if (!near || !c || !tl) {
      if (c) c.width = c.height = 0; // free the bitmap memory of far-away pages
      if (tl) tl.replaceChildren();
      return;
    }
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let text: TextLayer | null = null;
    void (async () => {
      const page = await pdf.getPage(number);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      const task = page.render({ canvas: c, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      renderTask = task;
      await task.promise.catch(() => {});
      if (cancelled) return;
      tl.replaceChildren();
      text = new TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport });
      await text.render().catch(() => {});
      if (cancelled || !query) return;
      const q = query.toLowerCase();
      for (const span of tl.querySelectorAll('span')) if (span.textContent?.toLowerCase().includes(q)) span.classList.add('cs-hit');
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      text?.cancel();
    };
  }, [near, pdf, number, scale, query]);

  return (
    <div
      ref={wrap}
      data-page={number}
      className="relative mx-auto bg-white shadow-sm ring-1 ring-slate-200"
      style={{ width: baseWidth * scale, height: baseHeight * scale, ['--scale-factor' as string]: scale, ['--user-unit' as string]: 1, ['--total-scale-factor' as string]: scale }}
      aria-label={`Page ${number}`}
      role="img"
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <div ref={textLayer} className="textLayer" />
    </div>
  );
});

export function PdfViewer({ url, name }: { url: string; name: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [size, setSize] = useState({ width: 595, height: 842 });
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(true);
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [hits, setHits] = useState<number[] | null>(null);
  const [hitIndex, setHitIndex] = useState(0);
  const [noText, setNoText] = useState(false);
  const pageTexts = useRef<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ url, withCredentials: false });
    task.promise.then(
      async (doc) => {
        if (cancelled) return;
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        setSize({ width: vp.width, height: vp.height });
        setPdf(doc);
        // Scanned PDFs have no text layer: check the first pages so the user knows search won't find anything.
        let chars = 0;
        for (let p = 1; p <= Math.min(3, doc.numPages); p++) chars += (await (await doc.getPage(p)).getTextContent()).items.length;
        if (!cancelled) setNoText(chars === 0);
      },
      (err: unknown) => {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : '';
        setError(name === 'InvalidPDFException' ? 'This file could not be opened as a PDF — it may be damaged.' : name === 'PasswordException' ? 'This PDF is password-protected and cannot be previewed here.' : 'The PDF could not be loaded. Check your connection and try again.');
      },
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  // Fit to width follows the viewer's width.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !fit) return;
    const apply = () => setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, (el.clientWidth - 48) / size.width)));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, size.width, pdf]);

  const onVisible = useCallback((page: number) => {
    setCurrent(page);
    setPageInput(String(page));
  }, []);

  const goTo = (page: number) => {
    if (!pdf) return;
    const p = Math.min(pdf.numPages, Math.max(1, page));
    scroller.current?.querySelector(`[data-page="${p}"]`)?.scrollIntoView({ block: 'start' });
  };

  const zoom = (delta: number) => {
    setFit(false);
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((s + delta) * 10) / 10)));
  };

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!pdf) return;
    const q = query.trim().toLowerCase();
    setActiveQuery(q);
    if (!q) return setHits(null);
    if (!pageTexts.current) {
      const texts: string[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const content = await (await pdf.getPage(p)).getTextContent();
        texts.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' ').toLowerCase());
      }
      pageTexts.current = texts;
      if (texts.every((t) => !t.trim())) setNoText(true);
    }
    const found = pageTexts.current.flatMap((t, i) => (t.includes(q) ? [i + 1] : []));
    setHits(found);
    setHitIndex(0);
    if (found[0]) goTo(found[0]);
  };

  const stepHit = (dir: 1 | -1) => {
    if (!hits?.length) return;
    const next = (hitIndex + dir + hits.length) % hits.length;
    setHitIndex(next);
    goTo(hits[next]!);
  };

  if (error)
    return (
      <p className="rounded-md bg-red-50 px-4 py-6 text-center text-sm text-red-800" role="alert">
        {error}
      </p>
    );

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center gap-1.5" role="group" aria-label="Pages">
          <Button size="sm" aria-label="Previous page" disabled={!pdf || current <= 1} onClick={() => goTo(current - 1)} icon={<Icon name="chevronUp" className="size-3.5" />} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              goTo(Number(pageInput));
            }}
            className="flex items-center gap-1.5 text-xs text-slate-700"
          >
            <label htmlFor="pdf-page" className="sr-only">
              Page number
            </label>
            <input id="pdf-page" value={pageInput} onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="tabular h-8 w-12 rounded-md border border-slate-300 text-center text-sm" />
            <span>of {pdf?.numPages ?? '…'}</span>
          </form>
          <Button size="sm" aria-label="Next page" disabled={!pdf || current >= (pdf?.numPages ?? 1)} onClick={() => goTo(current + 1)} icon={<Icon name="chevronDown" className="size-3.5" />} />
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="Zoom">
          <Button size="sm" aria-label="Zoom out" onClick={() => zoom(-0.1)}>
            −
          </Button>
          <span className="tabular w-12 text-center text-xs text-slate-700" aria-live="polite">
            {Math.round(scale * 100)}%
          </span>
          <Button size="sm" aria-label="Zoom in" onClick={() => zoom(0.1)}>
            +
          </Button>
          <Button size="sm" variant={fit ? 'primary' : 'secondary'} aria-pressed={fit} onClick={() => setFit(true)}>
            Fit width
          </Button>
        </div>
        <form onSubmit={(e) => void search(e)} className="flex min-w-[220px] flex-1 items-center gap-1.5">
          <label htmlFor="pdf-search" className="sr-only">
            Search in document
          </label>
          <input id="pdf-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search in this document" className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 px-2 text-sm" />
          <Button size="sm" type="submit" disabled={!pdf}>
            Search
          </Button>
          {hits && hits.length > 0 && (
            <>
              <Button size="sm" aria-label="Previous match" onClick={() => stepHit(-1)} icon={<Icon name="chevronUp" className="size-3.5" />} />
              <Button size="sm" aria-label="Next match" onClick={() => stepHit(1)} icon={<Icon name="chevronDown" className="size-3.5" />} />
            </>
          )}
          <span className="text-xs text-slate-600" aria-live="polite">
            {hits ? (hits.length ? `Page ${hits[hitIndex]} · ${hitIndex + 1} of ${hits.length} pages` : 'No matches') : ''}
          </span>
        </form>
      </div>
      {noText && (
        <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          This PDF has no searchable text — it is probably a scanned document. Text search needs OCR, which is not available in this prototype.
        </p>
      )}
      <div
        ref={(el) => {
          scroller.current = el;
          setScrollRoot(el);
        }}
        className="h-[70vh] overflow-auto bg-slate-100 p-6" aria-label={`Preview of ${name}`} tabIndex={0}>
        {!pdf ? (
          <p className="py-16 text-center text-sm text-slate-500" role="status">
            Loading document…
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {Array.from({ length: pdf.numPages }, (_, i) => (
              <PdfPage key={i + 1} pdf={pdf} number={i + 1} scale={scale} baseWidth={size.width} baseHeight={size.height} query={activeQuery} root={scrollRoot} onVisible={onVisible} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

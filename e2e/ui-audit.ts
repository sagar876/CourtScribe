/// <reference lib="dom" />
import type { Page } from '@playwright/test';

export interface AuditFinding {
  kind: 'h-overflow' | 'no-name' | 'contrast' | 'overflows-panel' | 'tiny-target';
  detail: string;
}

/** Runs inside the page: layout, naming and contrast checks for every visible control. */
export async function auditPage(page: Page): Promise<AuditFinding[]> {
  // Measure settled colours, not mid-transition ones.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation-play-state: paused !important; }' });
  return page.evaluate(() => {
    const findings: { kind: string; detail: string }[] = [];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    // Resolve any CSS colour (oklch, color-mix, …) to RGBA through the canvas.
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const over = (top: number[], a: number, under: number[]) => top.map((c, i) => c * a + under[i]! * (1 - a));
    // Painted background behind an element: composite ancestors' backgrounds from the root down.
    const background = (el: Element): number[] => {
      const chain: Element[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e);
      let bg = [255, 255, 255];
      for (const e of chain) {
        const [r, g, b, a] = rgba(getComputedStyle(e).backgroundColor);
        if (a > 0) bg = over([r, g, b], a, bg);
      }
      return bg;
    };
    const opacity = (el: Element) => {
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('.sr-only');
    };
    const label = (el: Element) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) || `<${el.tagName.toLowerCase()}>`;

    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) findings.push({ kind: 'h-overflow', detail: `page is ${document.documentElement.scrollWidth}px wide in a ${vw}px viewport` });
    // The app scrolls inside <main>; the document itself must never scroll behind it.
    const vh = document.documentElement.clientHeight;
    if (document.documentElement.scrollHeight > vh + 1) findings.push({ kind: 'h-overflow', detail: `document is ${document.documentElement.scrollHeight}px tall in a ${vh}px viewport (second scroll layer)` });

    const controls = [...document.querySelectorAll('button, a[href], select, input:not([type=hidden]):not(.sr-only), [role=radio]')].filter(visible);
    for (const el of controls) {
      const name = (el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).placeholder || el.getAttribute('title') || '').trim();
      const labelled = el.id && document.querySelector(`label[for="${el.id}"]`);
      if (!name && !labelled && !el.closest('label')) findings.push({ kind: 'no-name', detail: el.outerHTML.slice(0, 90) });

      // Contrast of the control's own text (skip icon-only controls).
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) || el.tagName === 'SELECT' ? el : [...el.querySelectorAll('*')].find((c) => [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()));
      if (text) {
        const cs = getComputedStyle(text);
        const [r, g, b, a] = rgba(cs.color);
        const bg = background(text);
        const fg = over([r, g, b], a * opacity(text), bg);
        const l1 = lum(fg), l2 = lum(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const disabled = (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true';
        const large = parseFloat(cs.fontSize) >= 18.66 || (parseFloat(cs.fontSize) >= 14 && Number(cs.fontWeight) >= 700);
        const need = disabled ? 3 : large ? 3 : 4.5;
        if (ratio < need) findings.push({ kind: 'contrast', detail: `${label(el)}${disabled ? ' (disabled)' : ''}: ${ratio.toFixed(2)}:1 < ${need}:1` });
      }
      const rr = el.getBoundingClientRect();
      if ((rr.height < 24 || rr.width < 24) && el.tagName !== 'A' && !el.closest('p')) findings.push({ kind: 'tiny-target', detail: `${label(el)} ${Math.round(rr.width)}×${Math.round(rr.height)}` });
    }

    // Anything sticking out of its card/section (clipped or overlapping a neighbour).
    for (const section of document.querySelectorAll('main section')) {
      const box = section.getBoundingClientRect();
      for (const el of section.querySelectorAll('*')) {
        if (!visible(el) || el.closest('[role=img], .overflow-auto, .overflow-x-auto, .overflow-hidden, [role=listbox]')) continue;
        const r = el.getBoundingClientRect();
        if (r.right > box.right + 1 || r.left < box.left - 1) {
          findings.push({ kind: 'overflows-panel', detail: `${label(el)} (${el.tagName.toLowerCase()}) in “${section.querySelector('h2')?.textContent ?? 'card'}” by ${Math.round(Math.max(r.right - box.right, box.left - r.left))}px` });
          break;
        }
      }
    }
    return findings as AuditFinding[];
  });
}

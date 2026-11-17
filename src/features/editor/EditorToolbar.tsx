import { useEditorState, type Editor } from '@tiptap/react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

function Tool({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the editor selection
      onClick={onClick}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-sm text-slate-700',
        active ? 'bg-navy-900 text-white' : 'enabled:hover:bg-slate-100',
        'disabled:cursor-not-allowed disabled:text-slate-300',
      )}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />;

export function EditorToolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      left: e.isActive({ textAlign: 'left' }),
      center: e.isActive({ textAlign: 'center' }),
      right: e.isActive({ textAlign: 'right' }),
      justify: e.isActive({ textAlign: 'justify' }),
      inTable: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatting" className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white px-2 py-1.5">
      <Tool label="Undo" disabled={!s.canUndo} onClick={() => c().undo().run()}>
        ↶
      </Tool>
      <Tool label="Redo" disabled={!s.canRedo} onClick={() => c().redo().run()}>
        ↷
      </Tool>
      <Sep />
      <Tool label="Bold" active={s.bold} onClick={() => c().toggleBold().run()}>
        <b>B</b>
      </Tool>
      <Tool label="Italic" active={s.italic} onClick={() => c().toggleItalic().run()}>
        <i className="font-serif">I</i>
      </Tool>
      <Tool label="Underline" active={s.underline} onClick={() => c().toggleUnderline().run()}>
        <u>U</u>
      </Tool>
      <Sep />
      <Tool label="Heading 1" active={s.h1} onClick={() => c().toggleHeading({ level: 1 }).run()}>
        H1
      </Tool>
      <Tool label="Heading 2" active={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}>
        H2
      </Tool>
      <Tool label="Heading 3" active={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}>
        H3
      </Tool>
      <Sep />
      <Tool label="Bulleted list" active={s.bullet} onClick={() => c().toggleBulletList().run()}>
        • ≡
      </Tool>
      <Tool label="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        1. ≡
      </Tool>
      <Sep />
      <Tool label="Align left" active={s.left} onClick={() => c().setTextAlign('left').run()}>
        ⇤
      </Tool>
      <Tool label="Align centre" active={s.center} onClick={() => c().setTextAlign('center').run()}>
        ↔
      </Tool>
      <Tool label="Align right" active={s.right} onClick={() => c().setTextAlign('right').run()}>
        ⇥
      </Tool>
      <Tool label="Justify" active={s.justify} onClick={() => c().setTextAlign('justify').run()}>
        ☰
      </Tool>
      <Sep />
      <Tool label="Insert table" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        ⊞ Table
      </Tool>
      {s.inTable && (
        <>
          <Tool label="Add row below" onClick={() => c().addRowAfter().run()}>
            + Row
          </Tool>
          <Tool label="Add column right" onClick={() => c().addColumnAfter().run()}>
            + Col
          </Tool>
          <Tool label="Delete row" onClick={() => c().deleteRow().run()}>
            − Row
          </Tool>
          <Tool label="Delete column" onClick={() => c().deleteColumn().run()}>
            − Col
          </Tool>
          <Tool label="Delete table" onClick={() => c().deleteTable().run()}>
            ✕ Table
          </Tool>
        </>
      )}
    </div>
  );
}

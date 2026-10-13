import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

export default function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  return <div className="action-menu" ref={root}>
    <button type="button" ref={trigger} className="icon-btn" title={label} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={18}/></button>
    <div className="action-menu-popover" role="group" aria-label={label} hidden={!open} onClick={e => {
      if ((e.target as HTMLElement).closest('button,a')) setOpen(false);
    }}>{children}</div>
  </div>;
}

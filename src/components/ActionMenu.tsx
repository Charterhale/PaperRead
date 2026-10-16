import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

export default function ActionMenu({ label, children, icon, onOpen, className = '', popupClassName = '' }: { label: string; children: ReactNode; icon?: ReactNode; onOpen?:()=>void; className?:string; popupClassName?:string }) {
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
  return <div className={'action-menu '+className} ref={root}>
    <button type="button" ref={trigger} className="icon-btn" title={label} aria-label={label} data-help={label==='工作台工具'?'文件夹、导出与备份':label==='提问示例'?'选择一个常用问题':undefined} aria-expanded={open} onClick={() => {if(!open)onOpen?.();setOpen(!open);}}>{icon||<MoreHorizontal size={18}/>}</button>
    <div className={'action-menu-popover '+popupClassName} role="group" aria-label={label} hidden={!open} onClick={e => {
      if ((e.target as HTMLElement).closest('button,a')) setOpen(false);
    }}>{children}</div>
  </div>;
}

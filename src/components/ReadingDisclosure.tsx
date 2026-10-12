import { useState, type ComponentProps } from 'react';
import { readLocal, writeLocal } from '../lib/storage';

type Props = Omit<ComponentProps<'details'>, 'open' | 'onToggle'> & {
  paperId: string;
  foldId: string;
  initiallyOpen?: boolean;
};

/** Native details remain compatible with PDF/outline jumps and keyboard navigation. */
export default function ReadingDisclosure({ paperId, foldId, initiallyOpen = false, children, ...props }: Props) {
  const storageKey = 'reader-folds-' + paperId;
  const [open, setOpen] = useState(() => readLocal<Record<string, boolean>>(storageKey, {})[foldId] ?? initiallyOpen);
  return <details {...props} open={open} onToggle={event => {
    const next = event.currentTarget.open;
    if (next === open) return;
    setOpen(next);
    writeLocal(storageKey, { ...readLocal<Record<string, boolean>>(storageKey, {}), [foldId]: next });
  }}>{children}</details>;
}

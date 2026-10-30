import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Card } from './primitives';
import { Icon } from '../Icon';

export function StatCard({
  label,
  icon,
  value,
  sub,
  tone = 'lime',
  delta,
  footer,
}: {
  label: string;
  icon: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'lime' | 'violet' | 'coral' | 'muted';
  delta?: { dir: 'up' | 'down'; text: string };
  footer?: ReactNode;
}) {
  const toneText: Record<string, string> = {
    lime: 'text-lime',
    violet: 'text-violet',
    coral: 'text-coral',
    muted: 'text-muted',
  };
  const toneBg: Record<string, string> = {
    lime: 'bg-lime/12',
    violet: 'bg-violet/12',
    coral: 'bg-coral/12',
    muted: 'bg-raised',
  };
  return (
    <Card className="flex flex-col justify-between gap-3">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
        <span className={cn('rounded-lg p-1.5', toneBg[tone], toneText[tone])}>
          <Icon name={icon} size={18} />
        </span>
      </div>
      <div>
        <div className={cn('font-display text-[30px] font-bold leading-tight tracking-tight nums', toneText[tone] && 'text-ink')}>
          {value}
        </div>
        {sub && <div className="mt-0.5 text-[13px] text-muted nums">{sub}</div>}
      </div>
      {footer ?? (delta && <DeltaRow delta={delta} />)}
    </Card>
  );
}

function DeltaRow({ delta }: { delta: { dir: 'up' | 'down'; text: string } }) {
  return (
    <div className={cn('flex items-center gap-1 text-[12px] font-semibold', delta.dir === 'up' ? 'text-lime' : 'text-coral')}>
      <span aria-hidden>{delta.dir === 'up' ? '▲' : '▼'}</span>
      <span>{delta.text}</span>
    </div>
  );
}

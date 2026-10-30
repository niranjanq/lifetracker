import { Flame, Check, Info, AlertTriangle, X } from 'lucide-react';
import { useApp } from '../state/store';
import { cn } from '../lib/cn';

export function ToastHost() {
  const { toasts, dismissToast } = useApp();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[80] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 shadow-card animate-slide-in',
            t.kind === 'error' && 'border-l-2 border-l-danger',
            t.kind === 'success' && 'border-l-2 border-l-lime',
            t.kind === 'roast' && 'border-l-2 border-l-coral',
            t.kind === 'info' && 'border-l-2 border-l-violet',
          )}
        >
          <span
            className={cn(
              'mt-0.5 shrink-0',
              t.kind === 'error' && 'text-danger',
              t.kind === 'success' && 'text-lime',
              t.kind === 'roast' && 'text-coral',
              t.kind === 'info' && 'text-violet',
            )}
          >
            {t.kind === 'roast' ? (
              <Flame size={18} />
            ) : t.kind === 'success' ? (
              <Check size={18} />
            ) : t.kind === 'error' ? (
              <AlertTriangle size={18} />
            ) : (
              <Info size={18} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            {t.title && <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t.title}</p>}
            <p className="text-sm text-ink">{t.message}</p>
          </div>
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-muted hover:text-ink">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

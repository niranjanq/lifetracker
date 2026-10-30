import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

/* ------------------------------- Card ------------------------------- */
export function Card({
  children,
  className,
  as: As = 'div',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <As
      className={cn(
        'glass rounded-card p-5 shadow-card animate-fade-up',
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}

export function CardTitle({ children, className, action }: { children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink">{children}</h3>
      {action}
    </div>
  );
}

/* ------------------------------ Button ------------------------------ */
type ButtonVariant = 'primary' | 'health' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-lime text-lime-on hover:bg-lime-fixed shadow-lime font-semibold',
  health: 'bg-coral text-coral-on hover:brightness-110 font-semibold',
  secondary: 'bg-raised/70 text-ink border border-line hover:bg-raised',
  ghost: 'bg-transparent text-muted hover:text-ink hover:bg-raised/60',
  danger: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full transition-all duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-0',
        size === 'sm' ? 'px-3 py-1.5 text-[13px]' : 'px-4 py-2 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ------------------------------- Inputs ----------------------------- */
const fieldBase =
  'w-full rounded-field bg-lowest/70 border border-line px-3 py-2 text-sm text-ink placeholder:text-muted/60 ' +
  'focus:border-lime/60 focus:outline-none focus:ring-2 focus:ring-lime/20 transition';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(fieldBase, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(fieldBase, 'resize-y', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(fieldBase, 'appearance-none pr-8', className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted/80">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/* -------------------------------- Chip ------------------------------ */
export function Chip({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'lime' | 'violet' | 'coral' | 'muted';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-raised/70 text-ink border-line',
    lime: 'bg-lime/12 text-lime border-lime/30',
    violet: 'bg-violet/12 text-violet border-violet/30',
    coral: 'bg-coral/12 text-coral border-coral/30',
    muted: 'bg-transparent text-muted border-line',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------ Progress ---------------------------- */
export function Progress({
  value,
  tone = 'lime',
  label,
}: {
  value: number; // 0..100+ (clamped for the bar)
  tone?: 'lime' | 'violet' | 'coral';
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const fills: Record<string, string> = {
    lime: 'bg-gradient-to-r from-lime-soft to-lime',
    violet: 'bg-gradient-to-r from-violet to-violet-soft',
    coral: 'bg-gradient-to-r from-coral-soft to-coral',
  };
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-lowest"
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'progress'}
    >
      <div className={cn('h-full rounded-full transition-all duration-500', fills[tone])} style={{ width: `${clamped}%` }} />
    </div>
  );
}

/* ------------------------------- Toggle ----------------------------- */
export function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-2 select-none">
      <span className="relative inline-block">
        <input
          id={inputId}
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={cn(
            'block h-6 w-11 rounded-full border transition-colors',
            checked ? 'border-lime/50 bg-lime/30' : 'border-line bg-raised',
          )}
        />
        <span
          className={cn(
            'pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-ink transition-transform',
            checked && 'translate-x-5 bg-lime',
          )}
        />
      </span>
      <span className="text-sm text-ink">{label}</span>
    </label>
  );
}

/* ----------------------------- Segmented ---------------------------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-full border border-line bg-lowest/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full px-3 py-1 text-[13px] font-medium transition-colors',
            value === o.value ? 'bg-lime text-lime-on' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- Modal ------------------------------ */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'glass relative z-10 w-full rounded-t-2xl p-5 shadow-card animate-scale-in sm:rounded-2xl sm:mx-4',
          width,
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="rounded-full p-1 text-muted hover:bg-raised hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------------------- ConfirmDialog ------------------------- */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{message}</div>
    </Modal>
  );
}

/* ---------------------------- EmptyState ---------------------------- */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line bg-lowest/40 px-6 py-10 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="font-display text-[15px] font-semibold text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* --------------------------- NumberCounter -------------------------- */
export function NumberCounter({ value, format }: { value: number; format: (n: number) => string }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const reduce =
      document.documentElement.classList.contains('reduce-motion') ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const dur = 650;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="nums">{format(display)}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-block h-4 w-4 animate-spin rounded-full border-2 border-lime/30 border-t-lime', className)}
      role="status"
      aria-label="Loading"
    />
  );
}

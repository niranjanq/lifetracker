import type { ReactNode } from 'react';

/** Shared shell for the login / verification / password screens. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-lime text-lg font-bold text-lime-on shadow-lime">◐</span>
            <span className="font-display text-lg font-semibold tracking-tight">Life Tracker</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="glass rounded-card p-6 shadow-card">{children}</div>
        {footer && <div className="mt-4 text-center text-[13px] text-muted">{footer}</div>}
      </div>
    </div>
  );
}

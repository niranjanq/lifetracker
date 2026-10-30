import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Plus, LogOut } from 'lucide-react';
import { NAV } from './nav';
import { MonthSelector } from './MonthSelector';
import { AssistantWidget } from './AssistantWidget';
import { Modal, Button } from '../ui/primitives';
import { TransactionForm } from '../forms/TransactionForm';
import { useApp } from '../../state/store';
import { useAuth } from '../../state/auth';
import { cn } from '../../lib/cn';

export function AppShell() {
  const { data } = useApp();
  const { user, logout } = useAuth();
  const [quickOpen, setQuickOpen] = useState(false);
  const name = data?.preferences.displayName?.trim();
  const serverMode = data?.meta.storageMode === 'server';

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col justify-between border-r border-line bg-surface/80 px-3 py-5 backdrop-blur-xl lg:flex">
        <div>
          <div className="mb-6 flex items-center gap-2 px-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-lime/15 text-lime shadow-lime">
              <span className="font-display text-lg font-extrabold">P</span>
            </span>
            <div className="leading-tight">
              <p className="font-display text-[15px] font-bold tracking-tight">Life Tracker</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-lime">Money · Health</p>
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => (
              <NavItem key={item.to} item={item} />
            ))}
          </nav>
        </div>
      </aside>

      {/* Topbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-lowest/70 px-4 py-3 backdrop-blur-xl lg:ml-64 lg:pl-8 lg:pr-6">
        <div className="flex items-center gap-3">
          <MonthSelector />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setQuickOpen(true)}>
            <Plus size={16} /> <span className="hidden sm:inline">Quick expense</span>
          </Button>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="text-right text-[13px] font-semibold text-ink">{name || user?.email || 'You'}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void logout()} title="Sign out" aria-label="Sign out">
            <LogOut size={16} />
          </Button>
        </div>
      </header>

      {/* Main */}
      <main className="px-4 pb-28 pt-4 lg:ml-64 lg:px-8 lg:pb-10">
        {serverMode && user && !user.emailVerified && (
          <div className="mx-auto mb-4 w-full max-w-[1600px] rounded-lg border border-coral/30 bg-coral/10 px-4 py-2.5 text-[13px] text-ink">
            Your email isn&rsquo;t verified yet — use the verification link we sent to sign in. In local development the message appears in Mailpit at{' '}
            <a href="http://localhost:8025" target="_blank" rel="noreferrer" className="font-semibold text-lime hover:underline">localhost:8025</a>.
          </div>
        )}
        <div className="mx-auto w-full max-w-[1600px]">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-line bg-surface/90 backdrop-blur-xl lg:hidden"
        aria-label="Primary"
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors',
                isActive ? 'text-lime' : 'text-muted',
              )
            }
          >
            <item.icon size={20} />
            {item.short}
          </NavLink>
        ))}
      </nav>

      <Modal open={quickOpen} onClose={() => setQuickOpen(false)} title="Quick add expense">
        <TransactionForm compact onDone={() => setQuickOpen(false)} />
      </Modal>

      {/* Floating read-only Assistant (all authenticated screens). */}
      <AssistantWidget />
    </div>
  );
}

function NavItem({ item }: { item: (typeof NAV)[number] }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all',
          isActive
            ? 'bg-lime/15 font-semibold text-lime shadow-lime'
            : 'text-muted hover:bg-raised hover:text-ink',
        )
      }
    >
      <item.icon size={18} className="transition-transform group-hover:scale-110" />
      {item.label}
    </NavLink>
  );
}

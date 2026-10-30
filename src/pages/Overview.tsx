import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardTitle, Progress, EmptyState, Chip } from '../components/ui/primitives';
import { StatCard } from '../components/ui/StatCard';
import { CategoryDonut, TrendBars } from '../components/charts/Charts';
import { useApp, computeFinanceSummary, toFinanceData } from '../state/store';
import { useAuth } from '../state/auth';
import { useMonth } from '../state/month';
import { useMoney } from '../state/useMoney';
import { addMonths, daysInMonth, formatDay, formatShortMonth, greetingForNow, firstNameForGreeting } from '../domain/date';
import { CAT } from '../domain/categories';
import { Flame, Plus, Activity } from 'lucide-react';

export function Overview() {
  const { data } = useApp();
  const { user } = useAuth();
  const { month } = useMonth();
  const { fmt, currency } = useMoney();

  const summary = useMemo(
    () => (data ? computeFinanceSummary(month, toFinanceData(data, month)) : null),
    [data, month],
  );
  const prevSummary = useMemo(() => {
    if (!data) return null;
    const pm = addMonths(month, -1);
    return computeFinanceSummary(pm, toFinanceData(data, pm));
  }, [data, month]);

  const trend = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: 6 }, (_, i) => addMonths(month, -(5 - i))).map((m) => {
      const s = computeFinanceSummary(m, toFinanceData(data, m));
      return { label: formatShortMonth(m), spendMinor: s.netSpendingMinor, savedMinor: s.savedOrInvestedMinor };
    });
  }, [data, month]);

  if (!data || !summary) return null;

  const catById = new Map(data.categories.map((c) => [c.id, c]));
  const donutData = summary.categorySpend
    .map((c) => ({ name: catById.get(c.categoryId)?.name ?? 'Other', valueMinor: c.netMinor }))
    .sort((a, b) => b.valueMinor - a.valueMinor);

  const allocationDonut = data.allocations
    .filter((a) => a.month === month && a.plannedMinor > 0)
    .map((a) => ({ name: a.label || catById.get(a.categoryId)?.name || 'Allocation', valueMinor: a.plannedMinor }));

  const monthTxns = data.transactions
    .filter((t) => t.month === month)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const recentTxns = monthTxns.slice(0, 6);

  const recentHealth = [...data.healthLogs]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 4);

  const spendDelta = prevSummary ? summary.netSpendingMinor - prevSummary.netSpendingMinor : 0;
  const today = new Date();
  const dayOfMonth = today.getMonth() + 1 === Number(month.slice(5, 7)) && today.getFullYear() === Number(month.slice(0, 4))
    ? today.getDate()
    : daysInMonth(month);
  const pacePct = summary.overallBudgetMinor > 0 ? Math.round((summary.netSpendingMinor / summary.overallBudgetMinor) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Hero */}
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-lime/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-40 h-56 w-56 rounded-full bg-violet/10 blur-3xl" />
        <div className="relative z-10 flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-lime">Money & health · monthly snapshot</span>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-[28px]">
            {greetingForNow()}, {firstNameForGreeting(data.preferences.displayName, user?.email)}.
          </h1>
          <p className="max-w-2xl text-sm text-muted">
            {summary.salaryReceivedMinor > 0
              ? `You've received ${fmt(summary.salaryReceivedMinor)} so far and spent ${fmt(summary.netSpendingMinor)} on ${formatShortMonth(month)} so far (${pacePct}% of budget, day ${dayOfMonth} of ${daysInMonth(month)}).`
              : `No salary recorded for ${formatShortMonth(month)} yet. Add income and spending to see your snapshot.`}
          </p>
        </div>
      </Card>

      {/* Financial cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Salary received" icon="Wallet" tone="lime" value={fmt(summary.salaryReceivedMinor)} sub={summary.expectedSalaryMinor !== summary.salaryReceivedMinor ? `Expected ${fmt(summary.expectedSalaryMinor)}` : 'Matches expectation'} />
        <StatCard label="Actual spending" icon="Receipt" tone="coral" value={fmt(summary.netSpendingMinor)} delta={prevSummary && spendDelta !== 0 ? { dir: spendDelta > 0 ? 'up' : 'down', text: `${spendDelta > 0 ? '+' : '−'}${fmt(Math.abs(spendDelta)).replace('-', '')} vs last mo` } : undefined} />
        <StatCard label="Budget remaining" icon="PiggyBank" tone={summary.remainingBudgetMinor < 0 ? 'coral' : 'lime'} value={fmt(summary.remainingBudgetMinor)} sub={summary.overallBudgetMinor > 0 ? `${pacePct}% of ${fmt(summary.overallBudgetMinor)}` : 'No budget set'} />
        <StatCard label="Saved / invested" icon="TrendingUp" tone="violet" value={fmt(summary.savedOrInvestedMinor)} sub={`Savings ${fmt(summary.savingsMinor)} · SIP ${fmt(summary.investmentMinor)}`} />
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Unallocated" icon="Coins" tone={summary.unallocatedMinor < 0 ? 'coral' : 'muted'} value={fmt(summary.unallocatedMinor)} sub={summary.oversubscribedMinor > 0 ? `Oversubscribed by ${fmt(summary.oversubscribedMinor)}` : 'Salary minus planned'} />
        <StatCard label="Other income" icon="Plus" tone="muted" value={fmt(summary.otherIncomeMinor)} sub="Non-salary income" />
        <StatCard label="Refunds received" icon="ArrowDown" tone="lime" value={fmt(summary.refundMinor)} sub="Offsets spending" />
        <StatCard label="Other transfers" icon="HeartHandshake" tone="muted" value={fmt(summary.otherTransfersMinor)} sub="Rent · family (not spending)" />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle action={<Link to="/money" className="text-[12px] font-semibold text-lime hover:underline">Manage →</Link>}>
            Spending by category
          </CardTitle>
          <CategoryDonut data={donutData} currency={currency} />
        </Card>

        <Card>
          <CardTitle>Salary allocation (planned)</CardTitle>
          {allocationDonut.length ? (
            <CategoryDonut data={allocationDonut} currency={currency} />
          ) : (
            <EmptyState title="No planned allocations yet" description="Add allocations in the Money hub to see your salary split." action={<Link to="/money"><Chip tone="lime">Plan allocations</Chip></Link>} />
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle>6-month spending & saving trend</CardTitle>
          <TrendBars data={trend} currency={currency} />
          <p className="mt-2 text-[12px] text-muted">Bar values are computed from your stored records. {data.meta.demoActive ? 'Includes clearly-labelled demo months.' : ''}</p>
        </Card>
      </div>

      {/* Budget utilization + recent activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Budget utilization</CardTitle>
          {summary.overallBudgetMinor > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-end justify-between">
                <span className="font-display text-2xl font-bold nums">{fmt(summary.netSpendingMinor)}</span>
                <span className="text-sm text-muted nums">of {fmt(summary.overallBudgetMinor)}</span>
              </div>
              <Progress value={pacePct} tone={pacePct >= 100 ? 'coral' : pacePct >= 90 ? 'coral' : 'lime'} label="Overall budget" />
              <div className="flex items-center justify-between text-[12px] text-muted">
                <span>{pacePct}% used · day {dayOfMonth}/{daysInMonth(month)}</span>
                {pacePct >= 75 && data.roastSettings.enabled && (
                  <Link to="/roast" className="inline-flex items-center gap-1 font-semibold text-coral">
                    <Flame size={14} /> Roast alerts on
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <EmptyState title="No monthly budget set" description="Set a variable-spending budget to track utilization." action={<Link to="/money"><Chip tone="lime">Set budget</Chip></Link>} />
          )}
        </Card>

        <Card>
          <CardTitle action={<Link to="/money" className="text-[12px] font-semibold text-lime hover:underline">All transactions →</Link>}>
            Recent transactions
          </CardTitle>
          {recentTxns.length ? (
            <ul className="divide-y divide-line">
              {recentTxns.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{t.description || catById.get(t.categoryId)?.name || 'Transaction'}</p>
                    <p className="text-[12px] text-muted">{formatDay(t.date)} · {catById.get(t.categoryId)?.name}</p>
                  </div>
                  <span className={'nums shrink-0 text-sm font-semibold ' + (t.kind === 'income' || t.kind === 'refund' ? 'text-lime' : t.kind === 'expense' ? 'text-ink' : 'text-violet')}>
                    {t.kind === 'expense' ? '−' : t.kind === 'refund' ? '+' : t.kind === 'income' ? '+' : ''}
                    {fmt(t.amountMinor)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No transactions this month" description="Quick-add an expense from the top bar." />
          )}
        </Card>
      </div>

      <Card>
        <CardTitle action={<Link to="/health" className="inline-flex items-center gap-1 text-[12px] font-semibold text-coral hover:underline"><Activity size={14} /> Health hub →</Link>}>
          Recent health logs
        </CardTitle>
        {recentHealth.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {recentHealth.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-lowest/40 px-3 py-2">
                <span className="text-sm text-ink">{formatDay(h.date)}</span>
                <span className="flex items-center gap-2">
                  <WellbeingDots level={h.wellbeing} />
                  {h.demo && <Chip tone="violet">demo</Chip>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No health entries yet" description="Log your first wellbeing note in the Health hub." />
        )}
      </Card>
    </div>
  );
}

function WellbeingDots({ level }: { level: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`Wellbeing ${level} of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={'h-1.5 w-1.5 rounded-full ' + (i < level ? 'bg-coral' : 'bg-raised')} />
      ))}
      <span className="ml-1 text-[12px] text-muted">{level}/5</span>
    </span>
  );
}

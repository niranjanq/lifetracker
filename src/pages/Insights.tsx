import { useMemo } from 'react';
import { Card, CardTitle, Chip, EmptyState, Button } from '../components/ui/primitives';
import { StatCard } from '../components/ui/StatCard';
import { TrendBars, CategoryDonut } from '../components/charts/Charts';
import { useApp, computeFinanceSummary, toFinanceData } from '../state/store';
import { useMonth } from '../state/month';
import { useMoney } from '../state/useMoney';
import { addMonths, formatShortMonth, formatYearMonth, monthRange, prevMonth } from '../domain/date';
import { toCSV, downloadText } from '../lib/csv';

export function Insights() {
  const { data } = useApp();
  const { month } = useMonth();
  const { fmt, currency } = useMoney();

  const months = useMemo(() => monthRange(addMonths(month, -5), month), [month]);
  const trend = useMemo(
    () =>
      months.map((m) => {
        const s = computeFinanceSummary(m, data ? toFinanceData(data, m) : emptyFinance());
        return { label: formatShortMonth(m), spendMinor: s.netSpendingMinor, savedMinor: s.savedOrInvestedMinor };
      }),
    [months, data],
  );

  if (!data) return null;

  const summary = computeFinanceSummary(month, toFinanceData(data, month));
  const prev = computeFinanceSummary(prevMonth(month), toFinanceData(data, prevMonth(month)));
  const catById = new Map(data.categories.map((c) => [c.id, c]));
  const donutData = summary.categorySpend
    .map((c) => ({ name: catById.get(c.categoryId)?.name ?? 'Other', valueMinor: c.netMinor }))
    .sort((a, b) => b.valueMinor - a.valueMinor);
  const top = donutData.slice(0, 3);

  const momDelta = summary.netSpendingMinor - prev.netSpendingMinor;
  const hasData = summary.grossSpendingMinor > 0;
  const sampleMonths = trend.filter((t) => t.spendMinor > 0).length;

  // Spending by day of week for the month (only where data supports it).
  const dow = useMemo(() => {
    const buckets = new Array(7).fill(0);
    for (const t of data.transactions) {
      if (t.month !== month || t.kind !== 'expense') continue;
      const [y, m, d] = t.date.split('-').map(Number);
      const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      buckets[day] += t.amountMinor;
    }
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return names.map((label, i) => ({ label, spendMinor: buckets[i] })).filter((r) => r.spendMinor > 0);
  }, [data, month]);

  // Health insights
  const healthCount = data.healthLogs.length;
  const symptomFreq = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of data.symptoms) map.set(s.name, (map.get(s.name) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [data]);

  function exportFinance() {
    const rows = months.map((m) => {
      const s = computeFinanceSummary(m, toFinanceData(data!, m));
      return [m, s.salaryReceivedMinor / 100, s.netSpendingMinor / 100, s.savedOrInvestedMinor / 100, s.overallBudgetMinor / 100, s.budgetUsagePct];
    });
    downloadText(`finance-insights-${month}.csv`, toCSV(['Month', 'Salary', 'Spending', 'Saved/Invested', 'Budget', 'Usage%'], rows));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Insights</h1>
          <p className="text-sm text-muted">All figures are computed from your stored records · {formatYearMonth(months[0])} – {formatYearMonth(month)}.</p>
        </div>
        <Button variant="secondary" onClick={exportFinance}>Export finance CSV</Button>
      </div>

      {!hasData ? (
        <Card>
          <EmptyState title="Not enough data for this month" description="Add transactions to unlock insights. We never fabricate numbers to fill a chart." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="Top category" icon="Receipt" tone="coral" value={top[0]?.name ?? '—'} sub={top[0] ? fmt(top[0].valueMinor) : undefined} />
            <StatCard label="Month-over-month" icon="TrendingUp" tone={momDelta > 0 ? 'coral' : 'lime'} value={`${momDelta > 0 ? '+' : '−'}${fmt(Math.abs(momDelta)).replace('-', '')}`} sub="spending vs last month" />
            <StatCard label="Savings rate" icon="PiggyBank" tone="violet" value={summary.salaryReceivedMinor > 0 ? `${Math.round((summary.savedOrInvestedMinor / summary.salaryReceivedMinor) * 100)}%` : '—'} sub="saved / salary" />
            <StatCard label="Avg monthly spend" icon="Coins" tone="muted" value={fmt(Math.round(trend.reduce((a, t) => a + t.spendMinor, 0) / Math.max(1, sampleMonths)))} sub={`over ${sampleMonths} month${sampleMonths === 1 ? '' : 's'} of data`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle>Spending by category</CardTitle>
              <CategoryDonut data={donutData} currency={currency} />
            </Card>
            <Card>
              <CardTitle>Planned vs actual (top allocations)</CardTitle>
              {(() => {
                const allocs = data.allocations.filter((a) => a.month === month);
                if (!allocs.length) return <EmptyState title="No allocations this month" />;
                return (
                  <ul className="flex flex-col gap-2">
                    {allocs.map((a) => {
                      const actual = data.transactions.filter((t) => t.month === month && t.categoryId === a.categoryId && t.kind !== 'income' && t.kind !== 'refund').reduce((s, t) => s + t.amountMinor, 0);
                      return (
                        <li key={a.id} className="flex items-center justify-between text-sm">
                          <span className="text-ink">{a.label}</span>
                          <span className="nums text-muted">planned {fmt(a.plannedMinor)} · actual {fmt(actual)}</span>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </Card>
            <Card className="lg:col-span-2">
              <CardTitle>Monthly spending trend</CardTitle>
              <TrendBars data={trend} currency={currency} />
              <p className="mt-2 text-[12px] text-muted">Sample: {sampleMonths} of {months.length} months have recorded spending.</p>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle>Spending by weekday</CardTitle>
              {dow.length ? (
                <TrendBars data={dow} currency={currency} height={200} />
              ) : (
                <EmptyState title="No expense days recorded" description="Add expenses to see the weekday pattern." />
              )}
            </Card>

            <Card>
              <CardTitle>Health insights</CardTitle>
              <p className="mb-2 text-[12px] text-muted">Descriptive only — no causal or diagnostic claims.</p>
              {healthCount === 0 ? (
                <EmptyState title="No health logs yet" />
              ) : symptomFreq.length ? (
                <>
                  <p className="mb-2 text-[12px] text-muted">Across {healthCount} log{healthCount === 1 ? '' : 's'}.</p>
                  <ul className="flex flex-col gap-2">
                    {symptomFreq.map(([name, count]) => (
                      <li key={name} className="flex items-center justify-between rounded-lg border border-line bg-lowest/40 px-3 py-2 text-sm">
                        <span className="text-ink">{name}</span>
                        <Chip tone="coral">{count}× reported</Chip>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState title="No symptoms recorded" description="You've logged days but no symptoms yet." />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function emptyFinance() {
  return { plans: [], salaryReceipts: [], allocations: [], transactions: [], budgets: [], categories: [] };
}

import { useMemo, useState } from 'react';
import { Card, CardTitle, Button, Chip, EmptyState, Modal, Field, Input, Select, Progress, ConfirmDialog } from '../components/ui/primitives';
import { TransactionForm } from '../components/forms/TransactionForm';
import { useApp, computeFinanceSummary, toFinanceData } from '../state/store';
import { useMonth } from '../state/month';
import { useMoney } from '../state/useMoney';
import { formatDay, formatYearMonth } from '../domain/date';
import { parseToMinor } from '../domain/money';
import { toCSV, downloadText } from '../lib/csv';
import { CAT } from '../domain/categories';
import type { Allocation, Budget, SalaryReceipt, Transaction, TransactionKind } from '../domain/types';

type Tab = 'transactions' | 'salary' | 'allocations' | 'budgets';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'transactions', label: 'Transactions' },
  { id: 'salary', label: 'Salary & income' },
  { id: 'allocations', label: 'Allocations' },
  { id: 'budgets', label: 'Budgets' },
];

const KIND_LABEL: Record<TransactionKind, string> = {
  income: 'Income', expense: 'Expense', transfer: 'Transfer', investment: 'Investment', refund: 'Refund',
};

export function Money() {
  const [tab, setTab] = useState<Tab>('transactions');
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Money</h1>
        <p className="text-sm text-muted">Manual finance tracking. Planned allocations are never counted as actual payments.</p>
      </div>
      <SummaryStrip />
      <div role="tablist" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={
              'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ' +
              (tab === t.id ? 'bg-lime text-lime-on' : 'border border-line bg-raised/50 text-muted hover:text-ink')
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'transactions' && <TransactionsTab />}
      {tab === 'salary' && <SalaryTab />}
      {tab === 'allocations' && <AllocationsTab />}
      {tab === 'budgets' && <BudgetsTab />}
    </div>
  );
}

function SummaryStrip() {
  const { data } = useApp();
  const { month } = useMonth();
  const { fmt } = useMoney();
  if (!data) return null;
  const s = computeFinanceSummary(month, toFinanceData(data, month));
  const items = [
    { label: 'Expected salary', value: fmt(s.expectedSalaryMinor) },
    { label: 'Received', value: fmt(s.salaryReceivedMinor) },
    { label: 'Planned total', value: fmt(s.plannedAllocationMinor) },
    { label: 'Unallocated', value: fmt(s.unallocatedMinor), tone: s.unallocatedMinor < 0 ? 'text-coral' : 'text-lime' },
    { label: 'Actual spending', value: fmt(s.netSpendingMinor) },
    { label: 'Saved / invested', value: fmt(s.savedOrInvestedMinor), tone: 'text-violet' },
  ];
  return (
    <Card className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((it) => (
        <div key={it.label}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{it.label}</p>
          <p className={'nums mt-1 font-display text-lg font-bold ' + (it.tone ?? 'text-ink')}>{it.value}</p>
        </div>
      ))}
    </Card>
  );
}

/* ----------------------------- Transactions ---------------------------- */
function TransactionsTab() {
  const { data, deleteTransaction } = useApp();
  const { month } = useMonth();
  const { fmt } = useMoney();
  const [q, setQ] = useState('');
  const [kindFilter, setKindFilter] = useState<'' | TransactionKind>('');
  const [catFilter, setCatFilter] = useState('');
  const [sort, setSort] = useState<'date-desc' | 'date-asc' | 'amount-desc'>('date-desc');
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const catById = useMemo(() => new Map((data?.categories ?? []).map((c) => [c.id, c])), [data]);

  const rows = useMemo(() => {
    let list = (data?.transactions ?? []).filter((t) => t.month === month);
    if (kindFilter) list = list.filter((t) => t.kind === kindFilter);
    if (catFilter) list = list.filter((t) => t.categoryId === catFilter);
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((t) =>
        [t.description, t.merchant, catById.get(t.categoryId)?.name, t.tags.join(' ')]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(needle)),
      );
    }
    list = [...list].sort((a, b) => {
      if (sort === 'amount-desc') return b.amountMinor - a.amountMinor;
      if (sort === 'date-asc') return a.date < b.date ? -1 : 1;
      return a.date < b.date ? 1 : -1;
    });
    return list;
  }, [data, month, kindFilter, catFilter, q, sort, catById]);

  const totals = rows.reduce(
    (acc, t) => {
      if (t.kind === 'expense') acc.spend += t.amountMinor;
      if (t.kind === 'income') acc.income += t.amountMinor;
      if (t.kind === 'transfer' || t.kind === 'investment') acc.move += t.amountMinor;
      if (t.kind === 'refund') acc.refund += t.amountMinor;
      return acc;
    },
    { spend: 0, income: 0, move: 0, refund: 0 },
  );

  function exportCSV() {
    const csv = toCSV(
      ['Date', 'Description', 'Category', 'Type', 'Amount', 'Tags', 'Source'],
      rows.map((t) => [
        t.date,
        t.description ?? '',
        catById.get(t.categoryId)?.name ?? '',
        KIND_LABEL[t.kind],
        (t.amountMinor / 100).toFixed(2),
        t.tags.join(' '),
        t.demo ? 'demo' : 'user',
      ]),
    );
    downloadText(`transactions-${month}.csv`, csv);
  }

  return (
    <Card>
      <CardTitle
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={exportCSV}>Export CSV</Button>
            <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>Add</Button>
          </div>
        }
      >
        Transactions · {formatYearMonth(month)}
      </CardTitle>

      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder="Search description, merchant, tag…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs flex-1" aria-label="Search transactions" />
        <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)} className="max-w-[150px]" aria-label="Filter by type">
          <option value="">All types</option>
          {(['expense', 'income', 'transfer', 'investment', 'refund'] as TransactionKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </Select>
        <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="max-w-[170px]" aria-label="Filter by category">
          <option value="">All categories</option>
          {(data?.categories ?? []).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="max-w-[150px]" aria-label="Sort">
          <option value="date-desc">Newest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="amount-desc">Largest amount</option>
        </Select>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
        <TotalPill label="Spending" value={fmt(totals.spend)} tone="coral" />
        <TotalPill label="Income" value={fmt(totals.income)} tone="lime" />
        <TotalPill label="Transfers + investing" value={fmt(totals.move)} tone="violet" />
        <TotalPill label="Refunds" value={fmt(totals.refund)} tone="lime" />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No transactions match" description="Adjust filters or add a transaction for this month." action={<Button variant="primary" onClick={() => setAddOpen(true)}>Add transaction</Button>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                <th className="py-2 pr-2 font-semibold">Date</th>
                <th className="py-2 pr-2 font-semibold">Description</th>
                <th className="py-2 pr-2 font-semibold">Category</th>
                <th className="py-2 pr-2 font-semibold">Type</th>
                <th className="py-2 pr-2 text-right font-semibold">Amount</th>
                <th className="py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-line/50 hover:bg-raised/40">
                  <td className="py-2 pr-2 whitespace-nowrap text-muted nums">{formatDay(t.date)}</td>
                  <td className="py-2 pr-2">
                    <span className="text-ink">{t.description || catById.get(t.categoryId)?.name || '—'}</span>
                    {t.demo && <Chip tone="violet" className="ml-2">demo</Chip>}
                    {t.tags.map((tag) => <Chip key={tag} tone="muted" className="ml-1">{tag}</Chip>)}
                  </td>
                  <td className="py-2 pr-2 text-muted">{catById.get(t.categoryId)?.name}</td>
                  <td className="py-2 pr-2"><KindChip kind={t.kind} /></td>
                  <td className={'py-2 pr-2 text-right font-semibold nums ' + (t.kind === 'expense' ? 'text-ink' : t.kind === 'income' || t.kind === 'refund' ? 'text-lime' : 'text-violet')}>
                    {t.kind === 'expense' ? '−' : t.kind === 'income' || t.kind === 'refund' ? '+' : ''}{fmt(t.amountMinor)}
                  </td>
                  <td className="py-2 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmId(t.id)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={addOpen || !!editing} onClose={() => { setAddOpen(false); setEditing(null); }} title={editing ? 'Edit transaction' : 'Add transaction'}>
        <TransactionForm initial={editing ?? undefined} onDone={() => { setAddOpen(false); setEditing(null); }} />
      </Modal>
      <ConfirmDialog
        open={!!confirmId}
        title="Delete transaction?"
        message="This permanently removes the record from local storage. Summaries will update."
        confirmLabel="Delete"
        onCancel={() => setConfirmId(null)}
        onConfirm={() => { if (confirmId) void deleteTransaction(confirmId); setConfirmId(null); }}
      />
    </Card>
  );
}

function TotalPill({ label, value, tone }: { label: string; value: string; tone: 'lime' | 'coral' | 'violet' }) {
  const t = { lime: 'text-lime', coral: 'text-coral', violet: 'text-violet' }[tone];
  return (
    <div className="rounded-lg border border-line bg-lowest/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={'nums text-sm font-bold ' + t}>{value}</p>
    </div>
  );
}

function KindChip({ kind }: { kind: TransactionKind }) {
  const tone = kind === 'expense' ? 'coral' : kind === 'income' || kind === 'refund' ? 'lime' : 'violet';
  return <Chip tone={tone as 'lime' | 'coral' | 'violet'}>{KIND_LABEL[kind]}</Chip>;
}

/* -------------------------------- Salary ------------------------------- */
function SalaryTab() {
  const { data, upsertSalaryReceipt, deleteSalaryReceipt } = useApp();
  const { month } = useMonth();
  const { fmt } = useMoney();
  const [form, setForm] = useState({ amount: '', date: '', source: '', note: '' });
  const [editing, setEditing] = useState<SalaryReceipt | null>(null);
  const rows = (data?.salaryReceipts ?? []).filter((s) => s.month === month).sort((a, b) => (a.date < b.date ? 1 : -1));

  function startEdit(s: SalaryReceipt) {
    setEditing(s);
    setForm({ amount: (s.amountMinor / 100).toString(), date: s.date, source: s.source ?? '', note: s.note ?? '' });
  }
  function submit() {
    const amountMinor = parseToMinor(form.amount || '0', data?.preferences.currency ?? 'INR');
    if (!Number.isFinite(amountMinor) || amountMinor <= 0 || !form.date) return;
    void upsertSalaryReceipt({ id: editing?.id, createdAt: editing?.createdAt, month, amountMinor, date: form.date, source: form.source || undefined, note: form.note || undefined });
    setForm({ amount: '', date: '', source: '', note: '' });
    setEditing(null);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardTitle>{editing ? 'Edit salary receipt' : 'Record salary received'}</CardTitle>
        <div className="flex flex-col gap-3">
          <Field label="Amount received" htmlFor="sal-amt"><Input id="sal-amt" inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="40000" /></Field>
          <Field label="Receipt date" htmlFor="sal-date"><Input id="sal-date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
          <Field label="Source (optional)" htmlFor="sal-src"><Input id="sal-src" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} /></Field>
          <Field label="Note (optional)" htmlFor="sal-note"><Input id="sal-note" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></Field>
          <div className="flex justify-end gap-2">
            {editing && <Button variant="ghost" onClick={() => { setEditing(null); setForm({ amount: '', date: '', source: '', note: '' }); }}>Cancel</Button>}
            <Button variant="primary" onClick={submit}>{editing ? 'Save changes' : 'Add receipt'}</Button>
          </div>
        </div>
      </Card>
      <Card>
        <CardTitle>Salary receipts · {formatYearMonth(month)}</CardTitle>
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="text-sm text-ink">{s.source || 'Salary'}</p>
                  <p className="text-[12px] text-muted">{formatDay(s.date)}{s.note ? ` · ${s.note}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="nums font-semibold text-lime">{fmt(s.amountMinor)}</span>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(s)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => void deleteSalaryReceipt(s.id)}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No salary recorded" description="Add your actual salary received for this month." />
        )}
      </Card>
    </div>
  );
}

/* ----------------------------- Allocations ----------------------------- */
function AllocationsTab() {
  const { data, upsertAllocation, deleteAllocation } = useApp();
  const { month } = useMonth();
  const { fmt } = useMoney();
  const [form, setForm] = useState<{ label: string; categoryId: string; amount: string }>({ label: '', categoryId: CAT.rent, amount: '' });
  if (!data) return null;
  const rows = data.allocations.filter((a) => a.month === month);
  const txByCat = (catId: string) =>
    data.transactions.filter((t) => t.month === month && t.categoryId === catId && (t.kind === 'transfer' || t.kind === 'investment' || t.kind === 'expense'))
      .reduce((sum, t) => sum + t.amountMinor, 0);

  function add() {
    const amountMinor = parseToMinor(form.amount || '0', data!.preferences.currency);
    if (!form.label || !Number.isFinite(amountMinor) || amountMinor <= 0) return;
    void upsertAllocation({ month, categoryId: form.categoryId, label: form.label, plannedMinor: amountMinor });
    setForm({ label: '', categoryId: form.categoryId, amount: '' });
  }

  return (
    <Card>
      <CardTitle>Planned monthly allocations · {formatYearMonth(month)}</CardTitle>
      <p className="mb-3 text-[12px] text-muted">A plan is not a payment. Actual vs planned updates automatically from your transactions.</p>
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Label (e.g. Room rent)" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} className="max-w-[200px]" aria-label="Allocation label" />
        <Select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} className="max-w-[180px]" aria-label="Allocation category">
          {data.categories.filter((c) => c.defaultKind !== 'income').map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </Select>
        <Input placeholder="Amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="max-w-[120px]" aria-label="Allocation amount" />
        <Button variant="primary" onClick={add}>Add</Button>
      </div>
      {rows.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((a: Allocation) => {
            const actual = txByCat(a.categoryId);
            return (
              <div key={a.id} className="rounded-lg border border-line bg-lowest/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">{a.label}</span>
                  <Button size="sm" variant="ghost" onClick={() => void deleteAllocation(a.id)}>Remove</Button>
                </div>
                <div className="mt-1 flex items-center justify-between text-[12px] text-muted nums">
                  <span>Planned {fmt(a.plannedMinor)}</span>
                  <span>Actual {fmt(actual)}</span>
                </div>
                <div className="mt-2"><Progress value={a.plannedMinor > 0 ? (actual / a.plannedMinor) * 100 : 0} tone={actual > a.plannedMinor ? 'coral' : 'lime'} label={`${a.label} progress`} /></div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No allocations planned" description="Plan rent, SIP, family, savings and variable spending." />
      )}
    </Card>
  );
}

/* ------------------------------- Budgets ------------------------------- */
function BudgetsTab() {
  const { data, upsertBudget, deleteBudget } = useApp();
  const { month } = useMonth();
  const { fmt } = useMoney();
  const [overall, setOverall] = useState('');
  const [catForm, setCatForm] = useState<{ categoryId: string; amount: string }>({ categoryId: CAT.shopping, amount: '' });
  if (!data) return null;
  const s = computeFinanceSummary(month, toFinanceData(data, month));
  const overallBudget = data.budgets.find((b) => b.month === month && b.categoryId === null);
  const catBudgets = data.budgets.filter((b) => b.month === month && b.categoryId);

  function saveOverall() {
    const limitMinor = parseToMinor(overall || '0', data!.preferences.currency);
    if (!Number.isFinite(limitMinor) || limitMinor <= 0) return;
    void upsertBudget({ id: overallBudget?.id, month, categoryId: null, limitMinor, createdAt: overallBudget?.createdAt });
  }

  function saveCat() {
    const limitMinor = parseToMinor(catForm.amount || '0', data!.preferences.currency);
    if (!Number.isFinite(limitMinor) || limitMinor <= 0) return;
    const existing = catBudgets.find((b) => b.categoryId === catForm.categoryId);
    void upsertBudget({ id: existing?.id, month, categoryId: catForm.categoryId, limitMinor, createdAt: existing?.createdAt });
    setCatForm((c) => ({ ...c, amount: '' }));
  }

  const usage = s.overallBudgetMinor > 0 ? (s.netSpendingMinor / s.overallBudgetMinor) * 100 : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Overall variable-spending budget</CardTitle>
        {overallBudget ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-end justify-between">
              <span className="font-display text-2xl font-bold nums">{fmt(s.netSpendingMinor)}</span>
              <span className="text-sm text-muted nums">of {fmt(s.overallBudgetMinor)}</span>
            </div>
            <Progress value={usage} tone={usage >= 100 ? 'coral' : 'lime'} label="Overall budget" />
            <div className="flex items-center justify-between text-[12px] text-muted">
              <span>{Math.round(usage)}% used · remaining {fmt(s.remainingBudgetMinor)}</span>
              <span>Roast at {data.roastSettings.thresholds.join('% / ')}%</span>
            </div>
            <div className="flex gap-2">
              <Input inputMode="decimal" defaultValue={(overallBudget.limitMinor / 100).toString()} onChange={(e) => setOverall(e.target.value)} aria-label="Budget amount" />
              <Button variant="primary" onClick={saveOverall}>Update</Button>
              <Button variant="danger" onClick={() => void deleteBudget(overallBudget.id)}>Clear</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <EmptyState title="No budget set" description="Set your monthly variable-spending limit." />
            <div className="flex gap-2">
              <Input inputMode="decimal" placeholder="15000" value={overall} onChange={(e) => setOverall(e.target.value)} aria-label="Budget amount" />
              <Button variant="primary" onClick={saveOverall}>Set budget</Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Category budgets</CardTitle>
        <div className="mb-3 flex flex-wrap gap-2">
          <Select value={catForm.categoryId} onChange={(e) => setCatForm((c) => ({ ...c, categoryId: e.target.value }))} className="max-w-[180px]" aria-label="Category">
            {data.categories.filter((c) => c.defaultKind === 'expense').map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </Select>
          <Input placeholder="Limit" inputMode="decimal" value={catForm.amount} onChange={(e) => setCatForm((c) => ({ ...c, amount: e.target.value }))} className="max-w-[120px]" aria-label="Limit amount" />
          <Button variant="primary" onClick={saveCat}>Add</Button>
        </div>
        {catBudgets.length ? (
          <ul className="flex flex-col gap-2">
            {catBudgets.map((b: Budget) => {
              const spent = s.categorySpend.find((c) => c.categoryId === b.categoryId)?.netMinor ?? 0;
              const pct = b.limitMinor > 0 ? (spent / b.limitMinor) * 100 : 0;
              return (
                <li key={b.id} className="rounded-lg border border-line bg-lowest/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ink">{data.categories.find((c) => c.id === b.categoryId)?.name}</span>
                    <span className="nums text-[12px] text-muted">{fmt(spent)} / {fmt(b.limitMinor)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1"><Progress value={pct} tone={pct >= 100 ? 'coral' : 'lime'} label="Category budget" /></div>
                    <Button size="sm" variant="ghost" onClick={() => void deleteBudget(b.id)}>Remove</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No category budgets" description="Set limits for shopping, entertainment and more." />
        )}
      </Card>
    </div>
  );
}

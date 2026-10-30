import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';
import { formatMoney } from '../../domain/money';
import type { CurrencyCode } from '../../domain/types';

const PALETTE = ['#B7F774', '#9B8AFB', '#FF9EAE', '#8FE35D', '#b090ff', '#ffd166', '#34d399', '#94a3b8'];

const tooltipStyle = {
  background: '#101827',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
  color: '#F2F5FC',
  fontSize: 12,
};

// Recharts renders the tooltip rows via itemStyle/labelStyle, NOT contentStyle
// color — set them explicitly or the text is near-invisible on the dark panel.
const tooltipItemStyle = { color: '#F2F5FC', fontSize: 12 };
const tooltipLabelStyle = { color: '#F2F5FC', fontSize: 12, marginBottom: 4 };

export function CategoryDonut({
  data,
  currency,
}: {
  data: Array<{ name: string; valueMinor: number }>;
  currency: CurrencyCode;
}) {
  const rows = data.filter((d) => d.valueMinor > 0);
  if (rows.length === 0) {
    return <p className="grid h-[220px] place-items-center text-sm text-muted">No spending yet this month.</p>;
  }
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={rows} dataKey="valueMinor" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2} stroke="none">
            {rows.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={tooltipStyle}
            itemStyle={tooltipItemStyle}
            labelStyle={tooltipLabelStyle}
            formatter={(v: number) => formatMoney(v, currency)}
          />
        </PieChart>
      </ResponsiveContainer>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {rows.slice(0, 6).map((d, i) => (
          <li key={d.name} className="flex items-center gap-1.5 text-[12px] text-muted">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} aria-hidden />
            {d.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrendBars({
  data,
  currency,
  height = 220,
}: {
  data: Array<{ label: string; spendMinor: number; savedMinor?: number }>;
  currency: CurrencyCode;
  height?: number;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: '#9AA8BD', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: '#9AA8BD', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatMoney(v, currency, { decimals: false })}
            width={64}
          />
          <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => formatMoney(v, currency)} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="spendMinor" name="Spending" fill="#B7F774" radius={[6, 6, 0, 0]} maxBarSize={34} />
          {data.some((d) => d.savedMinor !== undefined) && (
            <Bar dataKey="savedMinor" name="Saved / invested" fill="#9B8AFB" radius={[6, 6, 0, 0]} maxBarSize={34} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

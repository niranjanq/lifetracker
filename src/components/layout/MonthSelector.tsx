import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { useMonth } from '../../state/month';
import { addMonths, currentYearMonth, formatYearMonth } from '../../domain/date';

export function MonthSelector() {
  const { month, setMonth } = useMonth();
  const isCurrent = month === currentYearMonth();
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-line bg-lowest/60 px-1.5 py-1">
      <button
        onClick={() => setMonth(addMonths(month, -1))}
        aria-label="Previous month"
        className="rounded-full p-1 text-muted hover:bg-raised hover:text-ink"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="flex items-center gap-1.5 px-2 text-[13px] font-semibold text-ink">
        <Calendar size={15} className="text-lime" />
        {formatYearMonth(month)}
      </span>
      <button
        onClick={() => setMonth(addMonths(month, 1))}
        disabled={month >= currentYearMonth()}
        aria-label="Next month"
        className="rounded-full p-1 text-muted hover:bg-raised hover:text-ink disabled:opacity-30"
      >
        <ChevronRight size={16} />
      </button>
      {!isCurrent && (
        <button
          onClick={() => setMonth(currentYearMonth())}
          className="ml-1 rounded-full bg-raised px-2 py-0.5 text-[11px] font-semibold text-lime hover:bg-raised/70"
        >
          Today
        </button>
      )}
    </div>
  );
}

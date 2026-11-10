import { Link, useLocation } from 'react-router-dom';
import { NAV } from './nav';

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const current = NAV.find((item) => item.to === pathname);

  if (!current) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-xs text-muted">
      <ol className="flex items-center gap-2">
        <li><Link to="/" className="transition-colors hover:text-lime">Home</Link></li>
        {current.to !== '/' && (
          <>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="font-semibold text-ink">{current.label}</li>
          </>
        )}
      </ol>
    </nav>
  );
}

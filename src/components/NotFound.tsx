import { Link } from 'react-router-dom';
import { ArrowLeft, Home } from 'lucide-react';
import { Button } from './ui/primitives';

export function NotFound() {
  return (
    <main className="grid min-h-[70vh] place-items-center px-6 py-12">
      <section className="glass w-full max-w-lg rounded-card p-8 text-center" aria-labelledby="not-found-title">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-lime">Error 404</p>
        <h1 id="not-found-title" className="font-display text-3xl font-bold tracking-tight">This page doesn’t exist</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm text-muted">The link may be outdated, or the page may have moved. Your account and saved data are unaffected.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="primary" onClick={() => window.history.back()}><ArrowLeft size={16} /> Go back</Button>
          <Link to="/"><Button variant="secondary"><Home size={16} /> Overview</Button></Link>
        </div>
      </section>
    </main>
  );
}

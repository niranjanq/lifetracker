import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const PAGE_META: Record<string, { title: string; description: string }> = {
  '/': { title: 'Overview', description: 'Your private monthly snapshot of income, spending, budgets and health activity.' },
  '/money': { title: 'Money', description: 'Review your private income, budgets, allocations and transactions.' },
  '/health': { title: 'Health', description: 'Review your private health logs and personal wellbeing trends.' },
  '/roast': { title: 'Wallet Roast Mode', description: 'Review spending accountability and budget thresholds.' },
  '/insights': { title: 'Insights', description: 'Explore private summaries and trends from your own records.' },
  '/assistant': { title: 'Assistant', description: 'Ask questions about your own records in a private assistant workspace.' },
  '/settings': { title: 'Settings', description: 'Manage your Life Tracker preferences, privacy and account settings.' },
  '/login': { title: 'Sign in', description: 'Sign in to your private Life Tracker account.' },
  '/check-email': { title: 'Verify your email', description: 'Complete email verification for your Life Tracker account.' },
  '/forgot-password': { title: 'Forgot password', description: 'Request a password reset for your Life Tracker account.' },
  '/reset-password': { title: 'Reset password', description: 'Set a new password for your Life Tracker account.' },
};

function upsertMeta(selector: string, attribute: string, value: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    const [key, name] = attribute.split('=');
    element.setAttribute(key, name.replaceAll('"', ''));
    document.head.appendChild(element);
  }
  element.content = value;
}

export function Seo() {
  const { pathname } = useLocation();

  useEffect(() => {
    const page = PAGE_META[pathname];
    const title = page ? `${page.title} | Life Tracker` : 'Page not found | Life Tracker';
    document.title = title;
    upsertMeta('meta[name="description"]', 'name="description"', page?.description ?? 'The requested Life Tracker page could not be found.');
    upsertMeta('meta[name="robots"]', 'name="robots"', 'noindex, nofollow, noarchive');

    const siteUrl = import.meta.env.VITE_SITE_URL?.replace(/\/+$/, '');
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (siteUrl) {
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.appendChild(canonical);
      }
      canonical.href = `${siteUrl}${pathname}`;
    } else {
      canonical?.remove();
    }

    return () => {
      // The next route owns the document metadata; no stale route tags are retained.
    };
  }, [pathname]);

  return null;
}

import { describe, it, expect } from 'vitest';
import { NAV } from './nav';

describe('primary navigation', () => {
  it('includes the Assistant entry for every authenticated user', () => {
    const assistant = NAV.find((n) => n.to === '/assistant');
    expect(assistant).toBeDefined();
    expect(assistant?.label).toBe('Assistant');
    expect(assistant?.short).toBe('Assistant');
    // An icon component must be attached (never hidden behind provider config).
    // Lucide icons are forwardRef components, which can be functions or objects.
    expect(assistant?.icon).toBeTruthy();
  });

  it('keeps all pre-existing destinations', () => {
    const routes = NAV.map((n) => n.to);
    expect(routes).toEqual(expect.arrayContaining(['/', '/money', '/health', '/roast', '/insights', '/settings']));
  });

  it('has no duplicate routes', () => {
    const routes = NAV.map((n) => n.to);
    expect(new Set(routes).size).toBe(routes.length);
  });
});

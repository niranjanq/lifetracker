import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Wallet, Activity, Flame, Lightbulb, Bot, Settings } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: LucideIcon;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', short: 'Overview', icon: LayoutDashboard },
  { to: '/money', label: 'Money', short: 'Money', icon: Wallet },
  { to: '/health', label: 'Health', short: 'Health', icon: Activity },
  { to: '/roast', label: 'Wallet Roast Mode', short: 'Roast', icon: Flame },
  { to: '/insights', label: 'Insights', short: 'Insights', icon: Lightbulb },
  { to: '/assistant', label: 'Assistant', short: 'Assistant', icon: Bot },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings },
];

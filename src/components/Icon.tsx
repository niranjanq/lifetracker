import {
  Wallet, Coins, UtensilsCrossed, BusFront, Home, Receipt, ShoppingBag,
  Clapperboard, Pill, HeartHandshake, PiggyBank, TrendingUp, GraduationCap,
  Repeat, Shapes, LayoutDashboard, Activity, Flame, Lightbulb, Settings,
  Plus, Bell, Search, Calendar, Trash2, Pencil, X, Check, ChevronLeft,
  ChevronRight, Download, ArrowDown, ArrowUp, Flame as FlameIcon, Sparkles,
  type LucideIcon,
} from 'lucide-react';

const MAP: Record<string, LucideIcon> = {
  Wallet, Coins, UtensilsCrossed, BusFront, Home, Receipt, ShoppingBag,
  Clapperboard, Pill, HeartHandshake, PiggyBank, TrendingUp, GraduationCap,
  Repeat, Shape: Shapes, LayoutDashboard, Activity, Flame: FlameIcon, Lightbulb, Settings,
};

export function Icon({ name, className, size = 18 }: { name: string; className?: string; size?: number }) {
  const Cmp = MAP[name] ?? Shapes;
  return <Cmp className={className} size={size} aria-hidden="true" />;
}

export const ICONS = {
  LayoutDashboard, Activity, Flame, Lightbulb, Settings, Plus, Bell, Search,
  Calendar, Trash2, Pencil, X, Check, ChevronLeft, ChevronRight, Download,
  ArrowDown, ArrowUp, Sparkles, Wallet, Coins, PiggyBank, TrendingUp,
};

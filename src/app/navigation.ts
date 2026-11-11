import { CalendarDays, History, LayoutDashboard, Settings, UsersRound, Wallet, type LucideIcon } from 'lucide-react';
import type { ModuleId } from '@/domain/types';

export interface NavItem {
  module: ModuleId;
  path: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { module: 'overview', path: '/', label: 'Visão geral', icon: LayoutDashboard },
  { module: 'finance', path: '/financeiro', label: 'Financeiro', icon: Wallet },
  { module: 'team', path: '/equipe', label: 'Equipe e permissões', icon: UsersRound },
  { module: 'calendar', path: '/calendario', label: 'Calendário', icon: CalendarDays },
  { module: 'activity', path: '/atividades', label: 'Histórico de atividades', icon: History },
  { module: 'settings', path: '/configuracoes', label: 'Configurações', icon: Settings },
];

export const NAV_BY_MODULE = Object.fromEntries(NAV_ITEMS.map((n) => [n.module, n])) as Record<ModuleId, NavItem>;

export const APP_NAME = 'Painel de Lojas';

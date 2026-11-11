import type { ActionId, EffectiveRole, ModuleId } from './types';

export const ACTIONS: { id: ActionId; label: string }[] = [
  { id: 'view', label: 'Visualizar' },
  { id: 'create', label: 'Criar' },
  { id: 'edit', label: 'Editar' },
  { id: 'delete', label: 'Excluir' },
  { id: 'export', label: 'Exportar' },
];

export interface ModuleDef {
  id: ModuleId;
  label: string;
  description: string;
  /** Ações que fazem sentido no módulo (as demais aparecem como "não se aplica"). */
  actions: ActionId[];
  /** Ações que um funcionário nunca pode receber neste módulo (administração). */
  employeeMaxActions?: ActionId[];
}

const ALL: ActionId[] = ['view', 'create', 'edit', 'delete', 'export'];

export const MODULES: ModuleDef[] = [
  { id: 'overview', label: 'Visão geral', description: 'Resumo da loja e atalhos', actions: ['view'] },
  { id: 'finance', label: 'Financeiro', description: 'Módulo previsto para a próxima etapa', actions: ALL },
  {
    id: 'team',
    label: 'Equipe e permissões',
    description: 'Pessoas, vínculos e permissões da loja',
    actions: ALL,
    employeeMaxActions: ['view'],
  },
  { id: 'calendar', label: 'Calendário', description: 'Módulo previsto para uma etapa futura', actions: ALL },
  { id: 'activity', label: 'Histórico de atividades', description: 'Registro das alterações de acesso', actions: ['view', 'export'] },
  { id: 'settings', label: 'Configurações', description: 'Aparência e dados da demonstração', actions: ['view'] },
];

export const MODULE_BY_ID: Record<ModuleId, ModuleDef> = Object.fromEntries(
  MODULES.map((m) => [m.id, m]),
) as Record<ModuleId, ModuleDef>;

export const ACTION_LABEL: Record<ActionId, string> = Object.fromEntries(
  ACTIONS.map((a) => [a.id, a.label]),
) as Record<ActionId, string>;

export const ROLE_LABEL: Record<EffectiveRole, string> = {
  admin_geral: 'Administrador geral',
  responsavel: 'Responsável',
  funcionario: 'Funcionário',
};

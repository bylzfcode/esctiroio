import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { can, firstAllowedModule } from '@/domain/access';
import { MODULE_BY_ID } from '@/domain/modules';
import type { ModuleId } from '@/domain/types';
import { NAV_BY_MODULE } from '@/app/navigation';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';

/**
 * Guarda de rota (somente experiência de uso, NÃO é segurança): se a página atual não é
 * liberada no contexto ativo, redireciona para a primeira página autorizada.
 */
export function RequireModule({ module, children }: { module: ModuleId; children: ReactNode }) {
  const { access, activeStore } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const allowed = can(access, module, 'view');
  const fallback = firstAllowedModule(access);

  useEffect(() => {
    if (allowed || !fallback) return;
    const where = activeStore ? `na ${activeStore.name}` : 'neste contexto';
    toast.info(
      `“${MODULE_BY_ID[module].label}” não está liberado para você ${where}. Você foi levado para “${MODULE_BY_ID[fallback].label}”.`,
    );
    navigate(NAV_BY_MODULE[fallback].path, { replace: true });
  }, [allowed, fallback, module, activeStore, navigate, toast]);

  return allowed ? <>{children}</> : null;
}

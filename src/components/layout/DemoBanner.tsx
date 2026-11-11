import { FlaskConical } from 'lucide-react';
import { Button } from '../ui/Button';

/** Faixa permanente: deixa claro que é demonstração e que a troca de perfil não é login. */
export function DemoBanner({ onSwitchProfile }: { onSwitchProfile: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-warn-soft px-4 py-2 text-[13px] text-warn sm:px-5">
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 leading-snug">
        <strong className="font-semibold">Demonstração com dados fictícios.</strong>{' '}
        <span className="hidden sm:inline">
          A escolha de perfil não é autenticação e as verificações de acesso rodam no navegador.
        </span>
      </p>
      <Button size="sm" variant="secondary" onClick={onSwitchProfile}>
        Trocar perfil
      </Button>
    </div>
  );
}

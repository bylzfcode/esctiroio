import type { ReactNode } from 'react';

/** Linha de configuração: rótulo e descrição à esquerda, controle à direita. */
export function SettingsRow({ label, children, description }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{label}</p>
        {description && <p className="mt-0.5 text-[13px] leading-snug text-mute">{description}</p>}
      </div>
      {children}
    </div>
  );
}

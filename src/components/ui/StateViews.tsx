import { TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

/** Estado vazio: explica o que falta e, quando houver, oferece o próximo passo. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className = '',
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center px-6 py-12 text-center ${className}`}>
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-mute">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children && <div className="mt-1.5 max-w-md text-sm leading-relaxed text-mute">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <TriangleAlert className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="text-base font-semibold text-ink">Não foi possível carregar</h2>
      <p className="mt-1.5 max-w-md text-sm text-mute">{message}</p>
      {onRetry && (
        <Button className="mt-5" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

/** Aviso inline (formulários, páginas). */
export function Notice({ tone = 'info', children, className = '' }: { tone?: 'info' | 'warn' | 'danger'; children: ReactNode; className?: string }) {
  const cls = {
    info: 'bg-brand-soft text-brand-ink',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
  }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'note'} className={`rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed ${cls} ${className}`}>
      {children}
    </div>
  );
}

import type { ReactNode } from 'react';

type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger';
const TONE: Record<Tone, string> = {
  neutral: 'bg-subtle text-mute',
  brand: 'bg-brand-soft text-brand-ink',
  success: 'bg-success-soft text-success',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}

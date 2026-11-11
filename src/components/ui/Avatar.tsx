import { initials } from '@/lib/format';

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-ink ${
        size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-9 w-9 text-xs'
      }`}
    >
      {initials(name)}
    </span>
  );
}

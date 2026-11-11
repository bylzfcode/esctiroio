import { TriangleAlert } from 'lucide-react';
import { Card } from '@/components/ui/Card';

/** Backend não configurado (ou configuração insegura): orienta, nunca cai no mock silenciosamente. */
export default function ConfigProblemPage({ problems }: { problems: string[] }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <Card className="w-full max-w-xl p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warn-soft text-warn">
            <TriangleAlert className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-ink">Backend não configurado</h1>
            <p className="mt-1 text-sm text-mute">O aplicativo não consegue iniciar com a configuração atual e, por segurança, não usa dados de demonstração no lugar.</p>
          </div>
        </div>

        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-ink">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>

        <div className="mt-5 space-y-3 rounded-lg bg-subtle p-4 text-[13px] leading-relaxed text-mute">
          <p className="font-medium text-ink">Como resolver</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Copie <code className="rounded bg-surface px-1">.env.example</code> para <code className="rounded bg-surface px-1">.env.local</code>.
            </li>
            <li>
              Preencha <code className="rounded bg-surface px-1">VITE_SUPABASE_URL</code> e <code className="rounded bg-surface px-1">VITE_SUPABASE_ANON_KEY</code> com a URL e a chave <strong>pública</strong> do seu projeto Supabase.
            </li>
            <li>Reinicie o servidor de desenvolvimento.</li>
          </ol>
          <p>
            Para apenas conhecer a interface com dados fictícios, rode <code className="rounded bg-surface px-1">npm run dev:demo</code>. Detalhes em <code className="rounded bg-surface px-1">docs/BACKEND.md</code>.
          </p>
        </div>
      </Card>
    </div>
  );
}

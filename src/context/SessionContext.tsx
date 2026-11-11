import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { defaultScope, isScopeAllowed, NO_ACCESS, resolveAccess, type AccessContext } from '@/domain/access';
import type { Membership, Person, Scope, Store } from '@/domain/types';
import { readJSON, removeKey, writeJSON } from '@/lib/storage';
import { services } from '@/services';
import { errorMessage } from '@/services/errors';
import type { Actor, SessionSnapshot } from '@/services/types';
import { useToast } from './ToastContext';

// ATENÇÃO: nesta etapa não existe autenticação. A "sessão" abaixo guarda apenas qual perfil
// de demonstração foi escolhido. Não é segurança: qualquer pessoa pode trocar de perfil.

const KEY = 'esctiroio.demo.sessao';

interface Stored {
  personId: string;
  /** Loja/visão preferida. null = usar o padrão do perfil. */
  scope: Scope | null;
}

type Status = 'sem_perfil' | 'carregando' | 'pronta' | 'erro';

interface SessionValue {
  status: Status;
  error: string | null;
  person: Person | null;
  actor: Actor | null;
  stores: Store[];
  memberships: Membership[];
  scope: Scope;
  activeStore: Store | null;
  access: AccessContext;
  /** Muda a cada alteração de dados: use como dependência para recarregar listagens. */
  dataVersion: number;
  selectProfile: (personId: string) => void;
  leaveDemo: () => void;
  setScope: (scope: Scope) => void;
  /** Recarrega vínculos/lojas depois de alterações de equipe. */
  refresh: () => Promise<void>;
  retry: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);
const FALLBACK_SCOPE: Scope = { kind: 'consolidated' };

function effectiveScope(snap: SessionSnapshot | null, wanted: Scope | null): Scope | null {
  if (!snap) return wanted;
  if (wanted && isScopeAllowed(snap.person, snap.memberships, snap.stores, wanted)) return wanted;
  return defaultScope(snap.person, snap.memberships, snap.stores);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [stored, setStored] = useState<Stored | null>(() => readJSON<Stored>(KEY));
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [status, setStatus] = useState<Status>(stored ? 'carregando' : 'sem_perfil');
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const personId = stored?.personId ?? null;

  // Carrega a "sessão" quando o perfil muda (ou ao tentar novamente).
  useEffect(() => {
    if (!personId) {
      setSnapshot(null);
      setStatus('sem_perfil');
      return;
    }
    let cancelled = false;
    setStatus('carregando');
    setError(null);
    services.session
      .loadSnapshot({ personId })
      .then((snap) => {
        if (cancelled) return;
        setSnapshot(snap);
        setStatus('pronta');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err));
        setStatus('erro');
      });
    return () => {
      cancelled = true;
    };
  }, [personId, attempt]);

  const scope = effectiveScope(snapshot, stored?.scope ?? null) ?? FALLBACK_SCOPE;
  const hasAnyScope = !!snapshot && effectiveScope(snapshot, stored?.scope ?? null) !== null;

  // Normaliza a preferência salva: se a loja deixou de ser permitida (vínculo desativado),
  // cai para uma loja autorizada e avisa. Também persiste o escopo efetivo.
  useEffect(() => {
    if (!snapshot || !stored) return;
    const wanted = stored.scope;
    const effective = effectiveScope(snapshot, wanted);
    if (wanted && effective && JSON.stringify(wanted) === JSON.stringify(effective)) {
      writeJSON(KEY, stored);
      return;
    }
    if (wanted === null && effective === null) return; // sem acesso a nada: nada a normalizar
    if (wanted?.kind === 'store') {
      toast.info(
        effective
          ? 'O seu acesso à loja anterior não está mais ativo. Você foi levado para outra loja autorizada.'
          : 'O seu acesso à loja anterior não está mais ativo e você não tem outras lojas autorizadas.',
      );
    }
    setStored({ personId: stored.personId, scope: effective });
  }, [snapshot, stored, toast]);

  const access = useMemo<AccessContext>(
    () => (snapshot && hasAnyScope ? resolveAccess(snapshot.person, snapshot.memberships, scope) : NO_ACCESS),
    [snapshot, scope, hasAnyScope],
  );

  const activeStore = useMemo(
    () => (scope.kind === 'store' ? (snapshot?.stores.find((s) => s.id === scope.storeId) ?? null) : null),
    [scope, snapshot],
  );

  const selectProfile = useCallback((id: string) => {
    const next: Stored = { personId: id, scope: null };
    setSnapshot(null);
    setStored(next);
    setDataVersion((v) => v + 1);
    writeJSON(KEY, next);
  }, []);

  const leaveDemo = useCallback(() => {
    removeKey(KEY);
    setSnapshot(null);
    setStored(null);
    setDataVersion((v) => v + 1);
  }, []);

  const setScope = useCallback((next: Scope) => {
    setStored((s) => (s ? { ...s, scope: next } : s));
  }, []);

  const refresh = useCallback(async () => {
    if (!personId) return;
    const snap = await services.session.loadSnapshot({ personId });
    setSnapshot(snap);
    setDataVersion((v) => v + 1);
  }, [personId]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      error,
      person: snapshot?.person ?? null,
      actor: personId ? { personId } : null,
      stores: snapshot?.stores ?? [],
      memberships: snapshot?.memberships ?? [],
      scope,
      activeStore,
      access,
      dataVersion,
      selectProfile,
      leaveDemo,
      setScope,
      refresh,
      retry: () => setAttempt((a) => a + 1),
    }),
    [status, error, snapshot, personId, scope, activeStore, access, dataVersion, selectProfile, leaveDemo, setScope, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession fora do SessionProvider');
  return ctx;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { defaultScope, isScopeAllowed, NO_ACCESS, resolveAccess, type AccessContext } from '@/domain/access';
import type { Membership, Person, Scope, Store } from '@/domain/types';
import { readJSON, removeKey, writeJSON } from '@/lib/storage';
import { services } from '@/services';
import { ServiceError, errorMessage } from '@/services/errors';
import type { Actor, SessionSnapshot } from '@/services/types';
import { REVALIDATE_EVENT } from '@/config/bootstrap';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

// ATENÇÃO: nesta etapa não existe autenticação. A "sessão" abaixo guarda apenas qual perfil
// de demonstração foi escolhido. Não é segurança: qualquer pessoa pode trocar de perfil.

// Chaves SEPARADAS: nada da demonstração é lido no modo real, nem o contrário.
const KEY = 'esctiroio.demo.sessao'; // modo demo: { personId, scope }
const scopeKey = (userId: string) => `esctiroio.escopo.${userId}`; // modo real: só a loja preferida

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
  /**
   * Recarrega vínculos/lojas. Por padrão sempre notifica as telas (útil após alterações de equipe);
   * com `onlyIfChanged`, só atualiza se a resposta do servidor for diferente (revalidação silenciosa).
   */
  refresh: (opts?: { onlyIfChanged?: boolean }) => Promise<void>;
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
  const auth = useAuth();
  const live = !!services.auth;
  const [stored, setStored] = useState<Stored | null>(() => (live ? null : readJSON<Stored>(KEY)));
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [status, setStatus] = useState<Status>(stored ? 'carregando' : 'sem_perfil');
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // Modo real: a identidade vem SOMENTE da sessão autenticada. Modo demo: do seletor de perfil.
  const personId = live ? (auth.status === 'signed_in' ? auth.userId : null) : (stored?.personId ?? null);
  const pref = stored && stored.personId === personId ? stored.scope : null;

  // Modo real: carrega a loja preferida de cada pessoa (e descarta ao sair).
  useEffect(() => {
    if (!live) return;
    if (!personId) {
      setStored(null);
      return;
    }
    setStored((s) => (s?.personId === personId ? s : { personId, scope: readJSON<Scope>(scopeKey(personId)) }));
  }, [live, personId]);

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

  const scope = effectiveScope(snapshot, pref) ?? FALLBACK_SCOPE;
  const hasAnyScope = !!snapshot && effectiveScope(snapshot, pref) !== null;

  // Normaliza a preferência salva: se a loja deixou de ser permitida (vínculo desativado),
  // cai para uma loja autorizada e avisa. Também persiste o escopo efetivo.
  useEffect(() => {
    if (!snapshot || !stored || stored.personId !== personId) return;
    const wanted = stored.scope;
    const effective = effectiveScope(snapshot, wanted);
    if (wanted && effective && JSON.stringify(wanted) === JSON.stringify(effective)) {
      if (live) writeJSON(scopeKey(stored.personId), stored.scope);
      else writeJSON(KEY, stored);
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
  }, [snapshot, stored, personId, live, toast]);

  const access = useMemo<AccessContext>(
    () => (snapshot && hasAnyScope ? resolveAccess(snapshot.person, snapshot.memberships, scope) : NO_ACCESS),
    [snapshot, scope, hasAnyScope],
  );

  const activeStore = useMemo(
    () => (scope.kind === 'store' ? (snapshot?.stores.find((s) => s.id === scope.storeId) ?? null) : null),
    [scope, snapshot],
  );

  const selectProfile = useCallback((id: string) => {
    if (services.auth) return; // no modo real não existe troca de perfil: a identidade é a sessão
    const next: Stored = { personId: id, scope: null };
    setSnapshot(null);
    setStored(next);
    setDataVersion((v) => v + 1);
    writeJSON(KEY, next);
  }, []);

  const leaveDemo = useCallback(() => {
    if (services.auth) {
      void services.auth.signOut(); // modo real: "sair" encerra a sessão
      return;
    }
    removeKey(KEY);
    setSnapshot(null);
    setStored(null);
    setDataVersion((v) => v + 1);
  }, []);

  const setScope = useCallback((next: Scope) => {
    setStored((s) => (s ? { ...s, scope: next } : s));
  }, []);

  const snapshotRef = useRef<SessionSnapshot | null>(null);
  snapshotRef.current = snapshot;

  const refresh = useCallback(
    async (opts?: { onlyIfChanged?: boolean }) => {
      if (!personId) return;
      const snap = await services.session.loadSnapshot({ personId });
      if (opts?.onlyIfChanged && JSON.stringify(snap) === JSON.stringify(snapshotRef.current)) return; // evita laço de recarga
      setSnapshot(snap);
      setDataVersion((v) => v + 1);
    },
    [personId],
  );

  // Modo real: ao voltar para a aba, revalida no servidor. Se a conta ou o vínculo foi desativado
  // enquanto a aba ficou aberta, a interface reflete isso sem esperar o próximo clique.
  useEffect(() => {
    if (!live || !personId) return;
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 30_000) return;
      last = Date.now();
      refresh().catch((err: unknown) => {
        if (err instanceof ServiceError && err.code === 'forbidden') {
          setError(err.message);
          setStatus('erro');
        }
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [live, personId, refresh]);

  // Modo real: o servidor respondeu "proibido" em alguma chamada. Pode ser só uma ação negada, ou o sinal de
  // que o vínculo/permissões mudaram: revalida a sessão (no máximo a cada 3 s, e só atualiza se algo mudou).
  useEffect(() => {
    if (!live || !personId) return;
    let last = 0;
    const onRevalidate = () => {
      if (Date.now() - last < 3000) return;
      last = Date.now();
      refresh({ onlyIfChanged: true }).catch((err: unknown) => {
        if (err instanceof ServiceError && err.code === 'forbidden') {
          setError(err.message);
          setStatus('erro');
        }
      });
    };
    window.addEventListener(REVALIDATE_EVENT, onRevalidate);
    return () => window.removeEventListener(REVALIDATE_EVENT, onRevalidate);
  }, [live, personId, refresh]);

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

import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/services/errors';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Executa uma chamada assíncrona sempre que `deps` mudar.
 * Ignora respostas atrasadas (troca rápida de loja não mistura dados de lojas diferentes).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: true,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const id = ++latest.current;
    setState((s) => ({ data: s.data, loading: true, error: null }));
    fnRef
      .current()
      .then((data) => {
        if (id === latest.current) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (id === latest.current) setState({ data: null, loading: false, error: errorMessage(err) });
      });
    return () => {
      latest.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useFetch<T>(path: string, opts?: { intervalMs?: number }): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  const aliveRef = useRef(true);

  useEffect(() => {
    void tick;
    aliveRef.current = true;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<T>(path, { signal: ctrl.signal })
      .then((d) => {
        if (aliveRef.current) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!aliveRef.current) return;
        if ((e as Error).name === 'AbortError') return;
        setError((e as Error).message ?? 'fetch_error');
        setLoading(false);
      });
    return () => {
      aliveRef.current = false;
      ctrl.abort();
    };
  }, [path, tick]);

  useEffect(() => {
    if (!opts?.intervalMs) return;
    const id = setInterval(reload, opts.intervalMs);
    return () => clearInterval(id);
  }, [opts?.intervalMs, reload]);

  return { data, error, loading, reload };
}

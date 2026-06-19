import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Run an async loader on mount (and when `deps` change), exposing
 * data/error/loading plus a `reload`. Guards against setting state after the
 * component unmounts or after a newer load supersedes an older one.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    loading: true,
  });
  const callId = useRef(0);

  const run = useCallback(() => {
    const id = ++callId.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => {
        if (id === callId.current) setState({ data, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (id === callId.current) {
          setState({
            data: null,
            error: err instanceof Error ? err.message : 'Request failed',
            loading: false,
          });
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, reload: run };
}

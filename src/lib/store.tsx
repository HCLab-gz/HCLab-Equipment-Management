import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { latestOnly } from './latestOnly';
import { loadService } from './service';
import type { DataService, Profile, Snapshot } from './types';
interface Store {
  api: DataService;
  user: Profile | null;
  data: Snapshot;
  refresh: () => Promise<void>;
  clearSession: () => void;
  toast: (s: string) => void;
}
const Context = createContext<Store | null>(null);
const emptySnapshot = (): Snapshot => ({
  equipment: [],
  bookings: [],
  profiles: [],
  notices: [],
  violations: [],
  busy: [],
  applications: [],
});
export function useApp() {
  const context = useContext(Context);
  if (!context) throw new Error('应用初始化中');
  return context;
}
export function Provider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<DataService | null>(null),
    [user, setUser] = useState<Profile | null>(null),
    [data, setData] = useState<Snapshot>(emptySnapshot),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const gate = useMemo(
    () =>
      latestOnly<{ u: Profile | null; d: Snapshot }>(
        ({ u, d }) => {
          setUser(u);
          setData(d);
        },
        () => {
          setUser(null);
          setData(emptySnapshot());
        },
      ),
    [],
  );
  const refresh = useCallback(async () => {
    if (!api) return;
    await gate.run(async (publish) => {
      const u = await api.session();
      // Drop private state as soon as the identity is gone, even if the public read stalls.
      if (!u) publish({ u: null, d: emptySnapshot() });
      const d = await api.snapshot();
      return { u, d };
    });
  }, [api, gate]);
  const clearSession = useCallback(() => {
    gate.invalidate();
    setUser(null);
    setData(emptySnapshot());
  }, [gate]);
  useEffect(() => {
    loadService()
      .then(setApi)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => api?.onSessionInvalidated?.(clearSession), [api, clearSession]);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (!api) return;
    const sync = () => refresh().catch(() => {});
    const id = setInterval(sync, 30000);
    window.addEventListener('focus', sync);
    window.addEventListener('storage', sync);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', sync);
    };
  }, [api, refresh]);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(''), 4500);
    return () => clearTimeout(id);
  }, [message]);
  if (error)
    return (
      <main className="setup-error">
        <h1>HCLab 仪器管理平台</h1>
        <p role="alert">{error}</p>
        <button onClick={() => location.reload()}>重新连接</button>
      </main>
    );
  if (!api)
    return (
      <main className="setup-error">
        <h1>HCLab</h1>
        <p>正在连接实验室…</p>
      </main>
    );
  return (
    <Context.Provider value={{ api, user, data, refresh, clearSession, toast: setMessage }}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </Context.Provider>
  );
}

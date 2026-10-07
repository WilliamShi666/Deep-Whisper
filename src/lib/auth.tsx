'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { clearLocalVisitorId } from './api';
import { loadOwnerSession } from './personal/owner-client';
export interface AuthUser {
  id: string;
  email: null;
}
export type AuthStatus = 'loading' | 'authed' | 'guest' | 'error';
interface AuthContextType {
  status: AuthStatus;
  user: AuthUser | null;
  accessMode: 'local' | 'password';
  refresh: () => Promise<boolean>;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType>({
  status: 'loading',
  user: null,
  accessMode: 'local',
  refresh: async () => false,
  signOut: async () => {},
});
export function useAuth() {
  return useContext(AuthContext);
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [accessMode, setAccessMode] = useState<'local' | 'password'>('local');
  const probeGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++probeGeneration.current;
    const result = await loadOwnerSession();
    if (generation !== probeGeneration.current) return false;
    if (result.accessMode) setAccessMode(result.accessMode);
    setStatus(result.status);
    return result.status === 'authed';
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      probeGeneration.current += 1;
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);
  const signOut = useCallback(async () => {
    const response = await fetch('/api/owner/session', {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error('sign out failed');
    probeGeneration.current += 1;
    clearLocalVisitorId();
    setStatus('guest');
  }, []);
  return (
    <AuthContext.Provider
      value={{
        status,
        user: status === 'authed' ? { id: 'owner', email: null } : null,
        accessMode,
        refresh,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

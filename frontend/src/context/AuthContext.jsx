import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { refreshSession, setAccessToken, setSessionExpiredHandler } from '../api/client.js';
import { authApi, profileApi } from '../api/endpoints.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous

  const loadProfile = useCallback(async () => {
    try {
      setProfile(await profileApi.get());
    } catch {
      // Profile is created asynchronously from UserRegistered; retry shortly after sign-up.
      setTimeout(() => profileApi.get().then(setProfile).catch(() => {}), 1500);
    }
  }, []);

  const startSession = useCallback(
    async (session) => {
      setAccessToken(session.accessToken);
      setUser(session.user);
      setStatus('authenticated');
      await loadProfile();
    },
    [loadProfile],
  );

  const endSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setProfile(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  // Restore the session on page load via the httpOnly refresh cookie.
  useEffect(() => {
    setSessionExpiredHandler(endSession);
    refreshSession()
      .then(startSession)
      .catch(() => setStatus('anonymous'));
  }, [startSession, endSession]);

  const value = useMemo(
    () => ({
      user,
      profile,
      status,
      currency: profile?.baseCurrency ?? 'USD',
      isAdmin: user?.roles?.includes('admin') ?? false,
      login: async (credentials) => startSession(await authApi.login(credentials)),
      register: async (body) => startSession(await authApi.register(body)),
      logout: async () => {
        await authApi.logout().catch(() => {});
        endSession();
      },
      logoutAll: async () => {
        await authApi.logoutAll().catch(() => {});
        endSession();
      },
      setProfile,
      refreshProfile: loadProfile,
    }),
    [user, profile, status, startSession, endSession, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

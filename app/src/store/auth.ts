import { create } from "zustand";
import { api, loadSession, setToken, setUnauthorizedHandler } from "../api/client";
import type { User } from "../api/types";

interface AuthState {
  ready: boolean;
  token: string | null;
  user: User | null;
  bootstrap: () => Promise<void>;
  setSession: (token: string, user: User) => Promise<void>;
  refreshUser: () => Promise<void>;
  updateProfile: (patch: Record<string, unknown>) => Promise<User>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  ready: false,
  token: null,
  user: null,

  async bootstrap() {
    setUnauthorizedHandler(() => {
      void get().logout();
    });
    const token = await loadSession();
    if (!token) {
      set({ ready: true, token: null, user: null });
      return;
    }
    try {
      const res = await api<{ user: User; token?: string }>("/api/auth/me");
      const next = res.token || token;
      if (res.token) await setToken(res.token);
      set({ ready: true, token: next, user: res.user });
    } catch (e) {
      // 离线时保留 token，等待恢复网络；401 已在 handler 里登出
      set({ ready: true, token, user: get().user });
    }
  },

  async setSession(token, user) {
    await setToken(token);
    set({ token, user });
  },

  async refreshUser() {
    const { user } = await api<{ user: User }>("/api/auth/me");
    set({ user });
  },

  async updateProfile(patch) {
    const { user } = await api<{ user: User }>("/api/auth/me", { method: "PATCH", body: patch });
    set({ user });
    return user;
  },

  async logout() {
    await setToken(null);
    set({ token: null, user: null });
  },
}));

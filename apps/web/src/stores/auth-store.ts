import { create } from "zustand";

export interface User {
  id: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  tier?: 1 | 2 | 3 | 4;
  onboardingComplete?: boolean;
  slug?: string;
  isAdmin?: boolean;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isHydrated: boolean;
  setUser: (user: User | null) => void;
  setAccessToken: (token: string | null) => void;
  setHydrated: (hydrated: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isHydrated: false,
  setUser: (user) => set({ user }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setHydrated: (isHydrated) => set({ isHydrated }),
  logout: () => set({ user: null, accessToken: null }),
}));

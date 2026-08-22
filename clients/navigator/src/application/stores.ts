import { defineStore } from "pinia";
import type { NavigatorStaticConfig } from "../domain/navigatorStaticConfig";
import type { AuthUser } from "../infrastructure/http/authRepository";
import type { SessionProjection } from "../infrastructure/http/sessionRepository";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    authenticated: false,
    initialized: false,
    user: null as AuthUser | null,
  }),
  actions: {
    setUser(user: AuthUser) {
      this.user = user;
      this.authenticated = true;
      this.initialized = true;
    },
    clear() {
      this.user = null;
      this.authenticated = false;
      this.initialized = true;
    },
  },
});

export const useConfiguredVenueStore = defineStore("configuredVenue", {
  state: () => ({ config: null as NavigatorStaticConfig | null }),
  actions: {
    bootstrap(config: NavigatorStaticConfig) {
      this.config = config;
    },
  },
});

export const useRuntimeStore = defineStore("runtime", {
  state: () => ({ snapshot: null as SessionProjection | null }),
  actions: {
    applySnapshot(snapshot: SessionProjection) {
      this.snapshot = snapshot;
    },
    clear() {
      this.snapshot = null;
    },
  },
});

export const usePlanStore = defineStore("plan", {
  state: () => ({ projection: null as unknown }),
});

export const useNavigationStore = defineStore("navigation", {
  state: () => ({ map: null as unknown, navigation: null as unknown }),
});

export const useUiStore = defineStore("ui", {
  state: () => ({ busy: false, error: null as string | null }),
});

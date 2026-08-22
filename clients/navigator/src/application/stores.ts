import { defineStore } from "pinia";
import type { NavigatorStaticConfig } from "../domain/navigatorStaticConfig";

export const useAuthStore = defineStore("auth", {
  state: () => ({ authenticated: false }),
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
  state: () => ({ snapshot: null as unknown }),
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

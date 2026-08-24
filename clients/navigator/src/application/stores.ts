import { defineStore } from "pinia";
import {
  applyNavigatorBranding,
  createFallbackMuseumConfig,
  loadNavigatorMuseumConfig,
  type NavigatorPlatformConfig,
  type NavigatorStaticConfig,
} from "../domain/navigatorStaticConfig";
import type { AuthUser } from "../infrastructure/http/authRepository";
import {
  navigatorVisitRepository,
  type NavigatorMuseumSummary,
} from "../infrastructure/http/navigatorVisitRepository";
import type { SessionProjection } from "../infrastructure/http/sessionRepository";
import type { MapProjection, NavigationProjection } from "../infrastructure/http/navigationRepository";

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
  state: () => ({
    platformConfig: null as NavigatorPlatformConfig | null,
    config: null as NavigatorStaticConfig | null,
    selectedVenueId: null as string | null,
    museums: [] as NavigatorMuseumSummary[],
    configsByVenue: {} as Record<string, NavigatorStaticConfig>,
    fallbackVenueIds: [] as string[],
    catalogLoaded: false,
    loadingCatalog: false,
    error: null as string | null,
  }),
  actions: {
    bootstrapPlatform(config: NavigatorPlatformConfig) {
      this.platformConfig = config;
      this.config = null;
      this.selectedVenueId = null;
      applyNavigatorBranding(config);
    },
    async loadMuseumConfig(museum: NavigatorMuseumSummary) {
      const cached = this.configsByVenue[museum.id];
      if (cached) return cached;
      if (!this.platformConfig) throw new Error("Configurazione piattaforma Navigator non inizializzata");

      let config: NavigatorStaticConfig;
      try {
        config = await loadNavigatorMuseumConfig(museum.id);
      } catch {
        config = createFallbackMuseumConfig(museum.id, museum.name, this.platformConfig);
        if (!this.fallbackVenueIds.includes(museum.id)) {
          this.fallbackVenueIds = [...this.fallbackVenueIds, museum.id];
        }
      }
      this.configsByVenue = { ...this.configsByVenue, [museum.id]: config };
      return config;
    },
    async loadMuseums(force = false) {
      if (this.catalogLoaded && !force) return this.museums;
      this.loadingCatalog = true;
      this.error = null;
      try {
        const response = await navigatorVisitRepository.museums();
        this.museums = response.museums;
        this.catalogLoaded = true;
        await Promise.all(response.museums.map((museum) => this.loadMuseumConfig(museum)));
        return this.museums;
      } catch (cause) {
        this.error = cause instanceof Error ? cause.message : "Impossibile caricare i musei";
        throw cause;
      } finally {
        this.loadingCatalog = false;
      }
    },
    async selectVenue(venueId: string) {
      const museums = await this.loadMuseums();
      const museum = museums.find((entry) => entry.id === venueId);
      if (!museum) throw new Error("Il museo non appartiene alle visite disponibili");
      const config = await this.loadMuseumConfig(museum);
      this.selectedVenueId = venueId;
      this.config = config;
      applyNavigatorBranding(config);
      return config;
    },
    clearSelection() {
      this.selectedVenueId = null;
      this.config = null;
      if (this.platformConfig) applyNavigatorBranding(this.platformConfig);
    },
    resetCatalog() {
      this.museums = [];
      this.configsByVenue = {};
      this.fallbackVenueIds = [];
      this.catalogLoaded = false;
      this.error = null;
      this.clearSelection();
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
  state: () => ({
    map: null as MapProjection | null,
    navigation: null as NavigationProjection | null,
  }),
  actions: {
    setMap(map: MapProjection) { this.map = map; },
    setNavigation(navigation: NavigationProjection | null) { this.navigation = navigation; },
    clear() { this.map = null; this.navigation = null; },
  },
});

export const useUiStore = defineStore("ui", {
  state: () => ({ busy: false, error: null as string | null }),
});

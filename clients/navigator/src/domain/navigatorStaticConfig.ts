export interface NavigatorImageAsset {
  src: string;
  alt: string;
}

export interface NavigatorAssetRef {
  assetId: string;
  alt: string;
}

export interface NavigatorTheme {
  primary: string;
  accent: string;
  surface: string;
}

export interface NavigatorBranding {
  productTitle: string;
  museumTitle: string;
  subtitle?: string;
  logo?: NavigatorImageAsset;
  heroImage?: NavigatorImageAsset;
  theme: NavigatorTheme;
}

interface NavigatorStaticBranding {
  productTitle: string;
  museumTitle: string;
  subtitle?: string;
  logo?: NavigatorImageAsset | NavigatorAssetRef;
  heroImage?: NavigatorImageAsset | NavigatorAssetRef;
  theme: NavigatorTheme;
}

interface NavigatorStaticConfigDocument {
  schemaVersion: 2 | 3;
  venueId: string;
  branding: NavigatorStaticBranding;
}

export interface NavigatorStaticConfig {
  schemaVersion: 2 | 3;
  venueId: string;
  branding: NavigatorBranding;
}

export interface NavigatorPlatformConfig {
  schemaVersion: 1;
  branding: NavigatorBranding;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const ASSET_PREFIX = "/navigator-assets/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeAssetPath(value: unknown): value is string {
  if (!isNonEmptyString(value) || !value.startsWith(ASSET_PREFIX)) return false;
  if (value.includes("\\") || value.includes("..") || value.includes("//")) return false;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith(ASSET_PREFIX);
  } catch {
    return false;
  }
}

function isImageAsset(value: unknown): value is NavigatorImageAsset {
  return isRecord(value)
    && isSafeAssetPath(value.src)
    && typeof value.alt === "string";
}

function isAssetRef(value: unknown): value is NavigatorAssetRef {
  return isRecord(value)
    && typeof value.assetId === "string"
    && OBJECT_ID.test(value.assetId)
    && !/^0{24}$/i.test(value.assetId)
    && typeof value.alt === "string";
}

function isTheme(value: unknown): value is NavigatorTheme {
  return isRecord(value)
    && typeof value.primary === "string" && HEX_COLOR.test(value.primary)
    && typeof value.accent === "string" && HEX_COLOR.test(value.accent)
    && typeof value.surface === "string" && HEX_COLOR.test(value.surface);
}

function isPlatformBranding(value: unknown): value is NavigatorBranding {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.productTitle)
    && isNonEmptyString(value.museumTitle)
    && (value.subtitle === undefined || typeof value.subtitle === "string")
    && (value.logo === undefined || isImageAsset(value.logo))
    && (value.heroImage === undefined || isImageAsset(value.heroImage))
    && isTheme(value.theme);
}

function isMuseumBranding(value: unknown, schemaVersion: 2 | 3): value is NavigatorStaticBranding {
  if (!isRecord(value)) return false;
  const isExpectedAsset = schemaVersion === 3 ? isAssetRef : isImageAsset;
  return isNonEmptyString(value.productTitle)
    && isNonEmptyString(value.museumTitle)
    && (value.subtitle === undefined || typeof value.subtitle === "string")
    && (value.logo === undefined || isExpectedAsset(value.logo))
    && (value.heroImage === undefined || isExpectedAsset(value.heroImage))
    && isTheme(value.theme);
}

function isNavigatorStaticConfigDocument(value: unknown): value is NavigatorStaticConfigDocument {
  if (!isRecord(value) || (value.schemaVersion !== 2 && value.schemaVersion !== 3)) return false;
  return typeof value.venueId === "string"
    && OBJECT_ID.test(value.venueId)
    && !/^0{24}$/i.test(value.venueId)
    && isMuseumBranding(value.branding, value.schemaVersion);
}

export function isNavigatorStaticConfig(value: unknown): value is NavigatorStaticConfig {
  return isRecord(value)
    && (value.schemaVersion === 2 || value.schemaVersion === 3)
    && typeof value.venueId === "string"
    && OBJECT_ID.test(value.venueId)
    && isPlatformBranding(value.branding);
}

export function isNavigatorPlatformConfig(value: unknown): value is NavigatorPlatformConfig {
  return isRecord(value) && value.schemaVersion === 1 && isPlatformBranding(value.branding);
}

function onColor(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16) / 255) || [0, 0, 0];
  const luminance = channels
    .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.42 ? "#151918" : "#ffffff";
}

export function applyNavigatorBranding(config: NavigatorStaticConfig | NavigatorPlatformConfig) {
  const { branding } = config;
  const root = document.documentElement;
  root.style.setProperty("--navigator-brand-primary", branding.theme.primary);
  root.style.setProperty("--navigator-brand-accent", branding.theme.accent);
  root.style.setProperty("--navigator-brand-surface", branding.theme.surface);
  root.style.setProperty("--navigator-on-primary", onColor(branding.theme.primary));
  document.title = branding.productTitle + " · " + branding.museumTitle;

  const existingFavicon = document.querySelector<HTMLLinkElement>('link[data-navigator-favicon="true"]');
  if (!branding.logo) {
    existingFavicon?.remove();
    return;
  }
  const favicon = existingFavicon || document.createElement("link");
  favicon.rel = "icon";
  favicon.href = branding.logo.src;
  favicon.dataset.navigatorFavicon = "true";
  if (!existingFavicon) document.head.appendChild(favicon);
}

function publicRuntimeUrl(path: string) {
  const relative = path.replace(/^\/+/, "");
  return import.meta.env.DEV ? import.meta.env.BASE_URL + relative : "/" + relative;
}

function resolvePlatformAsset(asset: NavigatorImageAsset | undefined, scope: string) {
  if (!asset) return asset;
  return { ...asset, src: publicRuntimeUrl(scope + asset.src) };
}

function resolvePlatformBranding(branding: NavigatorBranding, scope: string): NavigatorBranding {
  return {
    ...branding,
    logo: resolvePlatformAsset(branding.logo, scope),
    heroImage: resolvePlatformAsset(branding.heroImage, scope),
  };
}

function resolveMuseumAsset(asset: NavigatorImageAsset | NavigatorAssetRef | undefined, scope: string) {
  if (!asset) return undefined;
  if ("assetId" in asset) {
    return { src: `/api/navigator-assets/${encodeURIComponent(asset.assetId)}`, alt: asset.alt };
  }
  return { ...asset, src: publicRuntimeUrl(scope + asset.src) };
}

function resolveMuseumBranding(branding: NavigatorStaticBranding, scope: string): NavigatorBranding {
  return {
    productTitle: branding.productTitle,
    museumTitle: branding.museumTitle,
    subtitle: branding.subtitle,
    logo: resolveMuseumAsset(branding.logo, scope),
    heroImage: resolveMuseumAsset(branding.heroImage, scope),
    theme: branding.theme,
  };
}

async function loadConfig(scope: string): Promise<unknown> {
  const response = await fetch(publicRuntimeUrl(scope + "/navigator.config.json"), { cache: "no-store" });
  if (!response.ok) throw new Error("Configurazione Navigator non disponibile");
  return response.json();
}

export async function loadNavigatorPlatformConfig(): Promise<NavigatorPlatformConfig> {
  const value = await loadConfig("navigator-platform");
  if (!isNavigatorPlatformConfig(value)) throw new Error("Configurazione piattaforma Navigator non valida");
  return { ...value, branding: resolvePlatformBranding(value.branding, "navigator-platform") };
}

export async function loadNavigatorMuseumConfig(venueId: string): Promise<NavigatorStaticConfig> {
  if (!OBJECT_ID.test(venueId)) throw new Error("venueId della configurazione Navigator non valido");
  const scope = "navigator-configs/" + venueId;
  const value = await loadConfig(scope);
  if (!isNavigatorStaticConfigDocument(value)) throw new Error("Configurazione museo Navigator non valida");
  if (value.venueId !== venueId) throw new Error("La configurazione Navigator non corrisponde al museo selezionato");
  return { schemaVersion: value.schemaVersion, venueId: value.venueId, branding: resolveMuseumBranding(value.branding, scope) };
}

export function createFallbackMuseumConfig(
  venueId: string,
  museumTitle: string,
  platform: NavigatorPlatformConfig,
): NavigatorStaticConfig {
  return {
    schemaVersion: 3,
    venueId,
    branding: {
      ...platform.branding,
      museumTitle,
      subtitle: "Identità museale predefinita",
      heroImage: undefined,
    },
  };
}

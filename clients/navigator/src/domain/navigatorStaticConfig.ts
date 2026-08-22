export interface NavigatorBranding {
  title: string;
  subtitle?: string;
  logoUrl?: string;
}

export interface NavigatorStaticConfig {
  schemaVersion: 1;
  venueId: string;
  branding: NavigatorBranding;
}

function isConfig(value: unknown): value is NavigatorStaticConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NavigatorStaticConfig>;
  return candidate.schemaVersion === 1
    && typeof candidate.venueId === "string"
    && candidate.venueId.length > 0
    && Boolean(candidate.branding)
    && typeof candidate.branding?.title === "string";
}

export async function loadNavigatorStaticConfig(): Promise<NavigatorStaticConfig> {
  const response = await fetch("/navigator.config.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Navigator static config non disponibile");
  const value: unknown = await response.json();
  if (!isConfig(value)) throw new Error("Navigator static config non valida");
  return value;
}

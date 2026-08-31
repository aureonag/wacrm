// ============================================================
// Prospecting: Google Places API (New) client.
//
// Text Search for discovery (minimal field mask — identity fields
// only, to control cost across a broad search) and Place Details for
// enrichment (richer field mask, called once per retained candidate).
// Never scrapes Google Maps directly — this is the one supported,
// documented integration path.
//
// Absence of `GOOGLE_PLACES_API_KEY` must never crash the app — every
// caller checks `isGooglePlacesConfigured()` first (the engine fails
// the run explicitly with a clear error rather than silently no-op).
// ============================================================

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places";

const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;

// Discovery: keep the mask minimal — this call can return many results
// per search, so every extra field is a real per-result cost.
const SEARCH_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.addressComponents";

// Enrichment: called once per retained candidate, so the richer mask
// here is the one place we actually spend on rating/phone/site/maps.
const DETAILS_FIELD_MASK =
  "id,displayName,formattedAddress,addressComponents,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount,googleMapsUri";

export function isGooglePlacesConfigured(): boolean {
  return !!process.env.GOOGLE_PLACES_API_KEY;
}

export class GooglePlacesError extends Error {
  readonly code: string;
  constructor(message: string, code = "google_places_error") {
    super(message);
    this.name = "GooglePlacesError";
    this.code = code;
  }
}

interface GoogleDisplayName {
  text?: string;
}
interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}
interface GooglePlaceRaw {
  id?: string;
  displayName?: GoogleDisplayName;
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
}

export interface DiscoveredPlace {
  placeId: string;
  companyName: string;
  address: string | null;
  city: string | null;
  state: string | null;
}

export interface PlaceDetailsResult {
  placeId: string;
  companyName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  googleMapsUrl: string | null;
}

function extractCityState(components: GoogleAddressComponent[] | undefined): { city: string | null; state: string | null } {
  if (!components) return { city: null, state: null };
  const city = components.find((c) => c.types?.includes("administrative_area_level_2") || c.types?.includes("locality"))
    ?.longText;
  const state = components.find((c) => c.types?.includes("administrative_area_level_1"))?.shortText;
  return { city: city ?? null, state: state ?? null };
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      // Retry on server-side/rate-limit errors only — a 4xx (bad
      // request, invalid key) will never succeed on retry.
      if (res.status >= 500 || res.status === 429) {
        lastErr = new GooglePlacesError(`Google Places respondeu ${res.status}`, "provider_error");
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new GooglePlacesError("Falha de rede ao chamar o Google Places.", "network_error");
}

/**
 * Text Search — one page of discovery results. Callers page through
 * `nextPageToken` themselves (the engine bounds how many pages it will
 * follow per run, not this function).
 */
export async function searchPlacesText(args: {
  niche: string;
  region: string;
  pageToken?: string;
}): Promise<{ places: DiscoveredPlace[]; nextPageToken: string | null }> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new GooglePlacesError("GOOGLE_PLACES_API_KEY não configurada.", "not_configured");

  const res = await fetchWithRetry(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: `${args.niche} em ${args.region}`,
      pageSize: 20,
      ...(args.pageToken ? { pageToken: args.pageToken } : {}),
    }),
  });

  if (!res.ok) {
    const status = res.status;
    if (status === 401 || status === 403) {
      throw new GooglePlacesError("Chave do Google Places inválida ou sem permissão.", "invalid_key");
    }
    throw new GooglePlacesError(`Google Places respondeu ${status} na busca.`, "provider_error");
  }

  const data = (await res.json().catch(() => null)) as { places?: GooglePlaceRaw[]; nextPageToken?: string } | null;
  const places = (data?.places ?? [])
    .filter((p): p is GooglePlaceRaw & { id: string } => !!p.id)
    .map((p) => {
      const { city, state } = extractCityState(p.addressComponents);
      return {
        placeId: p.id,
        companyName: p.displayName?.text || "",
        address: p.formattedAddress ?? null,
        city,
        state,
      };
    })
    .filter((p) => p.companyName);

  return { places, nextPageToken: data?.nextPageToken ?? null };
}

/** Place Details — rich enrichment for one already-discovered place. */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetailsResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new GooglePlacesError("GOOGLE_PLACES_API_KEY não configurada.", "not_configured");

  const res = await fetchWithRetry(`${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
    },
  });

  if (!res.ok) {
    const status = res.status;
    if (status === 401 || status === 403) {
      throw new GooglePlacesError("Chave do Google Places inválida ou sem permissão.", "invalid_key");
    }
    if (status === 404) {
      throw new GooglePlacesError("Local não encontrado no Google Places.", "not_found");
    }
    throw new GooglePlacesError(`Google Places respondeu ${status} no detalhamento.`, "provider_error");
  }

  const p = (await res.json().catch(() => null)) as GooglePlaceRaw | null;
  if (!p) throw new GooglePlacesError("Resposta vazia do Google Places.", "empty_response");

  const { city, state } = extractCityState(p.addressComponents);
  return {
    placeId: p.id ?? placeId,
    companyName: p.displayName?.text || "",
    address: p.formattedAddress ?? null,
    city,
    state,
    phone: p.internationalPhoneNumber || p.nationalPhoneNumber || null,
    website: p.websiteUri ?? null,
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    googleMapsUrl: p.googleMapsUri ?? null,
  };
}

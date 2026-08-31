import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GooglePlacesError, getPlaceDetails, isGooglePlacesConfigured, searchPlacesText } from "./google-places";

const originalKey = process.env.GOOGLE_PLACES_API_KEY;
const originalFetch = global.fetch;

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = originalKey;
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("isGooglePlacesConfigured", () => {
  it("reflects whether the env var is set, never throwing when absent", () => {
    expect(isGooglePlacesConfigured()).toBe(true);
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(isGooglePlacesConfigured()).toBe(false);
  });
});

describe("searchPlacesText", () => {
  it("throws a typed not_configured error instead of calling fetch when the key is missing", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as never;

    await expect(searchPlacesText({ niche: "dentista", region: "SP" })).rejects.toMatchObject({
      code: "not_configured",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the minimal discovery field mask and maps the response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          places: [
            {
              id: "place-1",
              displayName: { text: "Clínica Exemplo" },
              formattedAddress: "Rua X, 123",
              addressComponents: [
                { longText: "São Paulo", types: ["administrative_area_level_2"] },
                { shortText: "SP", types: ["administrative_area_level_1"] },
              ],
            },
          ],
          nextPageToken: "token-2",
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchSpy as never;

    const result = await searchPlacesText({ niche: "dentista", region: "São Paulo" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("places:searchText");
    expect(init.headers["X-Goog-FieldMask"]).not.toContain("rating");
    expect(JSON.parse(init.body).textQuery).toContain("dentista");

    expect(result.nextPageToken).toBe("token-2");
    expect(result.places).toEqual([
      { placeId: "place-1", companyName: "Clínica Exemplo", address: "Rua X, 123", city: "São Paulo", state: "SP" },
    ]);
  });

  it("throws invalid_key on a 401/403 without retrying", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("nope", { status: 403 }));
    global.fetch = fetchSpy as never;

    await expect(searchPlacesText({ niche: "x", region: "y" })).rejects.toMatchObject({ code: "invalid_key" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries a 500 up to the retry limit, then throws", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    global.fetch = fetchSpy as never;

    await expect(searchPlacesText({ niche: "x", region: "y" })).rejects.toBeInstanceOf(GooglePlacesError);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it("skips a result with no place id or empty name rather than crashing", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ places: [{ displayName: { text: "Sem ID" } }, { id: "p2" }] }), { status: 200 }),
    );
    global.fetch = fetchSpy as never;

    const result = await searchPlacesText({ niche: "x", region: "y" });
    expect(result.places).toEqual([]);
  });
});

describe("getPlaceDetails", () => {
  it("maps a full details response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "place-1",
          displayName: { text: "Clínica Exemplo" },
          formattedAddress: "Rua X, 123",
          internationalPhoneNumber: "+551199999999",
          websiteUri: "https://clinicaexemplo.com.br",
          rating: 4.7,
          userRatingCount: 32,
          googleMapsUri: "https://maps.google.com/?cid=1",
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchSpy as never;

    const result = await getPlaceDetails("place-1");

    expect(result).toEqual({
      placeId: "place-1",
      companyName: "Clínica Exemplo",
      address: "Rua X, 123",
      city: null,
      state: null,
      phone: "+551199999999",
      website: "https://clinicaexemplo.com.br",
      rating: 4.7,
      reviewCount: 32,
      googleMapsUrl: "https://maps.google.com/?cid=1",
    });
  });

  it("throws a typed not_found error on a 404", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    global.fetch = fetchSpy as never;
    await expect(getPlaceDetails("missing")).rejects.toMatchObject({ code: "not_found" });
  });
});

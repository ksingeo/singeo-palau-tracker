// Dashboard settings. Edit freely.

// Public Facebook pages shown in "Palau on Facebook". Handles were checked
// against each organisation's own website or Facebook profile in Nov 2026.
// Viewers can add or remove pages in the dashboard (saved in their browser).
export const FACEBOOK_PAGES = [
  { name: "Island Times", handle: "islandtimespw", about: "Palau's twice-weekly newspaper (Koror)." },
  { name: "Office of the President", handle: "PalauPresident", about: "Official page of the President of the Republic of Palau." },
  { name: "Tia Belau Newspaper", handle: "tiabelau1", about: "Palau's first newspaper, published in Koror." },
  { name: "Palau Visitors Authority", handle: "officialpva", about: "Tourism authority: events, visitor news, Palau Pledge." },
  { name: "Ministry of Health & Human Services", handle: "MHHSPalau", about: "Health advisories and public health news." },
  { name: "Palau NEMO", handle: "PalauNEMO", about: "National Emergency Management Office: warnings and emergencies." },
  { name: "Palau National Weather Service", handle: "wsopalau", about: "NOAA Weather Service Office Palau: forecasts and small-craft warnings." },
];

export const MAP = {
  center: [7.3, 133.6],
  zoom: 6,
  // Aircraft refresh from OpenSky when "Live flights" is ticked (anonymous quota is small).
  openskyBox: { lamin: 1.0, lomin: 128.5, lamax: 12.5, lomax: 138.5 },
  openskyRefreshMs: 180000,
};

export const QUAKES = { radiusKm: 1500, days: 30, center: [7.5, 134.5] };

export const WEATHER = {
  point: [7.3426, 134.4789],         // Koror
  marinePoint: [7.25, 134.35],       // open water west of Malakal
  tideStation: "1841367",            // NOAA CO-OPS: Malakal Harbor, Palau
  tideStationName: "Malakal Harbor",
};

// How old (minutes) server-side data may get before the header warns.
export const STALE_MINUTES = 90;

export const EMBEDS = {
  vesselfinder: { lat: 7.4, lon: 134.0, zoom: 6 },
  marinetraffic: { lat: 7.4, lon: 134.0, zoom: 6 },
  adsb: "https://globe.adsb.lol/?lat=7.4&lon=134.5&zoom=6",
};

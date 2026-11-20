/**
 * Putting a name to a pair of coordinates, without asking anybody.
 *
 * The browser hands over a latitude and a longitude; what the reader wants to
 * see beside them is "Toronto". Every other tool would reverse-geocode that
 * over the network — this one never makes a request, so the answer comes from a
 * table compiled in.
 *
 * It is a *label*, not a claim about where the reader lives: the sunrise maths
 * uses the coordinates, and the name is only there so a saved position is
 * recognisable at a glance. So the list is deliberately short — big cities,
 * heavier where this tool's reader is — and anything more than 120km from all
 * of them stays nameless rather than being called by the wrong city's name.
 */

/** `[name, latitude, longitude]`, so the table reads as data rather than code. */
type City = readonly [string, number, number];

const CITIES: readonly City[] = [
  // Canada
  ["Toronto", 43.65, -79.38],
  ["Mississauga", 43.59, -79.64],
  ["Hamilton", 43.26, -79.87],
  ["Ottawa", 45.42, -75.7],
  ["Montreal", 45.5, -73.57],
  ["Quebec City", 46.81, -71.21],
  ["Halifax", 44.65, -63.57],
  ["St. John's", 47.56, -52.71],
  ["Winnipeg", 49.9, -97.14],
  ["Saskatoon", 52.13, -106.67],
  ["Regina", 50.45, -104.62],
  ["Calgary", 51.05, -114.07],
  ["Edmonton", 53.55, -113.49],
  ["Banff", 51.18, -115.57],
  ["Vancouver", 49.28, -123.12],
  ["Victoria", 48.43, -123.37],
  ["Kelowna", 49.89, -119.5],
  ["Whitehorse", 60.72, -135.06],
  ["Yellowknife", 62.45, -114.37],
  ["Sudbury", 46.49, -80.99],
  ["Thunder Bay", 48.38, -89.25],
  ["London, Ontario", 42.98, -81.25],
  ["Kingston", 44.23, -76.49],
  ["Windsor", 42.31, -83.04],
  ["Barrie", 44.39, -79.69],
  ["Niagara Falls", 43.09, -79.08],

  // United States
  ["New York", 40.71, -74.01],
  ["Boston", 42.36, -71.06],
  ["Philadelphia", 39.95, -75.17],
  ["Washington DC", 38.91, -77.04],
  ["Pittsburgh", 40.44, -79.99],
  ["Buffalo", 42.89, -78.88],
  ["Cleveland", 41.5, -81.69],
  ["Detroit", 42.33, -83.05],
  ["Chicago", 41.88, -87.63],
  ["Minneapolis", 44.98, -93.27],
  ["Milwaukee", 43.04, -87.91],
  ["St. Louis", 38.63, -90.2],
  ["Kansas City", 39.1, -94.58],
  ["Nashville", 36.16, -86.78],
  ["Atlanta", 33.75, -84.39],
  ["Charlotte", 35.23, -80.84],
  ["Miami", 25.76, -80.19],
  ["Orlando", 28.54, -81.38],
  ["Tampa", 27.95, -82.46],
  ["New Orleans", 29.95, -90.07],
  ["Houston", 29.76, -95.37],
  ["Austin", 30.27, -97.74],
  ["Dallas", 32.78, -96.8],
  ["San Antonio", 29.42, -98.49],
  ["Denver", 39.74, -104.99],
  ["Salt Lake City", 40.76, -111.89],
  ["Albuquerque", 35.08, -106.65],
  ["Phoenix", 33.45, -112.07],
  ["Las Vegas", 36.17, -115.14],
  ["Los Angeles", 34.05, -118.24],
  ["San Diego", 32.72, -117.16],
  ["San Francisco", 37.77, -122.42],
  ["San Jose", 37.34, -121.89],
  ["Portland", 45.52, -122.68],
  ["Seattle", 47.61, -122.33],
  ["Anchorage", 61.22, -149.9],
  ["Honolulu", 21.31, -157.86],

  // Latin America
  ["Mexico City", 19.43, -99.13],
  ["Guadalajara", 20.67, -103.35],
  ["Cancún", 21.16, -86.85],
  ["Havana", 23.11, -82.37],
  ["San José, Costa Rica", 9.93, -84.08],
  ["Panama City", 8.98, -79.52],
  ["Bogotá", 4.71, -74.07],
  ["Quito", -0.18, -78.47],
  ["Lima", -12.05, -77.04],
  ["La Paz", -16.5, -68.15],
  ["Santiago", -33.45, -70.67],
  ["Buenos Aires", -34.6, -58.38],
  ["Montevideo", -34.9, -56.16],
  ["São Paulo", -23.55, -46.63],
  ["Rio de Janeiro", -22.91, -43.17],
  ["Brasília", -15.79, -47.88],
  ["Salvador", -12.97, -38.5],
  ["Manaus", -3.12, -60.02],

  // Northern and western Europe
  ["London", 51.51, -0.13],
  ["Manchester", 53.48, -2.24],
  ["Birmingham", 52.49, -1.89],
  ["Glasgow", 55.86, -4.25],
  ["Edinburgh", 55.95, -3.19],
  ["Dublin", 53.35, -6.26],
  ["Reykjavík", 64.15, -21.94],
  ["Oslo", 59.91, 10.75],
  ["Bergen", 60.39, 5.32],
  ["Tromsø", 69.65, 18.96],
  ["Stockholm", 59.33, 18.07],
  ["Gothenburg", 57.71, 11.97],
  ["Malmö", 55.6, 13.0],
  ["Copenhagen", 55.68, 12.57],
  ["Helsinki", 60.17, 24.94],
  ["Tallinn", 59.44, 24.75],
  ["Riga", 56.95, 24.11],
  ["Vilnius", 54.69, 25.28],
  ["Amsterdam", 52.37, 4.9],
  ["Rotterdam", 51.92, 4.48],
  ["Brussels", 50.85, 4.35],
  ["Paris", 48.86, 2.35],
  ["Lyon", 45.76, 4.84],
  ["Marseille", 43.3, 5.37],
  ["Bordeaux", 44.84, -0.58],
  ["Nice", 43.7, 7.27],
  ["Madrid", 40.42, -3.7],
  ["Barcelona", 41.39, 2.17],
  ["Valencia", 39.47, -0.38],
  ["Seville", 37.39, -6.0],
  ["Lisbon", 38.72, -9.14],
  ["Porto", 41.15, -8.61],

  // Central, southern and eastern Europe
  ["Berlin", 52.52, 13.4],
  ["Hamburg", 53.55, 9.99],
  ["Munich", 48.14, 11.58],
  ["Cologne", 50.94, 6.96],
  ["Frankfurt", 50.11, 8.68],
  ["Zurich", 47.38, 8.54],
  ["Geneva", 46.2, 6.14],
  ["Vienna", 48.21, 16.37],
  ["Prague", 50.08, 14.44],
  ["Warsaw", 52.23, 21.01],
  ["Kraków", 50.06, 19.94],
  ["Budapest", 47.5, 19.04],
  ["Bucharest", 44.43, 26.11],
  ["Sofia", 42.7, 23.32],
  ["Belgrade", 44.79, 20.45],
  ["Zagreb", 45.81, 15.98],
  ["Ljubljana", 46.06, 14.51],
  ["Milan", 45.46, 9.19],
  ["Venice", 45.44, 12.32],
  ["Rome", 41.9, 12.5],
  ["Naples", 40.85, 14.27],
  ["Athens", 37.98, 23.73],
  ["Istanbul", 41.01, 28.98],
  ["Kyiv", 50.45, 30.52],
  ["Minsk", 53.9, 27.57],
  ["Moscow", 55.76, 37.62],
  ["St Petersburg", 59.94, 30.31],

  // Africa and the Middle East
  ["Casablanca", 33.57, -7.59],
  ["Marrakesh", 31.63, -8.0],
  ["Cairo", 30.04, 31.24],
  ["Tel Aviv", 32.08, 34.78],
  ["Jerusalem", 31.78, 35.22],
  ["Beirut", 33.89, 35.5],
  ["Amman", 31.95, 35.93],
  ["Dubai", 25.2, 55.27],
  ["Abu Dhabi", 24.45, 54.38],
  ["Doha", 25.29, 51.53],
  ["Riyadh", 24.71, 46.68],
  ["Tehran", 35.69, 51.39],
  ["Lagos", 6.52, 3.38],
  ["Accra", 5.6, -0.19],
  ["Addis Ababa", 9.03, 38.74],
  ["Nairobi", -1.29, 36.82],
  ["Dar es Salaam", -6.79, 39.21],
  ["Kampala", 0.35, 32.58],
  ["Johannesburg", -26.2, 28.05],
  ["Cape Town", -33.92, 18.42],
  ["Durban", -29.86, 31.02],

  // Asia
  ["Karachi", 24.86, 67.0],
  ["Lahore", 31.55, 74.34],
  ["Delhi", 28.61, 77.21],
  ["Mumbai", 19.08, 72.88],
  ["Bengaluru", 12.97, 77.59],
  ["Chennai", 13.08, 80.27],
  ["Kolkata", 22.57, 88.36],
  ["Kathmandu", 27.72, 85.32],
  ["Colombo", 6.93, 79.86],
  ["Dhaka", 23.81, 90.41],
  ["Bangkok", 13.76, 100.5],
  ["Chiang Mai", 18.79, 98.99],
  ["Hanoi", 21.03, 105.85],
  ["Ho Chi Minh City", 10.82, 106.63],
  ["Phnom Penh", 11.56, 104.92],
  ["Kuala Lumpur", 3.14, 101.69],
  ["Singapore", 1.35, 103.82],
  ["Jakarta", -6.21, 106.85],
  ["Bali", -8.41, 115.19],
  ["Manila", 14.6, 120.98],
  ["Hong Kong", 22.32, 114.17],
  ["Taipei", 25.03, 121.57],
  ["Shanghai", 31.23, 121.47],
  ["Beijing", 39.9, 116.41],
  ["Shenzhen", 22.54, 114.06],
  ["Chengdu", 30.57, 104.07],
  ["Seoul", 37.57, 126.98],
  ["Busan", 35.18, 129.08],
  ["Tokyo", 35.68, 139.65],
  ["Osaka", 34.69, 135.5],
  ["Kyoto", 35.01, 135.77],
  ["Sapporo", 43.06, 141.35],
  ["Ulaanbaatar", 47.89, 106.91],
  ["Almaty", 43.24, 76.89],
  ["Tashkent", 41.3, 69.24],

  // Oceania
  ["Sydney", -33.87, 151.21],
  ["Melbourne", -37.81, 144.96],
  ["Brisbane", -27.47, 153.03],
  ["Perth", -31.95, 115.86],
  ["Adelaide", -34.93, 138.6],
  ["Hobart", -42.88, 147.33],
  ["Cairns", -16.92, 145.77],
  ["Darwin", -12.46, 130.84],
  ["Auckland", -36.85, 174.76],
  ["Wellington", -41.29, 174.78],
  ["Christchurch", -43.53, 172.64],
  ["Queenstown", -45.03, 168.66],
  ["Suva", -18.14, 178.44],
];

/** Where this tool's reader is, and what a first run assumes. */
export const DEFAULT_CITY = { lat: 43.65, lon: -79.38, label: "Toronto" };

const RAD = Math.PI / 180;

/** Great-circle distance in kilometres. */
function distance(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The nearest city in the table, or `null` when none is close enough to be
 * worth naming — better an unnamed position than one labelled with a city three
 * hundred miles away.
 */
export function nearestCity(lat: number, lon: number, within = 120): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  let best: { name: string; km: number } | null = null;
  for (const [name, cityLat, cityLon] of CITIES) {
    const km = distance(lat, lon, cityLat, cityLon);
    if (!best || km < best.km) best = { name, km };
  }

  return best && best.km <= within ? best.name : null;
}

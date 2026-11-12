export interface Canton {
  code: string;
  name: string;
  /** Geographic bounding box: west, south, east, north (WGS84). */
  bounds: [number, number, number, number];
}

// swisstopo SearchServer, origins=kantone, sr=4326. Retrieved 2026-11-12.
// https://api3.geo.admin.ch/rest/services/api/SearchServer
// Stored locally so choosing a canton needs no geocoding request.
export const CANTONS: Canton[] = [
  {code: "AG", name: "Aargau", bounds: [7.71148, 47.137084, 8.46056, 47.623292]},
  {code: "AR", name: "Appenzell Ausserrhoden", bounds: [9.187369, 47.241743, 9.632005, 47.474853]},
  {code: "AI", name: "Appenzell Innerrhoden", bounds: [9.306678, 47.229923, 9.618687, 47.44893]},
  {code: "BL", name: "Basel-Landschaft", bounds: [7.324906, 47.337222, 7.963223, 47.564362]},
  {code: "BS", name: "Basel-Stadt", bounds: [7.554556, 47.519118, 7.693793, 47.601133]},
  {code: "BE", name: "Bern", bounds: [6.859558, 46.322164, 8.467388, 47.343906]},
  {code: "FR", name: "Fribourg", bounds: [6.73957, 46.436703, 7.380487, 47.007012]},
  {code: "GE", name: "Geneva", bounds: [5.94964, 46.128531, 6.312594, 46.365919]},
  {code: "GL", name: "Glarus", bounds: [8.870036, 46.791852, 9.260824, 47.175629]},
  {code: "GR", name: "Graubünden", bounds: [8.640866, 46.142002, 10.516663, 47.077866]},
  {code: "JU", name: "Jura", bounds: [6.836979, 47.150188, 7.558749, 47.505157]},
  {code: "LU", name: "Lucerne", bounds: [7.833106, 46.771279, 8.519441, 47.28942]},
  {code: "NE", name: "Neuchâtel", bounds: [6.428285, 46.846178, 7.089026, 47.166654]},
  {code: "NW", name: "Nidwalden", bounds: [8.215083, 46.769914, 8.575686, 47.021071]},
  {code: "OW", name: "Obwalden", bounds: [8.041281, 46.751317, 8.50952, 46.981714]},
  {code: "SH", name: "Schaffhausen", bounds: [8.402006, 47.548874, 8.880093, 47.80991]},
  {code: "SZ", name: "Schwyz", bounds: [8.385569, 46.883433, 9.00608, 47.22659]},
  {code: "SO", name: "Solothurn", bounds: [7.33988, 47.072834, 8.032676, 47.502675]},
  {code: "SG", name: "St. Gallen", bounds: [8.786604, 46.869125, 9.680754, 47.560163]},
  {code: "TG", name: "Thurgau", bounds: [8.661101, 47.367325, 9.51217, 47.695646]},
  {code: "TI", name: "Ticino", bounds: [8.371278, 45.816047, 9.174333, 46.638618]},
  {code: "UR", name: "Uri", bounds: [8.394597, 46.522347, 8.9609, 46.995059]},
  {code: "VS", name: "Valais", bounds: [6.76686, 45.853976, 8.480974, 46.656104]},
  {code: "VD", name: "Vaud", bounds: [6.049433, 46.179489, 7.250355, 46.987579]},
  {code: "ZG", name: "Zug", bounds: [8.392282, 47.079641, 8.703393, 47.2485]},
  {code: "ZH", name: "Zurich", bounds: [8.35184, 47.1557, 8.995768, 47.697043]},
];

const WMO = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 61: "Light rain", 63: "Rain", 71: "Light snow", 80: "Showers", 95: "Thunder" };
export function wxCode(c) { return WMO[c] || "—"; }
export async function loadWeather(lat = 51.5074, lon = -0.1278, place = "London") {
  const q = new URL("https://api.open-meteo.com/v1/forecast");
  q.searchParams.set("latitude", lat);
  q.searchParams.set("longitude", lon);
  q.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
  q.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
  q.searchParams.set("timezone", "auto");
  q.searchParams.set("forecast_days", "7");
  const res = await fetch(q);
  if (!res.ok) throw new Error("open-meteo");
  return { place, data: await res.json() };
}

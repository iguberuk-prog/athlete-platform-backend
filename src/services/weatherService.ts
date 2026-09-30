/**
 * Loads forecasts for every ZIP an athlete's schedule touches, in parallel,
 * and packs them into a WeatherIndex the pure engines understand.
 * Never throws: missing ZIPs or a failed forecast just mean "no weather".
 */

import type { AthleteProfile } from "../domain/profile.js";
import { zipsNeeded, type WeatherIndex } from "../domain/weather.js";
import type { WeatherProvider } from "../weather/nws.js";

export async function loadWeather(
  provider: WeatherProvider | null,
  profile: AthleteProfile,
  from: string,
  days = 7,
): Promise<WeatherIndex | undefined> {
  if (!provider) return undefined;
  const zips = zipsNeeded(profile, from, days).slice(0, 6);
  if (!zips.length) return undefined;
  const results = await Promise.all(zips.map((z) => provider.forecast(z).catch(() => null)));
  const byZip: WeatherIndex["byZip"] = {};
  results.forEach((f, i) => { if (f) byZip[zips[i]] = { place: f.place, hours: f.hours, timeZone: f.timeZone, alerts: f.alerts }; });
  return Object.keys(byZip).length ? { byZip } : undefined;
}

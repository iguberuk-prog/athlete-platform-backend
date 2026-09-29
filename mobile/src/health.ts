/**
 * Apple Health (read-only): last night's sleep, resting heart rate and HRV.
 *
 * Only runs when the athlete taps "Fill from Apple Health" on the check-in
 * screen. We never write to Health, and the values only go into that day's
 * check-in. Apple does not tell apps whether read access was denied, so an
 * empty result simply means "nothing to fill".
 */
import { Platform } from "react-native";
import {
  isHealthDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  requestAuthorization,
  CategoryValueSleepAnalysis,
} from "@kingstinct/react-native-healthkit";

export interface HealthSnapshot {
  sleepHours?: number;
  restingHeartRate?: number;
  hrvMs?: number;
}

const READ = [
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
] as const;

export function healthAvailable(): boolean {
  try {
    return Platform.OS === "ios" && isHealthDataAvailable();
  } catch {
    return false;
  }
}

const ASLEEP = new Set<number>([
  CategoryValueSleepAnalysis.asleepUnspecified,
  CategoryValueSleepAnalysis.asleepCore,
  CategoryValueSleepAnalysis.asleepDeep,
  CategoryValueSleepAnalysis.asleepREM,
]);

/** Merge overlapping intervals (phone + watch both log sleep) and sum them. */
function totalHours(intervals: { s: number; e: number }[]): number {
  const sorted = intervals.filter((i) => i.e > i.s).sort((a, b) => a.s - b.s);
  let total = 0;
  let cur: { s: number; e: number } | null = null;
  for (const i of sorted) {
    if (!cur || i.s > cur.e) {
      if (cur) total += cur.e - cur.s;
      cur = { ...i };
    } else cur.e = Math.max(cur.e, i.e);
  }
  if (cur) total += cur.e - cur.s;
  return total / 3_600_000;
}

export async function readLastNight(): Promise<HealthSnapshot | null> {
  if (!healthAvailable()) return null;
  await requestAuthorization({ toRead: READ });

  const now = new Date();
  // "Last night" = 6 PM yesterday until now.
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 18, 0, 0);
  const out: HealthSnapshot = {};

  const sleep = await queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", {
    limit: 0,
    filter: { date: { startDate: start, endDate: now } },
  });
  const asleep = sleep.filter((s) => ASLEEP.has(Number(s.value)));
  const hours = totalHours(asleep.map((s) => ({ s: new Date(s.startDate).getTime(), e: new Date(s.endDate).getTime() })));
  if (hours > 0.5) out.sleepHours = Math.round(hours * 10) / 10;

  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const rhr = await queryQuantitySamples("HKQuantityTypeIdentifierRestingHeartRate", {
    limit: 1,
    ascending: false,
    unit: "count/min",
    filter: { date: { startDate: weekAgo, endDate: now } },
  });
  if (rhr[0]) out.restingHeartRate = Math.round(rhr[0].quantity);

  const hrv = await queryQuantitySamples("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", {
    limit: 1,
    ascending: false,
    unit: "ms",
    filter: { date: { startDate: weekAgo, endDate: now } },
  });
  if (hrv[0]) out.hrvMs = Math.round(hrv[0].quantity);

  return out;
}

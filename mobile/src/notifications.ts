/**
 * Local notifications for reminders.
 *
 * The web app sends the next 7 days of reminders (computed by the server from
 * the athlete's schedule and routine). We replace everything scheduled with
 * that list. Local notifications work offline and need no push server.
 * iOS keeps at most 64 pending notifications per app, so we schedule the
 * soonest 60.
 */
import * as Notifications from "expo-notifications";

export interface Reminder {
  id: string;
  at: string; // "YYYY-MM-DDTHH:MM" local wall-clock
  kind: string;
  title: string;
  body: string;
}

const MAX_PENDING = 60;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return status === "granted";
}

/** Parse "YYYY-MM-DDTHH:MM" as local time. */
function localDate(at: string): Date {
  const [d, t] = at.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  return new Date(y, m - 1, day, hh, mm, 0, 0);
}

export async function scheduleReminders(items: Reminder[], athleteName?: string): Promise<number> {
  if (!(await ensurePermission())) return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = Date.now() + 60_000;
  const upcoming = items
    .map((r) => ({ r, date: localDate(r.at) }))
    .filter((x) => x.date.getTime() > now)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, MAX_PENDING);
  for (const { r, date } of upcoming) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: {
        title: r.title,
        body: r.body,
        subtitle: athleteName,
        data: { route: r.kind === "checkin" ? "#/checkin" : "#/today", kind: r.kind },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
    });
  }
  return upcoming.length;
}

export async function clearReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

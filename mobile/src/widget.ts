/**
 * Writes the next-game countdown and emergency card for the iOS widgets
 * (App Group shared with targets/widget). No-ops where widgets aren't built.
 */
let storage: { set(k: string, v: string | undefined): void } | null = null;
let reload: (() => void) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const m = require("@bacons/apple-targets");
  storage = new m.ExtensionStorage("group.com.guberuk.athleteperformance");
  reload = () => m.ExtensionStorage.reloadWidget();
} catch {
  storage = null;
}

export interface WidgetData {
  next?: { title: string; at: string; eatBy?: string; tip?: string } | null;
  card?: { name: string; line: string } | null;
}

export function updateWidgets(d: WidgetData): void {
  if (!storage) return;
  const n = d.next;
  storage.set("next.title", n?.title);
  storage.set("next.at", n?.at);
  storage.set("next.eatBy", n?.eatBy);
  storage.set("next.tip", n?.tip);
  storage.set("card.name", d.card?.name);
  storage.set("card.line", d.card?.line);
  reload?.();
}

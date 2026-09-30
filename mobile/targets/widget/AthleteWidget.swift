import WidgetKit
import SwiftUI

// Data the app writes (App Group "group.com.guberuk.athleteperformance"):
//   next.title   "Game vs Hawks"
//   next.at      ISO time of kickoff/start
//   next.eatBy   "Eat by 6:30 AM" (optional)
//   next.tip     one short line
//   card.line    "Peanut allergy. EpiPen in bag. Asthma inhaler."
//   card.name    player first name
let GROUP = "group.com.guberuk.athleteperformance"

struct Entry: TimelineEntry {
  let date: Date
  let title: String
  let at: Date?
  let eatBy: String
  let tip: String
  let card: String
  let name: String
}

func readEntry(_ now: Date) -> Entry {
  let d = UserDefaults(suiteName: GROUP)
  let iso = ISO8601DateFormatter()
  iso.formatOptions = [.withInternetDateTime]
  let at = (d?.string(forKey: "next.at")).flatMap { iso.date(from: $0) }
  return Entry(date: now,
               title: d?.string(forKey: "next.title") ?? "No game scheduled",
               at: at,
               eatBy: d?.string(forKey: "next.eatBy") ?? "",
               tip: d?.string(forKey: "next.tip") ?? "",
               card: d?.string(forKey: "card.line") ?? "",
               name: d?.string(forKey: "card.name") ?? "")
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry {
    Entry(date: .now, title: "Game vs Hawks", at: .now.addingTimeInterval(3 * 3600), eatBy: "Eat now", tip: "Carbs and water", card: "", name: "")
  }
  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(readEntry(.now)) }
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let e = readEntry(.now)
    // Refresh every 15 minutes so "eat now" style tips stay current.
    completion(Timeline(entries: [e], policy: .after(.now.addingTimeInterval(15 * 60))))
  }
}

struct CountdownView: View {
  @Environment(\.widgetFamily) var family
  let e: Entry
  var body: some View {
    switch family {
    case .accessoryInline:
      if let at = e.at { Text("\(e.title) in \(at, style: .relative)") } else { Text(e.title) }
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text(e.title).font(.headline).lineLimit(1)
        if let at = e.at { Text(at, style: .relative).font(.caption) }
        if !e.eatBy.isEmpty { Text(e.eatBy).font(.caption2).lineLimit(1) }
      }
    default:
      VStack(alignment: .leading, spacing: 6) {
        Text("NEXT UP").font(.caption2).foregroundStyle(Color("$accent"))
        Text(e.title).font(.headline).lineLimit(2)
        if let at = e.at { Text(at, style: .relative).font(.title2).bold().monospacedDigit() }
        if !e.eatBy.isEmpty { Text(e.eatBy).font(.caption).lineLimit(1) }
        if !e.tip.isEmpty { Text(e.tip).font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
      }
    }
  }
}

struct EmergencyView: View {
  let e: Entry
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("\(e.name) · EMERGENCY").font(.caption2).bold()
      Text(e.card.isEmpty ? "Open the app to set up the emergency card." : e.card).font(.caption).lineLimit(3)
    }
  }
}

struct CountdownWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "countdown", provider: Provider()) { e in
      CountdownView(e: e).containerBackground(Color("$widgetBackground"), for: .widget)
    }
    .configurationDisplayName("Game countdown")
    .description("Time to your next game or practice, and when to eat.")
    .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline])
  }
}

struct EmergencyWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "emergency", provider: Provider()) { e in
      EmergencyView(e: e).containerBackground(Color("$widgetBackground"), for: .widget)
    }
    .configurationDisplayName("Emergency card")
    .description("Allergies, EpiPen and asthma on your lock screen.")
    .supportedFamilies([.accessoryRectangular, .systemSmall])
  }
}

@main
struct AthleteWidgets: WidgetBundle {
  var body: some Widget {
    CountdownWidget()
    EmergencyWidget()
  }
}

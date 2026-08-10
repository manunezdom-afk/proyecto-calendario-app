import WidgetKit
import SwiftUI

// Widget "Mi Día" — muestra los próximos eventos de hoy en el home screen.
//
// Datos: la app escribe un snapshot JSON liviano en el App Group
// (`group.me.usefocus.app`, key `widget.events.v1`) cada vez que cambian
// los eventos (ver FocusDataStore.syncWidgetSnapshot). El widget NO toca
// Supabase ni EventKit — solo lee el snapshot. Si no hay datos, muestra
// un empty state amable.

private let appGroupId = "group.me.usefocus.app"
private let snapshotKey = "widget.events.v1"

struct WidgetEvent: Identifiable {
    let id = UUID()
    let title: String
    let start: Date
    let end: Date?
    let colorHex: String

    var color: Color { Color(hex: colorHex) ?? .blue }
}

extension Color {
    init?(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6, let v = UInt64(h, radix: 16) else { return nil }
        self.init(
            red: Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8) & 0xFF) / 255,
            blue: Double(v & 0xFF) / 255
        )
    }
}

// MARK: - Snapshot loading

private func loadEvents() -> [WidgetEvent] {
    guard let defaults = UserDefaults(suiteName: appGroupId),
          let data = defaults.data(forKey: snapshotKey),
          let raw = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
        return []
    }
    return raw.compactMap { item in
        guard let title = item["t"] as? String,
              let startEpoch = item["s"] as? Double else { return nil }
        let endEpoch = item["e"] as? Double
        return WidgetEvent(
            title: title,
            start: Date(timeIntervalSince1970: startEpoch),
            end: endEpoch.map { Date(timeIntervalSince1970: $0) },
            colorHex: (item["c"] as? String) ?? "3B82F6"
        )
    }
}

// MARK: - Timeline

struct FocusEntry: TimelineEntry {
    let date: Date
    let events: [WidgetEvent]
}

struct FocusProvider: TimelineProvider {
    func placeholder(in context: Context) -> FocusEntry {
        FocusEntry(date: Date(), events: [
            WidgetEvent(title: "Reunión con Ana", start: Date().addingTimeInterval(1800), end: nil, colorHex: "3B82F6"),
            WidgetEvent(title: "Bloque de foco", start: Date().addingTimeInterval(7200), end: nil, colorHex: "7C6BFF"),
        ])
    }

    func getSnapshot(in context: Context, completion: @escaping (FocusEntry) -> Void) {
        completion(FocusEntry(date: Date(), events: upcoming(loadEvents())))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FocusEntry>) -> Void) {
        let events = upcoming(loadEvents())
        let entry = FocusEntry(date: Date(), events: events)
        // Refrescar cuando arranca el próximo evento (su fila pasa de
        // "próximo" a vencida) o en 15 min — lo que ocurra primero.
        let nextStart = events.first?.start
        let refresh = min(nextStart ?? .distantFuture, Date().addingTimeInterval(15 * 60))
        completion(Timeline(entries: [entry], policy: .after(max(refresh, Date().addingTimeInterval(60)))))
    }

    /// Eventos de hoy que aún no terminaron, ordenados, tope 6.
    private func upcoming(_ all: [WidgetEvent]) -> [WidgetEvent] {
        let now = Date()
        let cal = Calendar.current
        return all
            .filter { cal.isDateInToday($0.start) && ($0.end ?? $0.start) >= now }
            .sorted { $0.start < $1.start }
            .prefix(6)
            .map { $0 }
    }
}

// MARK: - Views

struct FocusTodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FocusTodayWidget", provider: FocusProvider()) { entry in
            FocusWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    LinearGradient(
                        colors: [
                            Color(red: 0.231, green: 0.510, blue: 0.965),
                            Color(red: 0.145, green: 0.388, blue: 0.922),
                            Color(red: 0.094, green: 0.184, blue: 0.510),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                }
        }
        .configurationDisplayName("Mi Día")
        .description("Tus próximos eventos de hoy, de un vistazo.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct FocusWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FocusEntry

    private var timeFormatter: DateFormatter {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f
    }

    var body: some View {
        if entry.events.isEmpty {
            emptyState
        } else if family == .systemSmall {
            smallView
        } else {
            mediumView
        }
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Image(systemName: "sun.max.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white.opacity(0.9))
            Text("Día libre")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)
            Text("Todo tuyo.")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.7))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var smallView: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("PRÓXIMO")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .tracking(1.0)
                .foregroundStyle(.white.opacity(0.65))
            if let first = entry.events.first {
                Text(timeFormatter.string(from: first.start))
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text(first.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.95))
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            if entry.events.count > 1 {
                Text("+\(entry.events.count - 1) más hoy")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.65))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var mediumView: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text("MI DÍA")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .tracking(1.2)
                    .foregroundStyle(.white.opacity(0.65))
                Spacer()
                Image(systemName: "viewfinder")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white.opacity(0.65))
            }
            ForEach(entry.events.prefix(3)) { event in
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(event.color)
                        .frame(width: 3, height: 24)
                        .overlay(RoundedRectangle(cornerRadius: 1.5).fill(.white.opacity(0.35)))
                    Text(timeFormatter.string(from: event.start))
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.9))
                        .frame(width: 40, alignment: .leading)
                    Text(event.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

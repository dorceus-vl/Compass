import SwiftUI
import WidgetKit

/// The Lock Screen widgets: inline (counts), circular (done today) and rectangular (the next task). Anyone can glance at a Lock Screen, so a work
/// title shows as "Work task" while `lock.hide_work` is on; Offline-only tasks are never named anywhere. System vibrant rendering, no Compass colours.
struct LockWidgets: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CompassLock", provider: SnapProvider()) { entry in
            LockEntryView(entry: entry)
        }
        .configurationDisplayName("Compass")
        .description("Today's counts and the next task, on the Lock Screen.")
        .supportedFamilies([.accessoryInline, .accessoryCircular, .accessoryRectangular])
    }
}

struct LockEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapEntry
    var body: some View {
        // The midnight entry before the app writes again: yesterday's counts aren't today's, so the widgets say so instead.
        let snap = entry.snap.flatMap { $0.isStale(entry.date) ? nil : $0 }
        if entry.snap != nil && snap == nil {
            Group {
                if family == .accessoryCircular { Image(systemName: "arrow.clockwise") } else { Text("Open Compass to update") }
            }
            .accessibilityLabel("Open Compass to update")
            .containerBackground(for: .widget) { family == .accessoryCircular ? AnyView(AccessoryWidgetBackground()) : AnyView(Color.clear) }
            .widgetURL(CompassURL.today)
        } else {
            entryBody(snap)
        }
    }

    @ViewBuilder private func entryBody(_ snap: Snapshot?) -> some View {
        switch family {
        case .accessoryCircular: LockCircular(s: snap).containerBackground(for: .widget) { AccessoryWidgetBackground() }.widgetURL(CompassURL.today)
        case .accessoryRectangular:
            LockRectangular(s: snap).containerBackground(for: .widget) { Color.clear }
                .widgetURL(snap?.today.next.map { CompassURL.task($0.id) } ?? CompassURL.today)
        default: LockInline(s: snap).containerBackground(for: .widget) { Color.clear }.widgetURL(CompassURL.today)
        }
    }
}

struct LockInline: View {
    let s: Snapshot?
    var body: some View {
        if let t = s?.today {
            Text(t.due == 0 ? "Nothing due today" : "\(t.due) due" + (t.late > 0 ? " · \(t.late) late" : ""))
        } else {
            Text("Open Compass once")
        }
    }
}

struct LockCircular: View {
    let s: Snapshot?
    var body: some View {
        if let t = s?.today {
            Gauge(value: Double(t.done), in: 0...Double(max(t.total, 1))) { Text("Done") } currentValueLabel: { Text("\(t.done)/\(t.total)") }
                .gaugeStyle(.accessoryCircularCapacity)
                .widgetAccentable()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(t.done) of \(t.total) done today")
        } else {
            Image(systemName: "checklist").accessibilityLabel("Open Compass once to fill this widget")
        }
    }
}

struct LockRectangular: View {
    let s: Snapshot?
    var body: some View {
        if let s {
            let t = s.today
            VStack(alignment: .leading, spacing: 1) {
                if let n = t.next {
                    Text("Next · \(n.dueLabel)").font(.headline).widgetAccentable().lineLimit(1)
                    Text(n.shown(lock: true, hideWork: s.lock.hideWork)).lineLimit(1)
                    Text(lateLine(t) + (s.lock.hideWork && n.work && !n.offline ? " · titles hidden" : "")).opacity(0.75).lineLimit(1)
                } else {
                    Text("Today").font(.headline).widgetAccentable()
                    Text("Nothing due")
                    if t.done > 0 { Text("\(t.done) done").opacity(0.75) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        } else {
            Text("Open Compass once to fill this widget").font(.caption)
        }
    }
    private func lateLine(_ t: Snapshot.Today) -> String { t.late > 0 ? "\(t.late) late" : "\(t.due) due today" }
}

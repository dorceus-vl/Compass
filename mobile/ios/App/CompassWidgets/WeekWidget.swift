import SwiftUI
import WidgetKit

/// This week (iPad, extra large): open tasks with ticks, the active projects with RAG and % done, and the week as a strip of days with a bar
/// per task in its horizon's colour. A tap opens Today; a task opens the task (W4).
struct WeekWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CompassWeek", provider: SnapProvider()) { entry in
            WeekView(snap: entry.snap, now: entry.date).compassBackground().widgetURL(CompassURL.today)
        }
        .configurationDisplayName("This week")
        .description("Open tasks, the week by day, and your projects.")
        .supportedFamilies([.systemExtraLarge])
    }
}

struct WeekView: View {
    let snap: Snapshot?; let now: Date
    var body: some View {
        if let s = snap {
            let today = Snapshot.ymd(now, tz: s.tz)
            VStack(alignment: .leading, spacing: 8) {
                Head(title: "This week · \(s.weekOpen) open")
                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        if s.items.isEmpty { Text("Nothing open. The week is yours.").font(.system(size: 12)).foregroundStyle(Theme.dim) }
                        ForEach(s.items.prefix(5)) { TaskRow(item: $0, hide: s.hides($0)) }
                        if !s.projects.isEmpty {
                            GroupLabel(text: "Projects").padding(.top, 4)
                            ForEach(s.projects.prefix(4)) { ProjectRow(p: $0, hide: s.hides($0)) }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    HStack(alignment: .top, spacing: 4) {
                        ForEach(s.week, id: \.day) { d in DayCell(d: d, today: d.day == today, items: Array(s.items(on: d.day).prefix(2)), hide: s.hides) }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        } else {
            Placeholder()
        }
    }
}

struct ProjectRow: View {
    let p: Snapshot.Project; var hide = false
    var body: some View {
        Link(destination: CompassURL.dashboard(p.id)) {
            HStack(spacing: 8) {
                Circle().fill(Theme.rag(p.rag)).frame(width: 8, height: 8)
                Text(p.shownName).foregroundStyle(p.offline ? Theme.dim : Theme.text).lineLimit(1).privacySensitive(hide)
                Spacer(minLength: 4)
                Text("\(p.pct)%").font(Theme.label(10)).foregroundStyle(Theme.faint)
            }
            .font(.system(size: 11.5))
        }
        .frame(height: 20)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(p.shownName), \(p.rag == "none" ? "no RAG" : p.rag), \(p.pct)% done")
    }
}

/// A day: one bar per open task in its horizon's colour, then up to two of its titles (the same rules as a task row).
struct DayCell: View {
    let d: Snapshot.Day; let today: Bool; let items: [Snapshot.Item]; let hide: (Snapshot.Item) -> Bool
    private static let maxBars = 8
    var body: some View {
        let bars = Array(repeating: Theme.short, count: d.short) + Array(repeating: Theme.medium, count: d.medium) + Array(repeating: Theme.long, count: d.long)
        VStack(alignment: .leading, spacing: 3) {
            Text(Snapshot.weekday(d.day).uppercased()).font(Theme.label(9)).foregroundStyle(today ? Theme.accent : Theme.faint)
            ForEach(Array(bars.prefix(Self.maxBars).enumerated()), id: \.offset) { RoundedRectangle(cornerRadius: 2).fill($0.element).frame(height: 4) }
            if bars.count > Self.maxBars { Text("+\(bars.count - Self.maxBars)").font(Theme.label(9)).foregroundStyle(Theme.faint) }
            ForEach(items) { it in
                Text(it.shown(lock: false, hideWork: false)).font(.system(size: 10)).lineLimit(2)
                    .foregroundStyle(it.offline ? Theme.faint : Theme.dim).privacySensitive(hide(it)).padding(.top, 3)
            }
        }
        .padding(5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(today ? Theme.accent : .clear, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Snapshot.weekday(d.day))\(today ? ", today" : ""): \(d.total) task\(d.total == 1 ? "" : "s")")
    }
}

import SwiftUI
import WidgetKit

/// Today, as in docs/widgets-preview.html: small (counts and the next task), medium (three tasks with ticks and the done ring),
/// large (by horizon, Blocked, the next milestone). v2.5: running timers lead medium and large (elapsed, Stop), and each task row has Start or Stop. A tap opens Today; a task's title opens the task (W4).
struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CompassToday", provider: SnapProvider()) { entry in
            TodayEntryView(entry: entry).compassBackground().widgetURL(CompassURL.today)
        }
        .configurationDisplayName("Today")
        .description("What's due today, with a tick to mark tasks done.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct TodayEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapEntry
    var body: some View {
        if let s = entry.snap {
            switch family {
            case .systemSmall: TodaySmall(s: s, now: entry.date)
            case .systemLarge: TodayLarge(s: s, now: entry.date)
            default: TodayMedium(s: s, now: entry.date)
            }
        } else {
            Placeholder()
        }
    }
}

/// "Today · Tue Oct 21", or a nudge when the snapshot is from another day (the midnight entry, before the app writes again).
func todayHead(_ s: Snapshot, _ now: Date, _ rest: String? = nil) -> String {
    s.isStale(now) ? "Today · open Compass to update" : "Today · " + (rest ?? Snapshot.header(now, tz: s.tz))
}

func doneRing(_ t: Snapshot.Today, size: CGFloat = 46) -> some View {
    Ring(value: t.total > 0 ? Double(t.done) / Double(t.total) : 0, label: "\(t.done)/\(t.total)", size: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(t.done) of \(t.total) done today")
}

struct TodaySmall: View {
    let s: Snapshot; let now: Date
    var body: some View {
        let t = s.today
        if s.isStale(now) {
            VStack(alignment: .leading, spacing: 6) {
                Head(title: "Today")
                Spacer(minLength: 0)
                Text("Open Compass to update").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        } else {
        VStack(alignment: .leading, spacing: 2) {
            Head(title: "Today")
            Text("\(t.due)").font(.system(size: 34, weight: .heavy)).tracking(-1).foregroundStyle(Theme.text)
            (Text("due") + (t.late > 0 ? Text(" · ") + Text("\(t.late) late").foregroundColor(Theme.danger) : Text("")))
                .font(.system(size: 11)).foregroundStyle(Theme.dim)
            Spacer(minLength: 0)
            Text("NEXT").font(Theme.label(10)).foregroundStyle(Theme.faint)
            Text(t.next?.shown(lock: false, hideWork: false) ?? "Nothing else due")
                .font(.system(size: 12)).foregroundStyle(t.next?.offline == true ? Theme.dim : Theme.text).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                .privacySensitive(t.next.map(s.hides) ?? false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Today: \(t.due) due, \(t.late) late. Next: \((t.next.map(s.hides) ?? false) ? "a work task" : (t.next?.shown(lock: false, hideWork: false) ?? "nothing"))")
        }
    }
}

struct TodayMedium: View {
    let s: Snapshot; let now: Date
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Head(title: todayHead(s, now))
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    // v2.5: the newest running timer takes the first of the three rows.
                    let timers = Array(s.running.prefix(1))
                    ForEach(timers) { TimerRow(timer: $0, hide: s.hides($0), height: 32) }
                    if s.items.isEmpty && timers.isEmpty { Text("Nothing due. The day is yours.").font(.system(size: 12)).foregroundStyle(Theme.dim) }
                    ForEach(s.items.prefix(3 - timers.count)) { TaskRow(item: $0, hide: s.hides($0), timer: true, height: 32) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(spacing: 4) {
                    doneRing(s.today)
                    Text("done").font(.system(size: 11)).foregroundStyle(Theme.dim).accessibilityHidden(true)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

struct TodayLarge: View {
    let s: Snapshot; let now: Date
    /// Rows by horizon, short first, within what a large widget holds (one fewer when the Blocked line shows).
    /// v2.5: up to two running timers lead, each taking a task row.
    private var timers: [Snapshot.RunningTimer] { Array(s.running.prefix(2)) }
    private var groups: [(String, [Snapshot.Item])] {
        var left = (s.blocked > 0 ? 6 : 7) - timers.count
        return [("Short", s.horizons.short), ("Medium", s.horizons.medium), ("Long", s.horizons.long)].compactMap { name, list in
            let take = Array(list.prefix(left)); left -= take.count
            return take.isEmpty ? nil : (name, take)
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Head(title: todayHead(s, now, "\(s.today.due) due"))
            if !timers.isEmpty {
                GroupLabel(text: timers.count == 1 ? "Timer" : "Timers")
                ForEach(timers) { TimerRow(timer: $0, hide: s.hides($0)) }
            }
            if groups.isEmpty && s.blocked == 0 && timers.isEmpty { Text("Nothing due. The day is yours.").font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 6) }
            ForEach(groups, id: \.0) { name, list in
                GroupLabel(text: name)
                ForEach(list) { TaskRow(item: $0, hide: s.hides($0), timer: true) }
            }
            if s.blocked > 0 {
                GroupLabel(text: "Blocked (\(s.blocked))")
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 2).fill(Theme.long).frame(width: 3)
                    Text(s.blocked == 1 ? "1 task waits on another task" : "\(s.blocked) tasks wait on other tasks").font(.system(size: 12)).lineLimit(1)
                }
                .frame(height: 20).opacity(0.6)
                .accessibilityElement(children: .ignore).accessibilityLabel("Blocked: \(s.blocked) waiting on other tasks")
            }
            Spacer(minLength: 0)
            if let f = s.footerMilestone {
                let m = f.milestone
                Divider().overlay(Theme.border)
                Text("NEXT MILESTONE").font(Theme.label(10)).foregroundStyle(Theme.faint)
                (Text(m.name ?? "") + Text(m.lateDays > 0 ? " · " : "") + Text(m.lateDays > 0 ? "\(m.lateDays) day\(m.lateDays == 1 ? "" : "s") late" : "").foregroundColor(Theme.warn))
                    .font(.system(size: 12)).foregroundStyle(Theme.text).lineLimit(1).privacySensitive(s.hides(f.project))
            }
        }
    }
}

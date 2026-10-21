import SwiftUI
import WidgetKit

/// Compass's widgets (v2.3): they read only the snapshot the app writes into the App Group (W1, W2) and make no network call to read.
@main
struct CompassWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        QuickAddWidget()
        AskAthenaWidget()
        ProjectPulseWidget()
        LockWidgets()
        WeekWidget()
    }
}

struct SnapEntry: TimelineEntry {
    let date: Date
    let snap: Snapshot?
    var projectId: String? = nil
}

/// W3: the file as it is now, then one more entry at local midnight so "Today" rolls over; WidgetKit asks again after 15 minutes
/// (and at once after the app writes or a tick).
func compassTimeline(_ snap: Snapshot?, projectId: String? = nil, now: Date = Date()) -> Timeline<SnapEntry> {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = snap.map { Snapshot.zone($0.tz) } ?? .current
    let midnight = cal.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0, second: 0), matchingPolicy: .nextTime) ?? now.addingTimeInterval(86_400)
    return Timeline(entries: [SnapEntry(date: now, snap: snap, projectId: projectId), SnapEntry(date: midnight, snap: snap, projectId: projectId)],
                    policy: .after(now.addingTimeInterval(15 * 60)))
}

struct SnapProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapEntry { SnapEntry(date: Date(), snap: nil) }
    func getSnapshot(in context: Context, completion: @escaping (SnapEntry) -> Void) { completion(SnapEntry(date: Date(), snap: Snapshot.load())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapEntry>) -> Void) { completion(compassTimeline(Snapshot.load())) }
}

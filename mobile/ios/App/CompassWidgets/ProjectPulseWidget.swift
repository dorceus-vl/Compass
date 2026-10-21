import SwiftUI
import WidgetKit

/// Project pulse (medium): the picked project's RAG, % done, next milestone, slip against the baseline, high risks and overdue count.
/// A tap opens the project's Dashboard (W4).
struct ProjectPulseWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "CompassPulse", intent: PickProjectIntent.self, provider: PulseProvider()) { entry in
            PulseView(snap: entry.snap, projectId: entry.projectId).compassBackground()
                .widgetURL(entry.projectId.map(CompassURL.dashboard) ?? CompassURL.today)
        }
        .configurationDisplayName("Project pulse")
        .description("One project's RAG, progress, next milestone and risks.")
        .supportedFamilies([.systemMedium])
    }
}

struct PulseProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> SnapEntry { SnapEntry(date: Date(), snap: nil) }
    func snapshot(for configuration: PickProjectIntent, in context: Context) async -> SnapEntry {
        let s = Snapshot.load()
        return SnapEntry(date: Date(), snap: s, projectId: configuration.project?.id ?? s?.projects.first?.id)
    }
    func timeline(for configuration: PickProjectIntent, in context: Context) async -> Timeline<SnapEntry> {
        let s = Snapshot.load()
        return compassTimeline(s, projectId: configuration.project?.id ?? s?.projects.first?.id)
    }
}

struct PulseView: View {
    let snap: Snapshot?; let projectId: String?
    var body: some View {
        if let s = snap, let p = s.projects.first(where: { $0.id == projectId }) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Text(p.shownName.uppercased()).font(Theme.label(9.5)).tracking(1.4).foregroundStyle(Theme.faint).lineLimit(1).privacySensitive(s.hides(p))
                    Spacer(minLength: 4)
                    if p.rag != "none" {
                        Text(p.rag.uppercased()).font(Theme.label(9.5)).tracking(0.6).foregroundStyle(Theme.rag(p.rag))
                            .padding(.horizontal, 7).padding(.vertical, 1)
                            .overlay(Capsule().strokeBorder(Theme.rag(p.rag).opacity(0.4)))
                    }
                }
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 5) {
                        milestone(p).privacySensitive(s.hides(p))
                        Text(slip(p.slipDays))
                        Text(p.highRisks.map { "\($0) high risk\($0 == 1 ? "" : "s") · " } ?? "") + Text("\(p.overdue) overdue")
                    }
                    .font(.system(size: 11)).foregroundStyle(Theme.dim).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Ring(value: Double(p.pct) / 100, label: "\(p.pct)%", size: 56)
                        .accessibilityElement(children: .ignore).accessibilityLabel("\(p.pct)% done")
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
        } else if snap != nil {
            Text("Hold the widget, then Edit Widget to pick a project")
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Placeholder()
        }
    }

    private func milestone(_ p: Snapshot.Project) -> Text {
        guard let m = p.nextMilestone else { return Text("No open milestone") }
        let late = m.lateDays > 0 ? Text(" · \(m.lateDays)d late").foregroundColor(Theme.warn) : Text("")
        guard let name = m.name, !p.offline else { return Text("Next milestone") + late }
        return Text("Next: ") + Text(name).bold().foregroundColor(Theme.text) + late
    }

    private func slip(_ days: Int?) -> String {
        guard let d = days else { return "No baseline yet" }
        if d == 0 { return "On the baseline" }
        return d > 0 ? "\(d) day\(d == 1 ? "" : "s") later than the baseline" : "\(-d) day\(d == -1 ? "" : "s") ahead of the baseline"
    }
}

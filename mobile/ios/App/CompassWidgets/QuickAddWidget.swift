import SwiftUI
import WidgetKit

/// Quick add (small): one tap target, the whole widget opens the quick-add box (W4, W11: a small widget has only its `widgetURL`).
/// It shows no data, so it needs no snapshot.
struct QuickAddWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CompassQuickAdd", provider: SnapProvider()) { _ in
            QuickAddView().compassBackground().widgetURL(CompassURL.quickAdd)
        }
        .configurationDisplayName("Quick add")
        .description("Add a task in one tap.")
        .supportedFamilies([.systemSmall])
    }
}

/// Ask Athena (small, W11): its own widget, since a small widget can't hold two links. The whole widget opens Athena. No data shown.
struct AskAthenaWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CompassAskAthena", provider: SnapProvider()) { _ in
            AskAthenaView().compassBackground().widgetURL(CompassURL.athena)
        }
        .configurationDisplayName("Ask Athena")
        .description("Open Athena, Compass's copilot, in one tap.")
        .supportedFamilies([.systemSmall])
    }
}

struct QuickAddView: View {
    var body: some View {
        VStack(spacing: 2) {
            Text("+").font(.system(size: 34, weight: .semibold))
            Text("Add a task").font(.system(size: 14, weight: .heavy))
        }
        .foregroundStyle(Theme.onAccent)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Add a task")
    }
}

struct AskAthenaView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Head(title: "Athena")
            Spacer(minLength: 0)
            Text("Ask Athena…").font(.system(size: 13)).foregroundStyle(Theme.dim)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).padding(.vertical, 9)
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Ask Athena")
    }
}

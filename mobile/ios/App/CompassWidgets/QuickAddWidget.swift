import SwiftUI
import WidgetKit

/// Quick add (small): "Add a task" opens the quick-add box, "Ask Athena…" opens Athena (W4). It shows no data, so it needs no snapshot.
struct QuickAddWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CompassQuickAdd", provider: SnapProvider()) { _ in
            QuickAddView().compassBackground().widgetURL(CompassURL.quickAdd)
        }
        .configurationDisplayName("Quick add")
        .description("Add a task or ask Athena in one tap.")
        .supportedFamilies([.systemSmall])
    }
}

struct QuickAddView: View {
    var body: some View {
        VStack(spacing: 8) {
            Link(destination: CompassURL.quickAdd) {
                VStack(spacing: 2) {
                    Text("+").font(.system(size: 30, weight: .semibold))
                    Text("Add a task").font(.system(size: 13, weight: .heavy))
                }
                .foregroundStyle(Theme.onAccent)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .accessibilityLabel("Add a task")
            Link(destination: CompassURL.athena) {
                Text("Ask Athena…").font(.system(size: 11)).foregroundStyle(Theme.dim)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 9).padding(.vertical, 7)
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border))
            }
            .accessibilityLabel("Ask Athena")
        }
    }
}

import SwiftUI
import WidgetKit

/// Compass's tokens for the widgets (W7): hex values copied exactly from assets/brand/DESIGN.md. Dark only, like the app. Widgets can't load
/// Google Fonts, so text is the system font (headings heavy, as Inter 800) and labels SF Mono (for IBM Plex Mono). The Lock Screen views use
/// none of these: they take the system's vibrant rendering.
enum Theme {
    static let bg = Color(hex: 0x050507)        // --bg
    static let panel = Color(hex: 0x0B0B10)     // --panel
    static let field = Color(hex: 0x131319)     // --field
    static let border = Color.white.opacity(0.09) // --field-border rgba(255,255,255,.09)
    static let text = Color(hex: 0xF2F1F7)      // --text
    static let dim = Color(hex: 0xA9A7B8)       // --text-dim
    static let faint = Color(hex: 0x8A8899)     // --text-faint
    static let accent = Color(hex: 0xEDE3C9)    // --accent (Compass Ivory)
    static let onAccent = Color(hex: 0x1A1608)  // --on-accent
    static let ok = Color(hex: 0x5CC98B)        // --ok
    static let warn = Color(hex: 0xE39A62)      // --warn
    static let danger = Color(hex: 0xE0606C)    // --danger
    static let short = Color(hex: 0xDDB46E)     // --h-short
    static let medium = Color(hex: 0x7DB4AC)    // --h-medium
    static let long = Color(hex: 0x9D95C6)      // --h-long

    static func horizon(_ h: String) -> Color { h == "short" ? short : h == "medium" ? medium : long }
    static func rag(_ r: String) -> Color { r == "green" ? ok : r == "amber" ? warn : r == "red" ? danger : faint }
    static func label(_ size: CGFloat) -> Font { .system(size: size, weight: .medium, design: .monospaced) }
}

extension Color {
    init(hex: UInt32) { self.init(.sRGB, red: Double(hex >> 16 & 0xFF) / 255, green: Double(hex >> 8 & 0xFF) / 255, blue: Double(hex & 0xFF) / 255) }
}

// MARK: pieces every Home Screen widget shares

/// The small-caps head: "TODAY · TUE OCT 21" and the ivory ring standing in for the badge.
struct Head: View {
    let title: String
    var body: some View {
        HStack(spacing: 6) {
            Text(title.uppercased()).font(Theme.label(9.5)).tracking(1.4).foregroundStyle(Theme.faint).lineLimit(1)
            Spacer(minLength: 4)
            Circle().strokeBorder(Theme.accent, lineWidth: 1.5).frame(width: 14, height: 14).accessibilityHidden(true)
        }
    }
}

struct GroupLabel: View {
    let text: String
    var body: some View { Text(text.uppercased()).font(Theme.label(9)).tracking(1.4).foregroundStyle(Theme.faint).padding(.top, 2) }
}

/// A ring of `value` (0...1) with its label inside.
struct Ring: View {
    let value: Double; let label: String; var size: CGFloat = 46
    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.1), lineWidth: 5)
            Circle().trim(from: 0, to: max(0, min(1, value))).stroke(Theme.accent, style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(-90))
            Text(label).font(Theme.label(10)).foregroundStyle(Theme.text).minimumScaleFactor(0.7)
        }
        .frame(width: size, height: size)
    }
}

/// One task: its horizon bar, the tick circle (an App Intent, iOS 17), and its title and due label, which open the task.
struct TaskRow: View {
    let item: Snapshot.Item
    var tick = true
    var body: some View {
        let name = item.shown(lock: false, hideWork: false)
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2).fill(Theme.horizon(item.horizon)).frame(width: 3).accessibilityHidden(true)
            if tick {
                Button(intent: MarkDoneIntent(taskId: item.id)) {
                    Circle().strokeBorder(Theme.dim, lineWidth: 1.5).frame(width: 16, height: 16).frame(width: 24, height: 22).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mark done: \(name)")
            }
            Link(destination: CompassURL.task(item.id)) {
                HStack(spacing: 6) {
                    Text(name).foregroundStyle(item.title == nil || item.offline ? Theme.dim : Theme.text).lineLimit(1)
                    Spacer(minLength: 4)
                    Text(item.dueLabel).font(Theme.label(10)).foregroundStyle(item.late ? Theme.danger : Theme.faint).lineLimit(1)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(name), \(item.late ? "late, " : "")\(item.dueLabel)")
        }
        .font(.system(size: 12))
        .frame(height: 22)
    }
}

/// No snapshot yet (never opened, signed out, or before the first unlock since boot).
struct Placeholder: View {
    var body: some View {
        Text("Open Compass once to fill this widget")
            .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim).multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension View {
    /// The dark panel every Home Screen widget sits on.
    func compassBackground() -> some View { containerBackground(Theme.panel, for: .widget) }
}

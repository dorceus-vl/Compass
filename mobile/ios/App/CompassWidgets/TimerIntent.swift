import AppIntents
import WidgetKit

/// Start or Stop on the Today widget (v2.5, T8): the twin of MarkDoneIntent. The change shows at once (the snapshot file is rewritten) and the action is queued
/// in `pending-ticks.json` with its `action`. Then the intent posts `{action, at}` to `/api/widget/tasks/:id/timer` with the Keychain token through the same
/// ephemeral, cookie-less session as a tick; only a 200 drops the queued action. With no token, or on any failure, it stays queued for the app (`takeWidgetTicks`).
struct TimerIntent: AppIntent {
    static var title: LocalizedStringResource = "Start or stop a task's timer"
    static var isDiscoverable = false

    @Parameter(title: "Task") var taskId: String
    @Parameter(title: "Action") var action: String

    init() {}
    init(taskId: String, action: String) { self.taskId = taskId; self.action = action }

    func perform() async throws -> some IntentResult {
        _ = await Self.run(taskId, action)
        return .result()
    }

    /// true once the server has it (200); false = queued for the app, or a bad action. Siri's "Start focus" says which.
    static func run(_ id: String, _ act: String) async -> Bool {
        let now = Date(), at = Snapshot.iso(now)
        guard act == "start" || act == "stop", let dir = WidgetStore.container() else { return false }
        await withCheckedContinuation { done in WidgetStore.queue.async { WidgetStore.timer(id, action: act, at: now, in: dir); done.resume() } }
        WidgetCenter.shared.reloadAllTimelines()
        guard let token = WidgetStore.readToken(), let url = WidgetServer.timerURL(id, server: WidgetServer.configured(), allowLocal: isDebug),
              let body = WidgetServer.timerBody(act, at: at), await WidgetServer.post(url, token: token, body: body) else { return false }
        await withCheckedContinuation { done in WidgetStore.queue.async { try? WidgetStore.removeTick(id, action: act, at: at, in: dir); done.resume() } }
        return true
    }

    #if DEBUG
    private static var isDebug: Bool { true }
    #else
    private static var isDebug: Bool { false }
    #endif
}

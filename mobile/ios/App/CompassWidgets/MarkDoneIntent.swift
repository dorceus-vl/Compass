import AppIntents
import WidgetKit

/// The tick circle on the Today and Week widgets (W5). The task leaves the widget at once (optimistic) and the tick is queued in `pending-ticks.json`.
/// Then the intent posts it to `/api/widget/tasks/:id/done` with the Keychain token; once the server has it the queued tick is dropped. With no token, or on any
/// failure (offline, revoked, over the limit, 5xx, 8 seconds), it stays queued and the app sends it through its offline queue when it next opens (`takeWidgetTicks`).
struct MarkDoneIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark task done"
    static var isDiscoverable = false

    @Parameter(title: "Task") var taskId: String

    init() {}
    init(taskId: String) { self.taskId = taskId }

    func perform() async throws -> some IntentResult {
        let id = taskId
        guard let dir = WidgetStore.container() else { return .result() }
        await withCheckedContinuation { done in WidgetStore.queue.async { WidgetStore.tick(id, in: dir); done.resume() } }
        WidgetCenter.shared.reloadAllTimelines()
        if let token = WidgetStore.readToken(), let url = WidgetServer.doneURL(id, server: WidgetServer.configured(), allowLocal: isDebug), await WidgetServer.post(url, token: token) {
            await withCheckedContinuation { done in WidgetStore.queue.async { try? WidgetStore.removeTick(id, in: dir); done.resume() } }
        }
        return .result()
    }

    #if DEBUG
    private var isDebug: Bool { true }
    #else
    private var isDebug: Bool { false }
    #endif
}

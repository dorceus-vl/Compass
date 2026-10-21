import AppIntents
import WidgetKit

/// The tick circle on the Today and Week widgets (W5). This half is local and optimistic: the task leaves the widget at once and the tick is
/// queued in `pending-ticks.json`, which the app sends through its offline queue when it next opens (`takeWidgetTicks`).
/// Task 2 posts to `/api/widget/tasks/:id/done` first, with the Keychain token, and queues only on a failure.
struct MarkDoneIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark task done"
    static var isDiscoverable = false

    @Parameter(title: "Task") var taskId: String

    init() {}
    init(taskId: String) { self.taskId = taskId }

    func perform() async throws -> some IntentResult {
        if let dir = WidgetStore.container() { WidgetStore.queue.sync { WidgetStore.tick(taskId, in: dir) } }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

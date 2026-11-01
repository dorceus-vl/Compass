import AppIntents

/// Siri and Shortcuts: add a task, what's due today, start focus. Only the timer reaches the server, and only through TimerIntent (the Today
/// widget's Start: same token, queue and host rule). Due today and the task list read the widget snapshot in the app group, so they work
/// offline and never name more than a widget would; Siri can speak on a locked phone, so titles follow the Lock Screen rule.

/// "Add a task": Siri takes the words and Compass opens with quick add filled in (the Share Extension's path). Nothing is added until he
/// presses Add there, and quick add's own parsing applies ("nudge Acme wed #erp @work").
struct AddTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Add a task"
    static var description = IntentDescription("Opens Compass quick add with the task filled in.")
    static var openAppWhenRun = true

    @Parameter(title: "Task", requestValueDialog: "What's the task?") var text: String

    @MainActor
    func perform() async throws -> some IntentResult {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return .result() }
        SharedText.put(t)
        CompassOpen.shared.plugin?.becameActive() // already in front: hand it over now; on a cold start the plugin's load() takes it
        return .result()
    }
}

struct DueTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "What's due today"
    static var description = IntentDescription("Says what is due or late today, from the list the widgets show.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: "\(Snapshot.load()?.spokenDueToday() ?? "Open Compass to set up today's list.")")
    }
}

/// A task the snapshot lists (open, not blocked, soonest due first).
struct FocusTask: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Task"
    static var defaultQuery = FocusTaskQuery()
    let id: String
    let name: String
    let running: Bool
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct FocusTaskQuery: EntityQuery {
    static func all() -> [FocusTask] {
        guard let s = Snapshot.load(), s.atDay == Snapshot.ymd(Date(), tz: s.tz) else { return [] } // yesterday's list may hold done tasks
        return s.items.map { FocusTask(id: $0.id, name: $0.shown(lock: true, hideWork: s.lock.hideWork), running: $0.running) }
    }
    func entities(for identifiers: [String]) async throws -> [FocusTask] { Self.all().filter { identifiers.contains($0.id) } }
    func suggestedEntities() async throws -> [FocusTask] { Self.all().filter { !$0.running } }
}

/// "Start focus": starts the task's timer (there is no focus mode; v2.5 timers are the focus).
struct StartFocusIntent: AppIntent {
    static var title: LocalizedStringResource = "Start focus"
    static var description = IntentDescription("Starts the timer on a task.")

    @Parameter(title: "Task", requestValueDialog: "Which task?") var task: FocusTask

    func perform() async throws -> some IntentResult & ProvidesDialog {
        if Snapshot.load()?.items.first(where: { $0.id == task.id })?.running == true { return .result(dialog: "That timer is already running.") }
        if await TimerIntent.run(task.id, "start") { return .result(dialog: "Timer started: \(task.name).") }
        return .result(dialog: "Timer queued for \(task.name). It starts when Compass next reaches the server.")
    }
}

struct CompassShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddTaskIntent(), phrases: ["Add a task in \(.applicationName)", "Add to \(.applicationName)"],
                    shortTitle: "Add a task", systemImageName: "plus.circle")
        AppShortcut(intent: DueTodayIntent(), phrases: ["What's due today in \(.applicationName)", "What's due in \(.applicationName)"],
                    shortTitle: "Due today", systemImageName: "calendar")
        AppShortcut(intent: StartFocusIntent(), phrases: ["Start focus in \(.applicationName)", "Start a timer in \(.applicationName)"],
                    shortTitle: "Start focus", systemImageName: "timer")
    }
}

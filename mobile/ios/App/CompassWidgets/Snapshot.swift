import Foundation

/// The widget snapshot (v2.3, W1), as `shared/widget-snapshot.ts` writes it into the App Group. Plain Foundation, so `mobile/test-swift.sh`
/// checks it with the Swift compiler alone. Every field is modelled, so a tick writes the file back whole. A missing or unreadable file, or
/// another version, is nil: the widgets show "Open Compass once to fill this widget".
struct Snapshot: Codable, Equatable {
    struct Item: Codable, Equatable, Identifiable {
        let id: String; let title: String?; let dueLabel: String; let late: Bool; let horizon: String; let work: Bool; let offline: Bool; let project: String?
    }
    struct Today: Codable, Equatable { var due: Int; var late: Int; var done: Int; var total: Int; var next: Item? }
    struct Horizons: Codable, Equatable { var short: [Item]; var medium: [Item]; var long: [Item] }
    struct Milestone: Codable, Equatable { let name: String?; let lateDays: Int }
    struct Project: Codable, Equatable, Identifiable {
        let id: String; let name: String?; let rag: String; let pct: Int; let nextMilestone: Milestone?
        let slipDays: Int?; let highRisks: Int?; var overdue: Int; let work: Bool; let offline: Bool
    }
    struct Day: Codable, Equatable { let day: String; var short: Int; var medium: Int; var long: Int; var total: Int { short + medium + long } }
    struct Lock: Codable, Equatable { let hideWork: Bool }

    let v: Int; let at: String; let tz: String
    var today: Today; var items: [Item]; var horizons: Horizons; let blocked: Int; var projects: [Project]; var week: [Day]; let lock: Lock

    static func decode(_ data: Data) -> Snapshot? {
        let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase
        guard let s = try? d.decode(Snapshot.self, from: data), s.v == 1 else { return nil }
        return s
    }
    func encoded() -> String? {
        let e = JSONEncoder(); e.keyEncodingStrategy = .convertToSnakeCase
        return (try? e.encode(self)).flatMap { String(data: $0, encoding: .utf8) }
    }
    static func load(from dir: URL? = WidgetStore.container()) -> Snapshot? {
        guard let dir, let data = try? Data(contentsOf: dir.appendingPathComponent(WidgetStore.snapshotName)) else { return nil }
        return decode(data)
    }

    // MARK: ticking (W5, the optimistic half)

    /// The snapshot right after a tick: the task leaves every list, and the counts it was part of move (due, late, done, the project's overdue,
    /// its day of the week). `total` stays (one fewer due, one more done). A project's % done can't move: the snapshot has no task totals.
    func markingDone(_ id: String) -> Snapshot {
        guard let it = (items + horizons.short + horizons.medium + horizons.long + [today.next].compactMap { $0 }).first(where: { $0.id == id }) else { return self }
        var s = self
        if it.late || it.dueLabel == "Today" {
            s.today.due = max(0, s.today.due - 1)
            if it.late { s.today.late = max(0, s.today.late - 1) }
            s.today.done += 1
        }
        s.items.removeAll { $0.id == id }
        s.horizons.short.removeAll { $0.id == id }; s.horizons.medium.removeAll { $0.id == id }; s.horizons.long.removeAll { $0.id == id }
        if s.today.next?.id == id { s.today.next = s.items.first { $0.dueLabel == "Today" } ?? s.items.first { $0.late } } // the builder's rule
        if it.late, let p = it.project, let i = s.projects.firstIndex(where: { $0.id == p }) { s.projects[i].overdue = max(0, s.projects[i].overdue - 1) }
        if let today = atDay, let off = Snapshot.dayOffset(it.dueLabel, today: today), let day = Snapshot.addDays(today, off),
           let w = s.week.firstIndex(where: { $0.day == day }) {
            switch it.horizon {
            case "short": s.week[w].short = max(0, s.week[w].short - 1)
            case "medium": s.week[w].medium = max(0, s.week[w].medium - 1)
            default: s.week[w].long = max(0, s.week[w].long - 1)
            }
        }
        return s
    }

    // MARK: what a widget shows

    /// The large widget's footer: the latest of the projects' next milestones that can be named (an Offline project's can't); ties keep project order.
    var footerMilestone: (project: Project, milestone: Milestone)? {
        projects.compactMap { p in p.nextMilestone.flatMap { $0.name == nil || p.offline ? nil : (p, $0) } }.max { $0.1.lateDays < $1.1.lateDays }
    }
    var weekOpen: Int { week.reduce(0) { $0 + $1.total } }
    /// The listed tasks due on `day` (yyyy-MM-dd), found from their labels against the snapshot's own day; "Oct 30" names no day this week.
    func items(on day: String) -> [Item] {
        guard let today = atDay else { return [] }
        return items.filter { Snapshot.dayOffset($0.dueLabel, today: today).flatMap { Snapshot.addDays(today, $0) } == day }
    }
    /// Whether the system should redact this task's words on a locked device (StandBy, the Lock Screen): work, while hide_work is on.
    func hides(_ item: Item) -> Bool { lock.hideWork && item.work }
    func hides(_ project: Project) -> Bool { lock.hideWork && project.work }
    /// The snapshot was written on another day than `now` (in its zone): its "Today" is yesterday's until the app writes again.
    func isStale(_ now: Date) -> Bool { atDay != Snapshot.ymd(now, tz: tz) }
    var atDay: String? { Snapshot.date(at).map { Snapshot.ymd($0, tz: tz) } }

    // MARK: dates (the snapshot's zone, plain yyyy-MM-dd)

    static func zone(_ tz: String) -> TimeZone { TimeZone(identifier: tz) ?? .current }
    static func date(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }
    static func iso(_ d: Date) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: d)
    }
    static func ymd(_ d: Date, tz: String) -> String { format(d, "yyyy-MM-dd", zone(tz)) }
    /// "Tue Oct 21", for a widget's header.
    static func header(_ d: Date, tz: String) -> String { format(d, "EEE MMM d", zone(tz)) }
    /// "Mon" for "2026-10-20".
    static func weekday(_ ymd: String) -> String { utcDay(ymd).map { format($0, "EEE", utc) } ?? "" }
    static func addDays(_ ymd: String, _ n: Int) -> String? { utcDay(ymd).map { format($0.addingTimeInterval(Double(n) * 86_400), "yyyy-MM-dd", utc) } }
    /// Days from `today` to the day a `due_label` names (`dueLabel` in shared/widget-snapshot.ts): nil for "Oct 30" (a week or more away) and "".
    static func dayOffset(_ label: String, today: String) -> Int? {
        switch label {
        case "Today": return 0
        case "Tomorrow": return 1
        case "Yesterday": return -1
        default:
            if label.hasSuffix("d late"), let n = Int(label.dropLast(6)) { return -n }
            let names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
            guard let want = names.firstIndex(of: label), let now = names.firstIndex(of: weekday(today)) else { return nil }
            let d = (want - now + 7) % 7
            return d >= 2 ? d : nil // a weekday label means 2 to 6 days ahead
        }
    }
    private static let utc = TimeZone(identifier: "UTC")!
    private static func utcDay(_ ymd: String) -> Date? {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = utc; f.dateFormat = "yyyy-MM-dd"
        return f.date(from: ymd)
    }
    private static func format(_ d: Date, _ pattern: String, _ tz: TimeZone) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = tz; f.dateFormat = pattern
        return f.string(from: d)
    }
}

extension Snapshot.Item {
    /// The words a widget shows for a task. An Offline-only task is never named (W1 gives no title). On the Lock Screen (`lock`), a work task is
    /// "Work task" while `hide_work_on_lock` is on; the Home Screen shows its title (the phone is unlocked).
    func shown(lock: Bool, hideWork: Bool) -> String {
        guard let title, !offline else { return "Offline-only task" }
        return lock && hideWork && work ? "Work task" : title
    }
}

extension Snapshot.Project {
    var shownName: String { offline ? "Offline-only project" : (name ?? "Offline-only project") }
}

/// Where a widget tap goes (W4): universal links on the Compass host only, which the shell routes in-app through CompassLink.
enum CompassURL {
    static let base = "https://compass.knocturnlabs.com"
    static let today = URL(string: base + "/")!
    static let quickAdd = URL(string: base + "/?quickadd=1")!
    static let athena = URL(string: base + "/athena")!
    static func task(_ id: String) -> URL {
        var c = URLComponents(string: base + "/")!
        c.queryItems = [URLQueryItem(name: "task", value: id)]
        return c.url ?? today
    }
    static func dashboard(_ id: String) -> URL {
        guard let seg = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_"))) else { return today }
        return URL(string: base + "/projects/\(seg)/dashboard") ?? today
    }
}

extension WidgetStore {
    /// MarkDoneIntent's local half (W5): the widget shows the tick at once, and the app sends it (`takeTicks`) when it next opens.
    /// Task 2 posts first and keeps the queued tick only for a failure.
    static func tick(_ id: String, at: Date = Date(), in dir: URL) {
        let file = dir.appendingPathComponent(snapshotName)
        try? coordinated(file) { url in // read and write under one hold: a sign-out removal can't be undone by a tick in flight
            guard let data = try? Data(contentsOf: url), let s = Snapshot.decode(data), let json = s.markingDone(id).encoded() else { return }
            let out = Data(json.utf8)
            if out.count <= maxBytes { try out.write(to: url, options: writeOptions) }
        }
        try? appendTick(id, at: Snapshot.iso(at), in: dir)
    }
}

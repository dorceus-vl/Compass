import AppIntents
import WidgetKit

/// A project Vlad can pick for the Project pulse widget. The list is the snapshot's projects (at most 10 live, open ones); an Offline-only
/// project is listed unnamed ("Offline-only project 1"), since the snapshot never holds its name.
struct ProjectEntity: AppEntity {
    let id: String
    let name: String
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
    static var defaultQuery = ProjectQuery()
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct ProjectQuery: EntityQuery {
    func entities(for identifiers: [ProjectEntity.ID]) async throws -> [ProjectEntity] { Self.all().filter { identifiers.contains($0.id) } }
    func suggestedEntities() async throws -> [ProjectEntity] { Self.all() }
    func defaultResult() async -> ProjectEntity? { Self.all().first }

    static func all() -> [ProjectEntity] {
        var n = 0
        return (Snapshot.load()?.projects ?? []).map { p in
            if p.offline || p.name == nil { n += 1; return ProjectEntity(id: p.id, name: "Offline-only project \(n)") }
            return ProjectEntity(id: p.id, name: p.shownName)
        }
    }
}

struct PickProjectIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Project"
    static var description = IntentDescription("The project this widget follows.")
    @Parameter(title: "Project") var project: ProjectEntity?
}

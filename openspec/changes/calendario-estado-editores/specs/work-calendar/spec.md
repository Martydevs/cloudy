# Work calendar

## ADDED Requirements

### Requirement: Assigned editors change the status of their work day
The system SHALL allow an editor to change the status of a work day only when the editor is assigned to that day as a
member, SHALL allow admins to change the status of any work day, and SHALL enforce both on the server. Editing, deleting
and scheduling work days SHALL remain admin-only.

#### Scenario: Assigned editor changes the status from the detail
- **WHEN** an editor assigned to a day opens its detail and chooses another status in «Estado»
- **THEN** the status is saved, a toast confirms it and the detail and the calendar show the new status, and no «Editar» or «Eliminar» control is offered

#### Scenario: Assigned editor uses the list button
- **WHEN** an editor assigned to a day chooses «Iniciar» or «Finalizar» on that day in «Próximos días»
- **THEN** the status advances, a toast confirms it and the list shows the new status

#### Scenario: Editor who is not assigned
- **WHEN** an editor opens the list or the detail of a day they are not assigned to
- **THEN** no status control is offered for that day and the detail says that only the people assigned to the day can change its status

#### Scenario: Editor who is not assigned calls the endpoint
- **WHEN** an editor sends a status request for a day they are not assigned to
- **THEN** the server answers 403 with the code `not_assigned` and the status does not change

#### Scenario: The day was deleted meanwhile
- **WHEN** an editor or an admin sends a status request for a day that no longer exists
- **THEN** the server answers 404

#### Scenario: Admin changes any day
- **WHEN** an admin changes the status of a day they are not assigned to
- **THEN** the status is saved

#### Scenario: No session or pending account
- **WHEN** a status request arrives without a session, or from an account that is not approved yet
- **THEN** the server answers 401 without a session and 403 for the pending account, and nothing changes

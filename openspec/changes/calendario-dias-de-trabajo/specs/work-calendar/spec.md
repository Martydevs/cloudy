# Spec Delta

## Purpose

The team sees its work days on `/calendario` and admins schedule them, with members and attached material.

## ADDED Requirements

### Requirement: Team members see the work days
The system SHALL show active editors and admins a page with an event calendar with day, week and month views, where
each time range of a day is one event, and with the work days of the next 30 days as a list, one of the two at a time,
chosen with a switch.

#### Scenario: Editor opens the calendar
- **WHEN** an editor opens `/calendario`
- **THEN** the calendar and the Calendario / Lista switch are shown, without any control to schedule, edit or delete

#### Scenario: Switching to the list
- **WHEN** the person chooses «Lista»
- **THEN** the list of upcoming days replaces the calendar, the address carries `?vista=lista` and reloading it shows the list again

#### Scenario: No session
- **WHEN** a visitor without a session opens `/calendario`
- **THEN** they are redirected to the login page with the return path

#### Scenario: Phone
- **WHEN** the page is opened at 360 px
- **THEN** there is no horizontal scroll, the calendar opens in the day view and the controls are at least 44 px tall

### Requirement: The calendar page uses the whole content area
The system SHALL render `/calendario` across the full width of the content column, keeping the side menu and the top
bar, with the calendar (or the list) taking 80 % of the height below the top bar and the title, the switch and the
scheduling control above it.

#### Scenario: Desktop
- **WHEN** the page is opened at 1280 px or wider
- **THEN** the calendar spans the content column without a maximum width and is about 80 % of the height below the top bar

#### Scenario: Short screen
- **WHEN** the viewport is too short for that proportion
- **THEN** the calendar keeps a minimum height of 28 rem and the page scrolls vertically

### Requirement: Scheduling and editing are pages for admins
The system SHALL offer scheduling at `/calendario/nuevo` and editing at `/calendario/<id>/editar` as pages with the same
form, SHALL allow only admins to open them and SHALL return to the calendar on the saved day's month after saving.

#### Scenario: Admin schedules a day
- **WHEN** an admin follows «Agendar día», fills the form and saves
- **THEN** the day is created, a toast confirms it and the calendar is shown on the month of that day

#### Scenario: Editor opens a form page
- **WHEN** an editor opens `/calendario/nuevo` or `/calendario/<id>/editar`
- **THEN** they are redirected to `/acceso-denegado`

#### Scenario: Editing a day that no longer exists
- **WHEN** an admin opens the edit page of a deleted day
- **THEN** the page says the day no longer exists and links back to the calendar

### Requirement: Unsaved changes are not lost silently
The system SHALL ask for confirmation before leaving a form page with unsaved changes and SHALL NOT ask after a
successful save or when nothing changed.

#### Scenario: Leaving with changes
- **WHEN** the admin changed a field and follows a link out of the form
- **THEN** a confirmation asks whether to leave without saving, and declining keeps the form and its values

#### Scenario: Leaving without changes
- **WHEN** the admin changed nothing and chooses «Cancelar»
- **THEN** the calendar is shown without any confirmation

### Requirement: Only admins manage work days
The system SHALL allow only admins to create, edit and delete work days, to assign members and to attach material, and
SHALL enforce it on the server. Who changes the status of a day is defined by the change `calendario-estado-editores`
(admins, and the editors assigned to that day).

#### Scenario: Editor calls a write endpoint
- **WHEN** an editor sends a create, edit or delete request
- **THEN** the server answers 403 and nothing changes

#### Scenario: Admin deletes a day
- **WHEN** an admin confirms deleting a day
- **THEN** the day, its time ranges, its members and its attachments are removed, and the attached collections, playlists and folders are untouched

### Requirement: The kind of day is always chosen
The system SHALL require the kind of day (normal or special) with no initial value and SHALL NOT infer it from the date.

#### Scenario: Wednesday or Sunday
- **WHEN** the chosen date is a Wednesday or a Sunday
- **THEN** the form shows the hint that those days are usually normal and leaves the kind unselected

#### Scenario: Saving without a kind
- **WHEN** the admin submits the form without a kind
- **THEN** the form explains that a kind is required and nothing is saved

### Requirement: Time ranges are valid
The system SHALL accept 1 to 6 time ranges per day, each with a start before its end and none overlapping another, and
SHALL validate them on the server.

#### Scenario: Overlapping ranges
- **WHEN** two ranges of the same day overlap
- **THEN** both rows show the error and the day is not saved

#### Scenario: Adjacent ranges
- **WHEN** a range starts exactly when another ends
- **THEN** the day is saved

### Requirement: Material is attached by reference
The system SHALL let admins attach song collections, YouTube playlists and drive folders to a day as references and SHALL
show their current names and contents in the day's detail.

#### Scenario: Attached collection is deleted
- **WHEN** a song collection attached to a day is deleted
- **THEN** the day remains and that attachment no longer appears

#### Scenario: Folder in the trash
- **WHEN** an attached folder is in the trash
- **THEN** the detail does not show it and it is not counted

#### Scenario: Material gone while scheduling
- **WHEN** an admin saves a day whose chosen material no longer exists
- **THEN** the server answers 409, nothing is saved and the form tells the admin to review the material

### Requirement: Members are active accounts
The system SHALL offer only active accounts as members (0 to 30 per day) and SHALL show a member whose account is no
longer active as "Persona inactiva".

#### Scenario: Member deactivated later
- **WHEN** a member of a day is disabled or removed
- **THEN** the day shows "Persona inactiva" in their place and the account is not offered for new days

### Requirement: Kind and status are never conveyed by colour alone
The system SHALL show the kind and the status of a day with text or an icon in addition to colour, in both themes, and
every calendar event SHALL be operable with the keyboard.

#### Scenario: Special day in the calendar
- **WHEN** a special day is shown in the calendar
- **THEN** its event carries an icon and an accessible name that says it is a special day, and opening it with the keyboard shows the detail

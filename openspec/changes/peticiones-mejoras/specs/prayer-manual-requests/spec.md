# Spec Delta

## Purpose

Lets an editor or admin add a prayer request straight from Peticiones, without the public upload page or the approval queue.

## ADDED Requirements

### Requirement: Editors add a prayer request from Peticiones
The system SHALL offer editors and admins an **Agregar petición** action on `/peticiones` that opens a dialog with a
read-only name (the signed-in user), an optional note and an image picker (files, drag and drop, camera), and SHALL accept
images only.

#### Scenario: Adding a photo
- **WHEN** an editor opens the dialog, chooses a photo and submits
- **THEN** the photo is uploaded, the dialog closes, a success toast is shown and the request appears first in the row with the editor's name as sender

#### Scenario: Non-image file
- **WHEN** the editor adds a file that is not an image
- **THEN** the file is marked as not allowed in the queue and is not uploaded, and the server rejects it with 415 if it is sent anyway

#### Scenario: Upload fails
- **WHEN** the upload or its verification fails
- **THEN** the dialog stays open with a message saying what to do, and no request, file row or stored object is left behind

### Requirement: A manual request is approved on upload
The system SHALL store a manual request as an approved submission reviewed by its author at the moment the upload is
verified, with its images in the drive root, and SHALL NOT show it in the approval queue or announce it as a new guest submission.

#### Scenario: Not in the queue
- **WHEN** an editor adds a request manually
- **THEN** Solicitudes does not list it, the pending counter does not change and no "new submission" toast is announced to the team

#### Scenario: Activity is recorded
- **WHEN** a manual request is approved
- **THEN** the activity log records the approval by that editor

### Requirement: The server owns the sender and the authorization
The system SHALL take the sender name from the caller's profile, ignoring any name in the request, SHALL require the editor
role on both endpoints, SHALL let only the creator finish a manual upload, and SHALL limit creation to 60 per hour per person.

#### Scenario: Name sent by the client
- **WHEN** the request body carries a sender name
- **THEN** it is ignored and the profile name is stored

#### Scenario: No session or wrong role
- **WHEN** a visitor without session, or a signed-in account that is not an active editor or admin, calls either endpoint
- **THEN** the server answers 401 or 403 and nothing is written

#### Scenario: Finishing someone else's upload
- **WHEN** an editor calls the completion endpoint with the id of a guest submission or of another person's manual upload
- **THEN** the server answers 404 and the submission is untouched

### Requirement: The guest upload page is unchanged
The system SHALL keep `/upload` behaving exactly as before.

#### Scenario: Guest sends files
- **WHEN** a guest sends files from `/upload`
- **THEN** the submission lands in the approval queue as pending, with the name the guest typed

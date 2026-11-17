# Spec Delta

## Purpose

Lets an editor or admin review, correct and approve the text written in each selected prayer-request photo before any image
is generated, so the generated image carries text a person has checked.

## ADDED Requirements

### Requirement: Review modal replaces direct generation
The system SHALL open a review modal when an editor or admin chooses **Generar imágenes** with one or more prayer requests
selected, and SHALL NOT create a generation or queue any image until the modal's own generate action is used.

#### Scenario: Opening the modal
- **WHEN** an editor has selected requests on `/peticiones` and chooses **Generar imágenes**
- **THEN** the review modal opens listing every selected request in image order, and no generation is created yet

#### Scenario: Closing without generating
- **WHEN** the editor closes the modal
- **THEN** the selection is kept, no generation exists, and the transcripts already read or saved remain stored

#### Scenario: Role guard
- **WHEN** a user who is not an editor or admin calls any transcript endpoint
- **THEN** the server rejects it and nothing is read or stored

### Requirement: Sidebar of requests with verification state
The modal SHALL list each selected request as a card with a thumbnail of its photo, its name and a verified indicator that
reflects whether its transcript is verified.

#### Scenario: Indicator reflects state
- **WHEN** a request's transcript is verified
- **THEN** its card shows it as verified, and otherwise shows it as not verified

#### Scenario: Choosing a card
- **WHEN** the editor activates a card
- **THEN** the editor area shows that request's photo and fills the text area with its current transcript

#### Scenario: Compact screens
- **WHEN** the viewport is 360 px wide
- **THEN** the cards are reachable without horizontal page scroll and every control keeps a touch target of at least 44 px

### Requirement: Sequential transcription of unread photos
The system SHALL read each selected photo that has no stored transcript with a vision model, one photo at a time in image
order, and SHALL store the result as an unverified draft.

#### Scenario: Reading in order
- **WHEN** the modal opens with three unread photos
- **THEN** the first is read, then the second, then the third, and each card shows its own reading state meanwhile

#### Scenario: Reuse of stored transcripts
- **WHEN** a selected photo already has a stored transcript
- **THEN** it is shown immediately and no vision call is made for it

#### Scenario: Reviewing while reading continues
- **WHEN** the first transcript is ready while later photos are still being read
- **THEN** the editor can edit and verify the first one without waiting for the rest

#### Scenario: Provider sees only the photo
- **WHEN** a photo is sent to the vision model
- **THEN** the request carries only the photo and no sender name, note, IP or identifier

### Requirement: Read failures and empty reads
A request whose reading fails or finds no text SHALL be recoverable without leaving the modal.

#### Scenario: Reading fails
- **WHEN** the vision call fails or times out for a photo
- **THEN** its card shows the failure with **Reintentar** (when a retry can help) and **Escribir a mano**, and the remaining photos are still read

#### Scenario: No text found
- **WHEN** the model reports that the photo has no readable text
- **THEN** the card is marked as empty, the text area is blank and the editor can type the text by hand

#### Scenario: Unreadable photo format
- **WHEN** a photo cannot be sent to the model (for example an old HEIC with no JPEG copy)
- **THEN** the card says the photo cannot be read and the editor can type the text by hand or drop the request from the selection

#### Scenario: Credit exhausted or not configured
- **WHEN** OpenRouter reports no credit or the key or preset is rejected
- **THEN** reading stops for the remaining photos, the modal tells the editor to contact an administrator, and manual writing still works

### Requirement: Correcting and verifying a transcript
The editor SHALL be able to edit a transcript and save it, which stores the text and marks it verified, or mark an
unedited transcript verified by hand.

#### Scenario: Save marks verified
- **WHEN** the editor edits the text of a request and chooses **Save**
- **THEN** the corrected text is stored, the transcript becomes verified, and the card's indicator updates

#### Scenario: Manual verification
- **WHEN** the editor marks a draft as verified without changing it
- **THEN** the stored text is kept and the transcript becomes verified

#### Scenario: Editing a verified transcript
- **WHEN** the editor changes the text of a verified transcript
- **THEN** it returns to unverified until it is saved or marked verified again

#### Scenario: Empty text cannot be verified
- **WHEN** the text is empty or only whitespace
- **THEN** it cannot be saved as verified and the field says what is missing

#### Scenario: Text too long
- **WHEN** the text exceeds the maximum length
- **THEN** it is rejected by the server and the field shows the limit

### Requirement: Transcripts are shared and persistent
The system SHALL keep one transcript per photo, shared by all editors and admins, until its photo is permanently removed.

#### Scenario: Another editor opens the same photo
- **WHEN** a second editor selects a photo that already has a transcript
- **THEN** they see the same text and state, and no new vision call is made

#### Scenario: Reload keeps the work
- **WHEN** the editor reloads the page after saving some transcripts
- **THEN** reopening the modal shows the saved texts and states

#### Scenario: Photo removed
- **WHEN** a photo is permanently deleted (trash purge or cleanup)
- **THEN** its transcript is deleted with it

#### Scenario: Re-reading on demand
- **WHEN** the editor explicitly asks to read a photo again
- **THEN** a new vision call replaces the stored text with an unverified draft after confirming that the current text will be lost

### Requirement: Generate action gated by verification
The modal's **Generar imágenes** action SHALL be disabled while any selected request is not verified, and SHALL say why.

#### Scenario: Some requests pending
- **WHEN** at least one selected request is not verified
- **THEN** the action is disabled and a message names how many remain

#### Scenario: All verified
- **WHEN** every selected request is verified
- **THEN** the action is enabled, and choosing it creates the generation, queues one image per group of four and takes the editor to the generation page

#### Scenario: A request becomes unavailable
- **WHEN** a selected request was removed (sent to the trash) while the modal was open
- **THEN** the server reports it, the request leaves the selection and the modal, and the editor is told

### Requirement: Modal states and accessibility
Every data view in the modal SHALL render loading, empty, error-with-retry and content states in Spanish and be usable by keyboard and screen reader.

#### Scenario: Loading stored transcripts
- **WHEN** the modal opens and the stored transcripts are being fetched
- **THEN** a skeleton or loading status is shown instead of blank content

#### Scenario: Stored transcripts cannot be loaded
- **WHEN** fetching the stored transcripts fails
- **THEN** an error with **Reintentar** is shown and generation stays disabled

#### Scenario: Keyboard and focus
- **WHEN** the modal is open
- **THEN** focus stays inside it, Escape closes it (asking first if there are unsaved edits), each card and control has an accessible name, and state changes are announced in a live region

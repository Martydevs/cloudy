# Spec Delta

## Purpose

Bounds what the transcription model may return for a prayer-request photo.

## ADDED Requirements

### Requirement: Transcription output is bounded
The system SHALL request the photo transcription with an output schema whose text is limited to the maximum length of a
prayer-request text and with a cap on output tokens, SHALL treat "no legible text" as an empty text, and SHALL fail the read
as an invalid output, storing nothing, when the model's answer does not satisfy the schema.

#### Scenario: Text within the limit
- **WHEN** the model returns text of up to 1000 characters
- **THEN** the read succeeds and the text is stored as a draft

#### Scenario: Text over the limit
- **WHEN** the model returns more than 1000 characters or its answer is cut by the token cap
- **THEN** the read fails, nothing is stored, and the review dialog offers reading again or writing by hand

#### Scenario: No legible text with stray text
- **WHEN** the model answers that the photo has no legible text but still includes text
- **THEN** the stray text is discarded and the read counts as "no legible text"

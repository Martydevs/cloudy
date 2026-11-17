# Spec Delta

## Purpose

Defines what Peticiones image generation requires and consumes: the template plus text a person has verified, never the
guests' photos, so the finished image shows exactly the approved wording.

## ADDED Requirements

### Requirement: Generation requires verified text
The system SHALL create a generation and generate its images only for prayer requests whose transcript is verified, and
SHALL enforce this on the server regardless of what the client sends.

#### Scenario: All verified
- **WHEN** an editor creates a generation whose requests all have verified transcripts
- **THEN** the generation is created and its images can be generated

#### Scenario: Unverified request rejected
- **WHEN** a generation or image request includes a request with no transcript or an unverified one
- **THEN** the server answers a conflict that names the offending ids and no credit is spent

#### Scenario: Verification revoked before the image runs
- **WHEN** a transcript becomes unverified after the generation was created but before its image is generated
- **THEN** that image is rejected as above and the queue shows it as failed with an actionable message

### Requirement: Server supplies the text
The system SHALL read the verified texts from storage when generating an image, and SHALL NOT accept text from the client
for generation.

#### Scenario: Client sends only ids
- **WHEN** the browser queues an image for a group of requests
- **THEN** it sends only the request ids and generation id, and the server loads their verified texts

#### Scenario: Text edited after generation was created
- **WHEN** a transcript is re-saved while its generation is still queued
- **THEN** the image generated afterwards uses the latest verified text

### Requirement: Image model receives template and text only
The system SHALL send the image model the template and the verified texts in the group's order, and SHALL NOT send the guests' photos
or any sender name, note, IP or identifier.

#### Scenario: Group of several requests
- **WHEN** an image is generated for a group of up to four requests
- **THEN** the model receives the template and one text block per request, in image order

#### Scenario: Privacy of the call
- **WHEN** the provider call is made
- **THEN** its content contains no photo, name, note, IP or file id, and logs carry only codes

### Requirement: Generation behavior otherwise unchanged
Queueing, concurrency, retries, history, the generation page, the 60-per-hour generation limit, the stored image size cap and
failure messages SHALL behave as before this change.

#### Scenario: Rate limit
- **WHEN** a person exceeds 60 image generations in an hour
- **THEN** further requests are rejected with the existing rate-limit message

#### Scenario: Reads are not rate-limited by Cloudy
- **WHEN** an editor reads many photos in the review modal
- **THEN** Cloudy applies no limit of its own to the reads and only the provider's credit and errors can stop them

#### Scenario: Missing or rejected configuration
- **WHEN** the OpenRouter key is empty or the provider rejects the key or preset
- **THEN** the editor sees the existing "not configured" message and no retry is offered

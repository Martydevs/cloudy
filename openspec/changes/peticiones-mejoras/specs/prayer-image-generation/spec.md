# Spec Delta

## Purpose

Makes the call to the image-generation preset lighter without changing what is generated.

## ADDED Requirements

### Requirement: Template travels by signed URL
The system SHALL send the template to the image model as a short-lived signed URL of a stored copy, and SHALL fall back to
sending the template bytes when the stored copy cannot be prepared.

#### Scenario: Stored copy available
- **WHEN** an image is generated and the template copy exists or can be uploaded
- **THEN** the provider call carries the template as an https URL and no template bytes

#### Scenario: Storage unavailable
- **WHEN** the template copy cannot be checked, uploaded or signed
- **THEN** the call carries the template bytes as before and the generation proceeds

### Requirement: Image output is bounded
The system SHALL ask the provider for an image with the template's aspect ratio and a 1K size.

#### Scenario: Request body
- **WHEN** the provider call is made
- **THEN** its body carries `image_config` with the template's aspect ratio and the 1K size

### Requirement: Generation metrics carry no personal data
The system SHALL log, for each generation, its duration, how the template travelled and the size of the result, as numbers
and codes only.

#### Scenario: Successful generation
- **WHEN** an image is generated
- **THEN** one log line records milliseconds, `url` or `bytes`, and kilobytes, with no names, notes, texts or ids

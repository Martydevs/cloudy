# Spec Delta

## Purpose

Keeps toasts visible, announced and usable while a modal dialog is open.

## ADDED Requirements

### Requirement: Toasts render above the open modal
The system SHALL show toasts above the topmost open modal dialog, and SHALL keep their dismiss button and action link operable.

#### Scenario: Toast while a modal is open
- **WHEN** an action inside a modal dialog shows a toast
- **THEN** the toast is painted above the dialog and its backdrop, and clicking **Cerrar aviso** dismisses it

#### Scenario: Stacked dialogs
- **WHEN** a confirmation dialog is open over another dialog and a toast is shown
- **THEN** the toast is shown above the confirmation dialog, and above the first dialog once the confirmation closes

#### Scenario: Modal closes
- **WHEN** the last modal closes while a toast is visible
- **THEN** the toast continues in its usual place in the layout

### Requirement: No change without a modal
The system SHALL keep the position, live region and behavior of toasts unchanged when no modal dialog is open.

#### Scenario: Toast on a page
- **WHEN** a toast is shown with no modal open
- **THEN** it appears under the top bar, centred over the content column, as before

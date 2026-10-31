// Solicitud de acceso de invitados (feature 003): pedir acceso y crear el envío con permiso.
import { MAX_GUEST_FILES } from '../constants/files'
import { array, object } from './core'
import { guestFile, note, senderName } from './submissions'

export const accessRequestInput = object({ senderName: senderName() })

/** Igual que el envío abierto sin `senderName`: el nombre lo da la solicitud aprobada. */
export const permittedSubmissionInput = object(
  {
    note: note(),
    files: array(guestFile, { min: 1, max: MAX_GUEST_FILES, label: 'archivos' }),
  },
  raw => (raw.senderName !== undefined ? { senderName: 'Campo no permitido' } : null),
)

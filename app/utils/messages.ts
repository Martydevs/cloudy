// Textos de avisos (toasts), respaldos de errores de la API y el ErrorState de cada vista (T153),
// agrupados por área y siempre en español. Los títulos estáticos y los EmptyState viven en sus páginas.
import { RATE_LIMITED_MESSAGE } from '#shared/constants/messages'

/** «1 elemento» / «4 elementos». */
export function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

const RETRY = 'Inténtalo de nuevo.'
const CONNECTION = 'Revisa tu conexión.'

export const messages = {
  common: {
    /** 429 de cualquier endpoint: el mismo texto que envía el servidor (`shared/constants/messages`). */
    rateLimited: RATE_LIMITED_MESSAGE,
    sessionChanged: 'Tu sesión cambió. Vuelve a iniciar sesión e inténtalo de nuevo.',
    retry: RETRY,
    connection: CONNECTION,
  },
  /** ErrorState de cada vista y fallos al cargar más. */
  load: {
    generic: 'No pudimos cargar la información. Revisa tu conexión e inténtalo de nuevo.',
    dashboard: `No pudimos cargar el resumen. ${CONNECTION}`,
    files: `No pudimos cargar los archivos. ${CONNECTION}`,
    moreFiles: 'No pudimos cargar más archivos. Desplázate de nuevo para reintentar.',
    file: 'No pudimos cargar el archivo.',
    folders: 'No pudimos cargar las carpetas.',
    submissions: `No pudimos cargar los envíos. ${CONNECTION}`,
    submissionsRefresh: 'No pudimos actualizar la cola. Se volverá a intentar en unos segundos.',
    trash: `No pudimos cargar la papelera. ${CONNECTION}`,
    users: `No pudimos cargar los usuarios. ${CONNECTION}`,
    people: 'No pudimos cargar la lista de personas, así que ese filtro no está disponible. Recarga la página para intentarlo de nuevo.',
    activity: `No pudimos cargar la actividad. ${CONNECTION}`,
    moreActivity: 'No pudimos cargar más.',
    comments: 'No pudimos cargar los comentarios.',
  },
  files: {
    folderCreated: (name: string) => `Carpeta «${name}» creada`,
    folderCreatedAs: (wanted: string, name: string) => `Ya existía «${wanted}»: se creó «${name}»`,
    renamed: (name: string) => `Ahora se llama «${name}»`,
    moved: (name: string) => `Se movió «${name}»`,
    trashed: (name: string) => `«${name}» se envió a la papelera`,
    uploadedOne: (name: string) => `Se subió «${name}»`,
    uploadedMany: (n: number) => `Se subieron ${n} archivos`,
    uploadFailedCount: (n: number) => (n === 1 ? 'Un archivo no se pudo subir' : `${n} archivos no se pudieron subir`),
    unsupported: (name: string) => `«${name}»: formato no admitido`,
    invalidContent: 'El contenido no corresponde al tipo de archivo',
    uploadInterrupted: (name: string) => `Se perdió la conexión al subir «${name}». Reintenta.`,
    createFailed: `No pudimos crear la carpeta. ${RETRY}`,
    renameFailed: `No pudimos renombrar. ${RETRY}`,
    moveFailed: `No pudimos mover el elemento. ${RETRY}`,
    trashFailed: `No pudimos eliminarlo. ${RETRY}`,
    /** Fila de la cola mientras se genera la copia JPEG de una HEIC. */
    preparing: 'Preparando…',
  },
  /** Texto leído de las imágenes (feature 002). */
  imageText: {
    reading: 'Leyendo texto…',
    empty: 'No se reconoció texto en esta imagen',
    notRead: 'El texto de esta imagen aún no se ha leído.',
    unavailable: 'No disponible para este archivo: solo se lee el texto de imágenes JPG, PNG o HEIC de hasta 5 MB.',
    unavailableHeic: 'No disponible para este archivo: esta foto HEIC se subió sin copia para lectura.',
    failedRetryable: 'No pudimos leer el texto ahora. Inténtalo de nuevo en un momento.',
    failedQuota: 'El servicio de lectura alcanzó su límite de uso. Avisa a un administrador e inténtalo más tarde.',
    failedPermanent: 'No pudimos leer esta imagen. Descárgala y vuelve a subirla en JPG o PNG.',
    loadFailed: `No pudimos cargar el texto de la imagen. ${CONNECTION}`,
    copied: 'Texto copiado',
    copyFailed: 'No pudimos copiar el texto. Selecciónalo y cópialo a mano.',
    saved: 'Texto guardado',
    saveFailed: `No pudimos guardar el texto. ${RETRY}`,
    confirmReread: 'Se reemplazará tu corrección',
    editedBy: (name: string) => `Editado por ${name}`,
    edited: 'Editado',
    searchHint: 'Solo buscamos en el texto de las imágenes que ya se leyeron',
    guestNotice: 'Leeremos automáticamente el texto de tus imágenes para que el equipo pueda revisarlas.',
  },
  trash: {
    restored: (name: string, where: string) => `«${name}» se restauró en ${where}`,
    restoredToRoot: (name: string) => `«${name}» se restauró en Archivos porque su carpeta original sigue en la papelera`,
    purged: (name: string) => `«${name}» se eliminó definitivamente`,
    emptied: (n: number) => (n === 1 ? 'Se eliminó 1 elemento definitivamente' : `Se eliminaron ${n} elementos definitivamente`),
    restoreFailed: `No pudimos restaurarlo. ${RETRY}`,
    purgeFailed: `No pudimos eliminarlo. ${RETRY}`,
    emptyFailed: `No pudimos vaciar la papelera. ${RETRY}`,
  },
  submissions: {
    received: (sender: string, files: number) => `Nuevo envío de ${sender} (${pluralize(files, 'archivo', 'archivos')})`,
    approvedOne: (name: string) => `Se aprobó «${name}»`,
    approvedMany: (n: number, sender: string) => `Se aprobaron ${n} archivos de ${sender}`,
    rejected: (sender: string) => `Se rechazó el envío de ${sender}`,
    approveFailed: `No pudimos aprobar el envío. ${RETRY}`,
    rejectFailed: `No pudimos rechazar el envío. ${RETRY}`,
  },
  comments: {
    published: 'Comentario publicado',
    updated: 'Comentario actualizado',
    deleted: 'Comentario eliminado',
    gone: 'Este comentario ya no existe',
    review: 'Revisa el comentario',
    fileInTrash: 'Este archivo está en la papelera. Restáuralo desde la Papelera para poder comentar.',
    publishFailed: `No pudimos publicar el comentario. ${RETRY}`,
    saveFailed: `No pudimos guardar el comentario. ${RETRY}`,
    deleteFailed: `No pudimos eliminar el comentario. ${RETRY}`,
  },
  users: {
    activated: (name: string, role: string) => `${name} ya puede entrar como ${role}`,
    disabled: (name: string) => `La cuenta de ${name} quedó desactivada`,
    reactivated: (name: string) => `La cuenta de ${name} vuelve a estar activa`,
    roleChanged: (name: string, role: string) => `${name} ahora es ${role}`,
    removed: (name: string) => `La cuenta de ${name} fue eliminada`,
    activateFailed: `No pudimos activar la cuenta. ${RETRY}`,
    disableFailed: `No pudimos desactivar la cuenta. ${RETRY}`,
    reactivateFailed: `No pudimos reactivar la cuenta. ${RETRY}`,
    roleFailed: `No pudimos cambiar el rol. ${RETRY}`,
    removeFailed: `No pudimos eliminar la cuenta. ${RETRY}`,
  },
  profile: {
    nameSaved: 'Nombre actualizado',
    passwordSaved: 'Contraseña actualizada',
    passwordReset: 'Contraseña actualizada. Ya puedes iniciar sesión.',
    nameFailed: `No pudimos guardar el nombre. ${RETRY}`,
  },
  guest: {
    linkCopied: 'Enlace para invitados copiado',
    shareLink: (link: string) => `Comparte este enlace: ${link}`,
    copyFailed: (link: string) => `No pudimos copiar el enlace. Cópialo a mano: ${link}`,
    tooMany: 'Has enviado demasiados archivos; intenta en una hora',
    sendFailed: 'No pudimos enviar los archivos. Revisa tu conexión e inténtalo de nuevo.',
  },
} as const

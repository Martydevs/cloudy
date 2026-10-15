import type { FileCategory } from '#shared/constants/files'

const ICONS: Record<FileCategory, string> = {
  image: 'lucide:image',
  audio: 'lucide:music',
  video: 'lucide:video',
  presentation: 'lucide:presentation',
  document: 'lucide:file-text',
}

export const CATEGORY_LABELS: Record<FileCategory, string> = {
  image: 'Imágenes',
  audio: 'Audio',
  video: 'Video',
  presentation: 'Presentaciones',
  document: 'Documentos',
}

export function fileIcon(category: FileCategory): string {
  return ICONS[category] ?? 'lucide:file'
}

export function useFileIcon() {
  return { fileIcon, CATEGORY_LABELS }
}

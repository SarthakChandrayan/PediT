import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const STORAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../storage',
)

export const DOCUMENTS_DIRECTORY = path.join(STORAGE_ROOT, 'documents')

const MAX_PDF_BYTES = 20 * 1024 * 1024

export function maxPdfBytes(): number {
  return MAX_PDF_BYTES
}

export async function ensureDocumentsDirectory(): Promise<void> {
  await mkdir(DOCUMENTS_DIRECTORY, { recursive: true })
}

export function storedPdfName(): string {
  return `${randomUUID()}.pdf`
}

/** Relative storage path saved on DocumentVersion.fileUrl. */
export function storedFileUrl(filename: string): string {
  return path.posix.join('documents', filename)
}

export function resolveStoredFile(fileUrl: string): string | null {
  if (fileUrl.length === 0 || fileUrl.includes('\0')) {
    return null
  }

  const absolute = path.resolve(STORAGE_ROOT, fileUrl)
  const relative = path.relative(STORAGE_ROOT, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }

  return absolute
}

export function openStoredFile(fileUrl: string) {
  const absolute = resolveStoredFile(fileUrl)
  if (!absolute) {
    return null
  }

  return createReadStream(absolute)
}

const PDF_MAGIC = Buffer.from('%PDF-')

export function hasPdfMagic(header: Uint8Array): boolean {
  if (header.byteLength < PDF_MAGIC.byteLength) {
    return false
  }

  for (let index = 0; index < PDF_MAGIC.byteLength; index += 1) {
    if (header[index] !== PDF_MAGIC[index]) {
      return false
    }
  }

  return true
}

export async function fileHasPdfMagic(filePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(filePath, 'r')
    const header = Buffer.alloc(PDF_MAGIC.byteLength)
    const { bytesRead } = await handle.read(header, 0, header.byteLength, 0)
    return bytesRead >= PDF_MAGIC.byteLength && hasPdfMagic(header.subarray(0, bytesRead))
  } catch {
    return false
  } finally {
    await handle?.close()
  }
}

const PDF_MIME_TYPE = 'application/pdf'

export async function uploadedPdfRejection(file: {
  size: number
  originalname: string
  mimetype: string
  path: string
}): Promise<string | null> {
  if (file.size === 0) {
    return 'The PDF file is empty.'
  }

  const extension = file.originalname.split('.').pop()?.toLowerCase()
  if (extension !== 'pdf' || file.mimetype !== PDF_MIME_TYPE) {
    return 'Only PDF files can be uploaded.'
  }

  if (!(await fileHasPdfMagic(file.path))) {
    return 'Only PDF files can be uploaded.'
  }

  return null
}

export async function storedPdfInfo(
  fileUrl: string,
): Promise<{ absolutePath: string; size: number } | null> {
  const absolute = resolveStoredFile(fileUrl)
  if (!absolute) {
    return null
  }

  try {
    const info = await stat(absolute)
    if (!info.isFile()) {
      return null
    }
    return { absolutePath: absolute, size: info.size }
  } catch {
    return null
  }
}

export async function removeStoredFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined)
}

export function displayFileName(originalName: string): string {
  const base = path.basename(originalName.replaceAll('\\', '/')).replace(/[\u0000-\u001f]/g, '')
  const trimmed = base.trim().slice(0, 255)
  return trimmed.length > 0 ? trimmed : 'document.pdf'
}

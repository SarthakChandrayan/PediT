export const DEFAULT_PDF_SCALE = 1
export const MIN_PDF_SCALE = 0.5
export const MAX_PDF_SCALE = 3
export const PDF_SCALE_STEP = 0.25

export function stepPdfScale(scale: number, direction: -1 | 1): number {
  const next = Math.round((scale + direction * PDF_SCALE_STEP) * 100) / 100
  return Math.min(MAX_PDF_SCALE, Math.max(MIN_PDF_SCALE, next))
}

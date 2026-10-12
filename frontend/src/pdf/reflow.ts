import { PDFName, type PDFDocument, type PDFPage } from 'pdf-lib'
import { removeGlyphsInRegions, type Region } from './contentStream.ts'
import { fontLookup, readPageContent } from './textRemoval.ts'

/** A horizontal band of text, PDF user space (y grows up). */
export type TextBand = { top: number; bottom: number }

export type ReflowRequest = {
  /** Lowest y of the original paragraph. Everything below it moves. */
  cutY: number
  /** How far it moves down, in points. */
  shift: number
  /** Text lines below the paragraph, top to bottom. */
  below: readonly TextBand[]
  /** Highest text on the page, to estimate the page margins. */
  pageTextTop: number
}

export type ReflowPlan = {
  /** Content between splitY and cutY stays on the page, moved down. */
  splitY: number
  /** Whether content below splitY moves to a new page. */
  spill: boolean
  /** Spill page: translation that puts splitY at the top margin. */
  spillOffset: number
}

/**
 * Decides where the moved content goes. Lines that would end up inside the
 * bottom margin move to a new page, cut in the gap between two lines so no
 * line is split. Margins are assumed symmetric: the bottom margin is taken to
 * equal the top margin, clamped to a sensible range.
 */
export function planReflow(
  request: ReflowRequest,
  page: { bottom: number; top: number },
): ReflowPlan {
  const margin = Math.min(Math.max(page.top - request.pageTextTop, 18), 72)
  const floor = page.bottom + margin
  const bands = [...request.below].sort((a, b) => b.top - a.top)
  const firstSpilled = bands.findIndex((band) => band.bottom - request.shift < floor)
  if (firstSpilled < 0) {
    return { splitY: page.bottom, spill: false, spillOffset: 0 }
  }
  const above = bands[firstSpilled - 1]
  const spilled = bands[firstSpilled]!
  const splitY = above ? (above.bottom + spilled.top) / 2 : request.cutY
  const topMargin = Math.max(page.top - request.pageTextTop, 18)
  return {
    splitY,
    spill: true,
    spillOffset: page.top - topMargin - Math.min(splitY, spilled.top + 2),
  }
}

const FAR = 1e6

/**
 * Moves everything on the page below `cutY` down by `shift`, inserting a page
 * after it for content that no longer fits. Call after the page is fully
 * painted; the caller then draws the grown paragraph into the opened gap.
 *
 * The page is rewritten as copies of its own content, one per band, each
 * clipped and shifted. Each copy has the text outside its band removed, not
 * just clipped, so no text exists twice in the file. The copies are written
 * inline rather than as form XObjects, so a later reflow of the same page can
 * still find and remove that text. Graphics outside a band are clipped away.
 * Returns false, leaving the page untouched, when its content cannot be read.
 */
export function reflowPage(
  pdf: PDFDocument,
  page: PDFPage,
  pageIndex: number,
  request: ReflowRequest,
): boolean {
  const content = readPageContent(page)
  if (!content) {
    return false
  }
  const box = page.getMediaBox()
  const bounds = { bottom: box.y, top: box.y + box.height }
  const plan = planReflow(request, bounds)
  const fonts = fontLookup(page)
  const encoder = new TextEncoder()

  /** Page content with text outside [bottom, top) removed. */
  const band = (bottom: number, top: number): Uint8Array => {
    const outside: Region[] = []
    if (bottom > -FAR) {
      outside.push({ x0: -FAR, y0: -FAR, x1: FAR, y1: bottom })
    }
    if (top < FAR) {
      outside.push({ x0: -FAR, y0: top, x1: FAR, y1: FAR })
    }
    return removeGlyphsInRegions(content, outside, fonts)?.bytes ?? content
  }

  /** One band, clipped to [clipBottom, clipTop] on the target and moved by offset. */
  const placed = (bytes: Uint8Array, clipBottom: number, clipTop: number, offset: number) => {
    if (clipTop <= clipBottom) {
      return []
    }
    const head = encoder.encode(
      `q ${num(box.x)} ${num(clipBottom)} ${num(box.width)} ${num(clipTop - clipBottom)} re W n ` +
        `1 0 0 1 0 ${num(offset)} cm\n`,
    )
    return [head, bytes, encoder.encode('\nQ\n')]
  }

  const pageParts = [
    // Above the paragraph: unchanged.
    ...placed(band(request.cutY, FAR), request.cutY, bounds.top, 0),
    // Below it: moved down, without anything that spills.
    ...placed(
      band(plan.spill ? plan.splitY : -FAR, request.cutY),
      Math.max(plan.splitY - request.shift, bounds.bottom),
      request.cutY - request.shift,
      -request.shift,
    ),
  ]
  replaceContent(pdf, page, pageParts)

  if (plan.spill) {
    const next = pdf.insertPage(pageIndex + 1, [box.width, box.height])
    next.setMediaBox(box.x, box.y, box.width, box.height)
    const resources = page.node.Resources()
    if (resources) {
      next.node.set(PDFName.of('Resources'), resources)
    }
    replaceContent(
      pdf,
      next,
      placed(
        band(-FAR, plan.splitY),
        bounds.bottom,
        Math.min(plan.splitY + plan.spillOffset, bounds.top),
        plan.spillOffset,
      ),
    )
  }
  return true
}

function replaceContent(pdf: PDFDocument, page: PDFPage, parts: readonly Uint8Array[]): void {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  const stream = pdf.context.register(pdf.context.flateStream(bytes))
  page.node.set(PDFName.of('Contents'), pdf.context.obj([stream]))
  // pdf-lib caches the stream it appends to; drop it so later drawing goes
  // into a new stream after this content.
  const writable = page as unknown as { contentStream?: unknown; contentStreamRef?: unknown }
  writable.contentStream = undefined
  writable.contentStreamRef = undefined
}

function num(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0'
}

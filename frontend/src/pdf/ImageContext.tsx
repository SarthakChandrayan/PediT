import { createContext, useContext } from 'react'
import type { ImageAnnotation, ImageBox } from './images.ts'

export type ImageApi = {
  images: readonly ImageAnnotation[]
  selectedId: string | null
  selectImage: (id: string | null) => void
  /** Live position or size. This does not record history. */
  updateImage: (id: string, box: ImageBox) => void
  beginImageGesture: () => void
  /** One history step when the box changed, otherwise none. */
  endImageGesture: () => void
  /** Drops the in-progress move or resize without recording history. */
  cancelImageGesture: () => void
}

export const ImageContext = createContext<ImageApi | null>(null)

export function useImages(): ImageApi {
  const value = useContext(ImageContext)
  if (!value) {
    throw new Error('Images are only available inside the PDF viewer.')
  }
  return value
}

import { useEffect, useState } from 'react'
import { getDocument, readPdfError } from './pdfjs.ts'
import type { PDFDocumentProxy } from './pdfjs.ts'

export type PdfDocumentState = {
  document: PDFDocumentProxy | null
  errorMessage: string | null
}

type PdfDocumentStore = PdfDocumentState & {
  source: Uint8Array
}

export function usePdfDocument(data: Uint8Array): PdfDocumentState {
  const [store, setStore] = useState<PdfDocumentStore>({
    source: data,
    document: null,
    errorMessage: null,
  })

  if (store.source !== data) {
    setStore({
      source: data,
      document: null,
      errorMessage: null,
    })
  }

  useEffect(() => {
    let active = true
    let handedOff = false
    let aborted = false

    const task = getDocument({ data: data.slice() })

    task.promise.then(
      (pdfDocument) => {
        if (!active) {
          if (!aborted) {
            void pdfDocument.destroy().catch(() => undefined)
          }
          return
        }

        handedOff = true
        setStore({
          source: data,
          document: pdfDocument,
          errorMessage: null,
        })
      },
      (error: unknown) => {
        if (aborted || !active) {
          return
        }

        setStore({
          source: data,
          document: null,
          errorMessage: readPdfError(error),
        })
      },
    )

    return () => {
      active = false
      if (!handedOff) {
        aborted = true
        void task.destroy().catch(() => undefined)
      }
    }
  }, [data])

  useEffect(() => {
    const pdfDocument = store.document
    if (!pdfDocument) {
      return
    }

    return () => {
      void pdfDocument.destroy().catch(() => undefined)
    }
  }, [store.document])

  if (store.source !== data) {
    return { document: null, errorMessage: null }
  }

  return {
    document: store.document,
    errorMessage: store.errorMessage,
  }
}

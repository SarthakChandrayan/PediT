import { writeFileSync } from 'node:fs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

const pages = [
  { title: 'Invoice', body: 'Amount due today' },
  { title: 'Terms', body: 'Payment due in thirty days' },
  { title: 'Notes', body: 'Thank you for your business' },
]

for (const item of pages) {
  const page = pdf.addPage([612, 792])
  page.drawText(item.title, { x: 72, y: 720, size: 28, font: bold, color: rgb(0, 0, 0) })
  page.drawText(item.body, { x: 72, y: 680, size: 16, font, color: rgb(0, 0, 0) })
}

writeFileSync(new URL('./tmp-acceptance.pdf', import.meta.url), await pdf.save())
console.log('wrote tmp-acceptance.pdf')

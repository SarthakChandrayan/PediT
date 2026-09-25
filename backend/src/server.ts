import dotenv from 'dotenv'
import { createApp } from './app.js'

dotenv.config()

const port = readPort(process.env.PORT)
const app = createApp()

app.listen(port, 'localhost', () => {
  console.log(`PediT backend listening on http://localhost:${port}`)
})

function readPort(value: string | undefined): number {
  const parsed = Number(value ?? '8000')
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535.')
  }
  return parsed
}

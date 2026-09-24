import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { prisma } from './lib/prisma.js'
import { documentsRouter } from './routes/documents.js'

dotenv.config()

const port = readPort(process.env.PORT)

const app = express()

app.use(
  cors({
    origin: 'http://localhost:5173',
  }),
)
app.use(express.json())
app.use('/api/documents', documentsRouter)

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.get('/health/db', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    response.json({ status: 'ok', database: 'connected' })
  } catch {
    console.error('Database health check failed.')
    response.status(500).json({
      status: 'error',
      database: 'unavailable',
    })
  }
})

app.listen(port, 'localhost', () => {
  console.log(`PediT backend listening on http://localhost:${port}`)
})

function readPort(value: string | undefined): number {
  const port = Number(value ?? '8000')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535.')
  }
  return port
}

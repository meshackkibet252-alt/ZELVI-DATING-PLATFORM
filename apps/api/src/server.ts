
import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'

import { prisma } from './database.js'
import { registerRoutes } from './register.js'
import { registerVerificationRoutes } from './verification.js'
import { registerProfileRoutes } from './profile.js'
import { registerPhotoRoutes } from './photos.js'
import { registerPreferenceRoutes } from './preferences.js'
import { registerDiscoveryRoutes } from './discovery.js'
import { registerMatchingRoutes } from './matching.js'
import { registerMessagingRoutes } from './messaging.js'
import { registerWalletRoutes } from './wallet.js'
import { registerNotificationRoutes } from './notifications.js'
import { configureSocket } from './socket.js'

const app = Fastify({
  logger: true,
})

async function startServer() {
  await app.register(cors, {
    origin: [
      'http://localhost:5173',
      'https://zelvi-dating-platform.vercel.app',
    ],
    credentials: true,
  })

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  const jwtSecret = process.env.JWT_SECRET

  if (!jwtSecret || jwtSecret.length < 40) {
    throw new Error('JWT_SECRET is missing or too short')
  }

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 5 * 1024 * 1024,
    },
  })

  await app.register(jwt, {
    secret: jwtSecret,
    sign: {
      expiresIn: '15m',
    },
  })

  // Register API routes.
  await registerRoutes(app)
  await registerVerificationRoutes(app)
  await registerProfileRoutes(app)
  await registerPhotoRoutes(app)
  await registerPreferenceRoutes(app)
  await registerDiscoveryRoutes(app)
  await registerMatchingRoutes(app)
  await registerMessagingRoutes(app)
  await registerWalletRoutes(app)
  await registerNotificationRoutes(app)

  // Attach authenticated real-time messaging.
  configureSocket(app)

  app.get('/', async () => {
    return {
      name: 'ZELVI API',
      message: 'Welcome to ZELVI',
      status: 'running',
    }
  })

  app.get('/api/health', async () => {
    return {
      status: 'ok',
      service: 'ZELVI API',
      timestamp: new Date().toISOString(),
    }
  })

  app.get('/api/health/db', async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`

      return {
        status: 'ok',
        database: 'connected',
        provider: 'Neon PostgreSQL',
      }
    } catch (error) {
      request.log.error(error)

      return reply.code(503).send({
        status: 'error',
        database: 'unavailable',
      })
    }
  })

  app.addHook('onClose', async () => {
    await prisma.$disconnect()
  })

  const port = Number(process.env.PORT) || 4000
  const host = process.env.HOST || '0.0.0.0'

  try {
    await app.listen({ port, host })
    console.log(`ZELVI API running at http://localhost:${port}`)
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

startServer()

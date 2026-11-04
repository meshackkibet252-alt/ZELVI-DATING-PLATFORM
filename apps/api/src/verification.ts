
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomBytes, createHash } from 'node:crypto'
import { prisma } from './database.js'

const requestSchema = z.object({
  email: z.string().trim().email().max(254),
})

const verifySchema = z.object({
  token: z.string().min(32).max(256),
})

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function registerVerificationRoutes(app: FastifyInstance) {
  // REQUEST A VERIFICATION LINK
  app.post('/api/auth/verification/request', async (request, reply) => {
    const validation = requestSchema.safeParse(request.body)

    if (!validation.success) {
      return reply.code(400).send({
        error: 'Please provide a valid email address.',
      })
    }

    try {
      const user = await prisma.user.findUnique({
        where: {
          email: validation.data.email.toLowerCase(),
        },
        select: {
          id: true,
          status: true,
        },
      })

      // Avoid revealing whether an email is registered.
      if (!user || user.status !== 'PENDING_EMAIL') {
        return reply.send({
          message: 'If the account requires verification, instructions will be sent.',
        })
      }

      const token = randomBytes(32).toString('hex')
      const tokenHash = hashToken(token)
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000)

      await prisma.$transaction([
        prisma.emailVerificationToken.updateMany({
          where: {
            userId: user.id,
            usedAt: null,
          },
          data: {
            usedAt: new Date(),
          },
        }),

        prisma.emailVerificationToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt,
          },
        }),
      ])

      const response: {
        message: string
        verificationUrl?: string
      } = {
        message: 'Verification instructions have been prepared.',
      }

      // Local development only. Never expose tokens in production.
      if (process.env.NODE_ENV === 'development') {
        response.verificationUrl =
          `http://localhost:5173/verify-email?token=${token}`
      }

      return reply.send(response)
    } catch (error) {
      request.log.error(error)

      return reply.code(500).send({
        error: 'Unable to prepare verification instructions.',
      })
    }
  })

  // VERIFY EMAIL ADDRESS
  app.post('/api/auth/verification/verify', async (request, reply) => {
    const validation = verifySchema.safeParse(request.body)

    if (!validation.success) {
      return reply.code(400).send({
        error: 'Invalid verification token.',
      })
    }

    try {
      const tokenHash = hashToken(validation.data.token)

      const verification = await prisma.emailVerificationToken.findUnique({
        where: {
          tokenHash,
        },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          usedAt: true,
          user: {
            select: {
              status: true,
            },
          },
        },
      })

      if (
        !verification ||
        verification.usedAt ||
        verification.expiresAt <= new Date()
      ) {
        return reply.code(400).send({
          error: 'This verification link is invalid or has expired.',
        })
      }

      if (verification.user.status !== 'PENDING_EMAIL') {
        return reply.code(400).send({
          error: 'This account does not require verification.',
        })
      }

      await prisma.$transaction([
        prisma.emailVerificationToken.update({
          where: {
            id: verification.id,
          },
          data: {
            usedAt: new Date(),
          },
        }),

        prisma.user.update({
          where: {
            id: verification.userId,
          },
          data: {
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
          },
        }),
      ])

      return reply.send({
        message: 'Your email has been verified. You can now log in to ZELVI.',
      })
    } catch (error) {
      request.log.error(error)

      return reply.code(500).send({
        error: 'Email verification failed. Please try again.',
      })
    }
  })
}

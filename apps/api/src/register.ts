
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from './database.js'

const registrationSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72),
  displayName: z.string().trim().min(2).max(40),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  country: z.string().trim().min(2).max(80),
  countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/),
})

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(72),
})

function isAtLeast18(dateOfBirth: string): boolean {
  const date = new Date(`${dateOfBirth}T00:00:00.000Z`)

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== dateOfBirth
  ) {
    return false
  }

  const today = new Date()
  const cutoff = new Date(Date.UTC(
    today.getUTCFullYear() - 18,
    today.getUTCMonth(),
    today.getUTCDate(),
  ))

  return date <= cutoff
}

export async function registerRoutes(app: FastifyInstance) {
  // CREATE ACCOUNT
  app.post('/api/auth/register', async (request, reply) => {
    const validation = registrationSchema.safeParse(request.body)

    if (!validation.success) {
      return reply.code(400).send({
        error: 'Invalid registration details',
        details: validation.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
    }

    const data = validation.data
    const email = data.email.toLowerCase()

    if (!isAtLeast18(data.dateOfBirth)) {
      return reply.code(400).send({
        error: 'You must be at least 18 years old to join ZELVI.',
      })
    }

    try {
      const passwordHash = await bcrypt.hash(data.password, 12)

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          status: 'PENDING_EMAIL',

          profile: {
            create: {
              displayName: data.displayName,
              dateOfBirth: new Date(`${data.dateOfBirth}T00:00:00.000Z`),
              country: data.country,
              countryCode: data.countryCode.toUpperCase(),
            },
          },

          creditTransactions: {
            create: {
              type: 'WELCOME_GRANT',
              amount: 20,
              description: 'ZELVI welcome message credits',
              idempotencyKey: `welcome:${email}`,
            },
          },
        },

        select: {
          id: true,
          email: true,
          status: true,
          createdAt: true,
        },
      })

      return reply.code(201).send({
        message: 'Your ZELVI account has been created. Please verify your email.',
        user,
        welcomeCredits: 20,
      })
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        return reply.code(409).send({
          error: 'An account with this email already exists.',
        })
      }

      request.log.error(error)

      return reply.code(500).send({
        error: 'Registration failed. Please try again later.',
      })
    }
  })

  // USER LOGIN
  app.post('/api/auth/login', async (request, reply) => {
    const validation = loginSchema.safeParse(request.body)

    if (!validation.success) {
      return reply.code(400).send({
        error: 'Please provide a valid email and password.',
      })
    }

    const email = validation.data.email.toLowerCase()
    const password = validation.data.password

    try {
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          status: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      })

      if (!user) {
        return reply.code(401).send({
          error: 'Invalid email or password.',
        })
      }

      const passwordMatches = await bcrypt.compare(
        password,
        user.passwordHash,
      )

      if (!passwordMatches) {
        return reply.code(401).send({
          error: 'Invalid email or password.',
        })
      }

      if (user.status === 'PENDING_EMAIL') {
        return reply.code(403).send({
          error: 'Please verify your email before logging in.',
          code: 'EMAIL_NOT_VERIFIED',
        })
      }

      if (user.status !== 'ACTIVE') {
        return reply.code(403).send({
          error: 'This account is not currently available.',
        })
      }

      const token = app.jwt.sign({
        sub: user.id,
        email: user.email,
      })

      return reply.send({
        message: 'Login successful.',
        token,
        tokenType: 'Bearer',
        expiresIn: '15m',
        user: {
          id: user.id,
          email: user.email,
          displayName: user.profile?.displayName ?? null,
        },
      })
    } catch (error) {
      request.log.error(error)

      return reply.code(500).send({
        error: 'Login failed. Please try again later.',
      })
    }
  })
}

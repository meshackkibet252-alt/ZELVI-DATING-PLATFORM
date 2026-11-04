
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './database.js'

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(40).optional(),

  city: z.string().trim().max(80).nullable().optional(),

  bio: z.string().trim().max(500).nullable().optional(),

  interests: z.array(
    z.string().trim().min(1).max(30)
  ).max(20).optional(),

  gender: z.enum([
    'MALE',
    'FEMALE',
    'NON_BINARY',
    'PREFER_NOT_TO_SAY',
  ]).nullable().optional(),

  showGender: z.boolean().optional(),

  relationshipIntent: z.enum([
    'FRIENDSHIP',
    'DATING',
    'BOTH',
  ]).optional(),
}).strict().refine(
  data => Object.keys(data).length > 0,
  { message: 'Provide at least one profile field to update.' },
)

async function getAuthenticatedUserId(request: any): Promise<string> {
  await request.jwtVerify()
  return request.user.sub
}

export async function registerProfileRoutes(app: FastifyInstance) {
  app.get('/api/profile/me', async (request, reply) => {
    try {
      const userId = await getAuthenticatedUserId(request)

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          status: true,
          emailVerifiedAt: true,
          profile: {
            select: {
              id: true,
              displayName: true,
              city: true,
              bio: true,
              interests: true,
              gender: true,
              showGender: true,
              relationshipIntent: true,
              country: true,
              countryCode: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          createdAt: true,
        },
      })

      if (!user || user.status !== 'ACTIVE') {
        return reply.code(403).send({
          error: 'Your account is not available.',
        })
      }

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          status: user.status,
          emailVerifiedAt: user.emailVerifiedAt,
          createdAt: user.createdAt,
        },
        profile: user.profile,
      })
    } catch {
      return reply.code(401).send({
        error: 'Authentication required.',
      })
    }
  })

  app.patch('/api/profile/me', async (request, reply) => {
    try {
      const userId = await getAuthenticatedUserId(request)

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { status: true },
      })

      if (!user || user.status !== 'ACTIVE') {
        return reply.code(403).send({
          error: 'Your account is not available.',
        })
      }

      const validation = updateProfileSchema.safeParse(request.body)

      if (!validation.success) {
        return reply.code(400).send({
          error: 'Invalid profile details.',
          details: validation.error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        })
      }

      const profile = await prisma.profile.update({
        where: { userId },
        data: validation.data,
      })

      return reply.send({
        message: 'Your profile has been updated.',
        profile,
      })
    } catch (error: any) {
      if (error?.code === 'P2025') {
        return reply.code(404).send({
          error: 'Profile not found.',
        })
      }

      if (
        error?.statusCode === 401 ||
        error?.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER'
      ) {
        return reply.code(401).send({
          error: 'Authentication required.',
        })
      }

      request.log.error(error)

      return reply.code(500).send({
        error: 'Unable to update your profile.',
      })
    }
  })
}



import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './database.js'

const genderValues = [
  'MALE',
  'FEMALE',
  'NON_BINARY',
  'PREFER_NOT_TO_SAY',
] as const

const relationshipValues = [
  'FRIENDSHIP',
  'DATING',
  'BOTH',
] as const

const preferenceSchema = z.object({
  gender: z.enum(genderValues).nullable().optional(),
  showGender: z.boolean().optional(),
  relationshipIntent: z.enum(relationshipValues).optional(),
  minimumAge: z.number().int().min(18).max(99).optional(),
  maximumAge: z.number().int().min(18).max(99).optional(),
  preferredGenders: z.array(z.enum(genderValues)).max(4).optional(),
  preferredCountries: z.array(
    z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)
  ).max(250).optional(),
  excludedCountries: z.array(
    z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)
  ).max(250).optional(),
  preferredInterests: z.array(
    z.string().trim().min(1).max(30)
  ).max(20).optional(),
}).strict().refine(
  data => Object.keys(data).length > 0,
  { message: 'Provide at least one preference to update.' },
).refine(
  data => data.minimumAge === undefined ||
    data.maximumAge === undefined ||
    data.minimumAge <= data.maximumAge,
  {
    message: 'Minimum age cannot exceed maximum age.',
    path: ['minimumAge'],
  },
).refine(
  data => !data.preferredCountries ||
    !data.excludedCountries ||
    !data.preferredCountries.some(country =>
      data.excludedCountries!.includes(country)
    ),
  {
    message: 'A country cannot be both preferred and excluded.',
    path: ['preferredCountries'],
  },
)

async function getAuthenticatedUserId(request: any): Promise<string> {
  await request.jwtVerify()
  return request.user.sub
}

async function getActiveProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      profile: { select: { id: true } },
    },
  })

  if (user?.status !== 'ACTIVE' || !user.profile) {
    return null
  }

  return user.profile
}

export async function registerPreferenceRoutes(app: FastifyInstance) {
  app.get('/api/preferences/me', async (request, reply) => {
    try {
      const userId = await getAuthenticatedUserId(request)
      const profile = await getActiveProfile(userId)

      if (!profile) {
        return reply.code(403).send({
          error: 'Your account is not available.',
        })
      }

      const [details, preferences] = await Promise.all([
        prisma.profile.findUnique({
          where: { id: profile.id },
          select: {
            gender: true,
            showGender: true,
            relationshipIntent: true,
          },
        }),
        prisma.discoveryPreference.findUnique({
          where: { profileId: profile.id },
        }),
      ])

      return reply.send({
        profile: details,
        preferences: preferences ?? {
          minimumAge: 18,
          maximumAge: 99,
          preferredGenders: [],
          preferredCountries: [],
          excludedCountries: [],
          preferredInterests: [],
        },
      })
    } catch (error: any) {
      if (error?.statusCode === 401 ||
          error?.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
        return reply.code(401).send({
          error: 'Authentication required.',
        })
      }

      request.log.error(error)
      return reply.code(500).send({
        error: 'Unable to retrieve your preferences.',
      })
    }
  })

  app.patch('/api/preferences/me', async (request, reply) => {
    try {
      const userId = await getAuthenticatedUserId(request)
      const profile = await getActiveProfile(userId)

      if (!profile) {
        return reply.code(403).send({
          error: 'Your account is not available.',
        })
      }

      const validation = preferenceSchema.safeParse(request.body)

      if (!validation.success) {
        return reply.code(400).send({
          error: 'Invalid preference details.',
          details: validation.error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        })
      }

      const data = validation.data

      const profileData = {
        ...(data.gender !== undefined && { gender: data.gender }),
        ...(data.showGender !== undefined && { showGender: data.showGender }),
        ...(data.relationshipIntent !== undefined && {
          relationshipIntent: data.relationshipIntent,
        }),
      }

      const preferenceData = {
        ...(data.minimumAge !== undefined && { minimumAge: data.minimumAge }),
        ...(data.maximumAge !== undefined && { maximumAge: data.maximumAge }),
        ...(data.preferredGenders !== undefined && {
          preferredGenders: data.preferredGenders,
        }),
        ...(data.preferredCountries !== undefined && {
          preferredCountries: data.preferredCountries,
        }),
        ...(data.excludedCountries !== undefined && {
          excludedCountries: data.excludedCountries,
        }),
        ...(data.preferredInterests !== undefined && {
          preferredInterests: data.preferredInterests,
        }),
      }

      await prisma.$transaction(async tx => {
        if (Object.keys(profileData).length > 0) {
          await tx.profile.update({
            where: { id: profile.id },
            data: profileData,
          })
        }

        if (Object.keys(preferenceData).length > 0) {
          await tx.discoveryPreference.upsert({
            where: { profileId: profile.id },
            create: {
              profileId: profile.id,
              ...preferenceData,
            },
            update: preferenceData,
          })
        }
      })

      const [updatedProfile, updatedPreferences] = await Promise.all([
        prisma.profile.findUnique({
          where: { id: profile.id },
          select: {
            gender: true,
            showGender: true,
            relationshipIntent: true,
          },
        }),
        prisma.discoveryPreference.findUnique({
          where: { profileId: profile.id },
        }),
      ])

      return reply.send({
        message: 'Your discovery preferences have been updated.',
        profile: updatedProfile,
        preferences: updatedPreferences,
      })
    } catch (error: any) {
      if (error?.statusCode === 401 ||
          error?.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
        return reply.code(401).send({
          error: 'Authentication required.',
        })
      }

      request.log.error(error)
      return reply.code(500).send({
        error: 'Unable to update your preferences.',
      })
    }
  })
}

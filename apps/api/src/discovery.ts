import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './database.js'

type Gender = 'MALE' | 'FEMALE' | 'NON_BINARY' | 'PREFER_NOT_TO_SAY'
type Intent = 'FRIENDSHIP' | 'DATING' | 'BOTH'
type LikeIntent = 'FRIENDSHIP' | 'DATING'

function getAuthenticatedUserId(request: any): string {
  return request.user?.sub ?? request.user?.id
}

function getAge(dateOfBirth: Date): number {
  const today = new Date()
  let age = today.getFullYear() - dateOfBirth.getFullYear()

  const birthdayHasNotOccurred =
    today.getMonth() < dateOfBirth.getMonth() ||
    (
      today.getMonth() === dateOfBirth.getMonth() &&
      today.getDate() < dateOfBirth.getDate()
    )

  if (birthdayHasNotOccurred) age--

  return age
}

function getIntentions(intent: Intent): LikeIntent[] {
  if (intent === 'BOTH') return ['FRIENDSHIP', 'DATING']
  return [intent]
}

function hasGenderCompatibility(
  currentGender: Gender | null,
  candidateGender: Gender | null,
  currentPreferredGenders: Gender[],
  candidatePreferredGenders: Gender[],
): boolean {
  if (
    currentPreferredGenders.length > 0 &&
    (!candidateGender || !currentPreferredGenders.includes(candidateGender))
  ) {
    return false
  }

  if (
    candidatePreferredGenders.length > 0 &&
    (!currentGender || !candidatePreferredGenders.includes(currentGender))
  ) {
    return false
  }

  return true
}

function hasInterestCompatibility(
  currentInterests: string[],
  candidateInterests: string[],
  currentPreferredInterests: string[],
  candidatePreferredInterests: string[],
): boolean {
  const currentInterestSet = new Set(
    currentInterests.map((item) => item.toLowerCase()),
  )

  const candidateInterestSet = new Set(
    candidateInterests.map((item) => item.toLowerCase()),
  )

  if (
    currentPreferredInterests.length > 0 &&
    !currentPreferredInterests.some((item) =>
      candidateInterestSet.has(item.toLowerCase()),
    )
  ) {
    return false
  }

  if (
    candidatePreferredInterests.length > 0 &&
    !candidatePreferredInterests.some((item) =>
      currentInterestSet.has(item.toLowerCase()),
    )
  ) {
    return false
  }

  return true
}

const discoveryQuerySchema = z.object({
  intent: z.enum(['FRIENDSHIP', 'DATING']).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(20),
})

export async function registerDiscoveryRoutes(app: FastifyInstance) {
  app.get('/api/discovery/profiles', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)

      if (!userId) {
        return reply.code(401).send({
          error: 'Authentication required',
        })
      }

      const parsedQuery = discoveryQuerySchema.safeParse(request.query)

      if (!parsedQuery.success) {
        return reply.code(400).send({
          error: 'Invalid discovery filters',
        })
      }

      const { intent, limit } = parsedQuery.data

      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: {
            include: {
              discoveryPreference: true,
            },
          },
        },
      })

      if (
        !currentUser ||
        currentUser.status !== 'ACTIVE' ||
        !currentUser.emailVerifiedAt ||
        !currentUser.profile
      ) {
        return reply.code(403).send({
          error: 'An active, verified account with a profile is required',
        })
      }

      const currentProfile = currentUser.profile
      const currentAge = getAge(currentProfile.dateOfBirth)

      if (currentAge < 18) {
        return reply.code(403).send({
          error: 'ZELVI is available to adults aged 18 and above',
        })
      }

      const currentPreference = currentProfile.discoveryPreference

      const minimumAge = currentPreference?.minimumAge ?? 18
      const maximumAge = currentPreference?.maximumAge ?? 99

      const preferredGenders = currentPreference?.preferredGenders ?? []
      const preferredCountries = currentPreference?.preferredCountries ?? []
      const excludedCountries = currentPreference?.excludedCountries ?? []
      const preferredInterests = currentPreference?.preferredInterests ?? []

      const currentIntentions = getIntentions(
        currentProfile.relationshipIntent as Intent,
      )

      const profiles = await prisma.profile.findMany({
        where: {
          id: { not: currentProfile.id },

          countryCode:
            preferredCountries.length > 0
              ? { in: preferredCountries }
              : undefined,

          
          blocksInitiated: {
            none: {
              blockedProfileId: currentProfile.id,
            },
          },

          blocksReceived: {
            none: {
              blockerProfileId: currentProfile.id,
            },
          },

          receivedLikes: {
            none: {
              fromProfileId: currentProfile.id,
            },
          },

          user: {
            is: {
              status: 'ACTIVE',
              emailVerifiedAt: { not: null },
            },
          },
        },
        include: {
          discoveryPreference: true,
          user: {
            select: {
              status: true,
              emailVerifiedAt: true,
            },
          },
          photos: {
            where: {
              visibility: 'PUBLIC',
            },
            orderBy: [
              { isPrimary: 'desc' },
              { createdAt: 'asc' },
            ],
            take: 1,
            select: {
              id: true,
              secureUrl: true,
              isPrimary: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 500,
      })

      const compatibleProfiles = profiles.filter((candidate) => {
        const candidateAge = getAge(candidate.dateOfBirth)

        if (candidateAge < 18) return false

        if (
          candidateAge < minimumAge ||
          candidateAge > maximumAge
        ) {
          return false
        }

        if (excludedCountries.includes(candidate.countryCode)) {
          return false
        }

        const candidatePreference = candidate.discoveryPreference

        const candidateMinimumAge =
          candidatePreference?.minimumAge ?? 18

        const candidateMaximumAge =
          candidatePreference?.maximumAge ?? 99

        if (
          currentAge < candidateMinimumAge ||
          currentAge > candidateMaximumAge
        ) {
          return false
        }

        const candidatePreferredCountries =
          candidatePreference?.preferredCountries ?? []

        const candidateExcludedCountries =
          candidatePreference?.excludedCountries ?? []

        if (
          candidatePreferredCountries.length > 0 &&
          !candidatePreferredCountries.includes(currentProfile.countryCode)
        ) {
          return false
        }

        if (
          candidateExcludedCountries.includes(currentProfile.countryCode)
        ) {
          return false
        }

        const candidatePreferredGenders =
          candidatePreference?.preferredGenders ?? []

        if (
          !hasGenderCompatibility(
            currentProfile.gender as Gender | null,
            candidate.gender as Gender | null,
            preferredGenders as Gender[],
            candidatePreferredGenders as Gender[],
          )
        ) {
          return false
        }

        const candidateIntentions = getIntentions(
          candidate.relationshipIntent as Intent,
        )

        const commonIntentions = currentIntentions.filter((value) =>
          candidateIntentions.includes(value),
        )

        if (commonIntentions.length === 0) return false

        if (intent && !commonIntentions.includes(intent)) {
          return false
        }

        if (
          preferredInterests.length > 0 &&
          !preferredInterests.some((item) =>
            candidate.interests.some(
              (interest) =>
                interest.toLowerCase() === item.toLowerCase(),
            ),
          )
        ) {
          return false
        }

        const candidatePreferredInterests =
          candidatePreference?.preferredInterests ?? []

        if (
          !hasInterestCompatibility(
            currentProfile.interests,
            candidate.interests,
            preferredInterests,
            candidatePreferredInterests,
          )
        ) {
          return false
        }

        return true
      })

      const results = compatibleProfiles.slice(0, limit).map((profile) => {
        const commonIntentions = currentIntentions.filter((value) =>
          getIntentions(profile.relationshipIntent as Intent).includes(value),
        )

        return {
          id: profile.id,
          displayName: profile.displayName,
          age: getAge(profile.dateOfBirth),
          country: profile.country,
          countryCode: profile.countryCode,
          city: profile.city,
          bio: profile.bio,
          interests: profile.interests,
          relationshipIntent: profile.relationshipIntent,
          compatibleIntents: intent
            ? commonIntentions.filter((value) => value === intent)
            : commonIntentions,
          gender: profile.showGender ? profile.gender : null,
          photo: profile.photos[0] ?? null,
        }
      })

      return reply.send({
        profiles: results,
        count: results.length,
        limit,
      })
    } catch (error: any) {
      if (error?.statusCode === 401) {
        return reply.code(401).send({
          error: 'Invalid or expired authentication token',
        })
      }

      request.log.error(error)

      return reply.code(500).send({
        error: 'Unable to load discovery profiles',
      })
    }
  })
}
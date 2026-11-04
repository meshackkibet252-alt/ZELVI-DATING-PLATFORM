
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './database.js'

function getAuthenticatedUserId(request: any): string {
  return request.user?.sub ?? request.user?.id
}

const likeSchema = z.object({
  profileId: z.string().min(1),
  intent: z.enum(['FRIENDSHIP', 'DATING']),
})

export async function registerMatchingRoutes(app: FastifyInstance) {
  // Send a like and create a match if the like is mutual.
  app.post('/api/matching/like', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)

      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const parsed = likeSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'A valid profileId and like intent are required',
        })
      }

      const { profileId, intent } = parsed.data

      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true },
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

      if (currentProfile.id === profileId) {
        return reply.code(400).send({
          error: 'You cannot like your own profile',
        })
      }

      const targetProfile = await prisma.profile.findFirst({
        where: {
          id: profileId,
          user: {
            is: {
              status: 'ACTIVE',
              emailVerifiedAt: { not: null },
            },
          },
        },
        include: {
          user: true,
        },
      })

      if (!targetProfile) {
        return reply.code(404).send({
          error: 'Profile not found or unavailable',
        })
      }

      const currentIntentions =
        currentProfile.relationshipIntent === 'BOTH'
          ? ['FRIENDSHIP', 'DATING']
          : [currentProfile.relationshipIntent]

      const targetIntentions =
        targetProfile.relationshipIntent === 'BOTH'
          ? ['FRIENDSHIP', 'DATING']
          : [targetProfile.relationshipIntent]

      if (
        !currentIntentions.includes(intent) ||
        !targetIntentions.includes(intent)
      ) {
        return reply.code(400).send({
          error: 'This relationship intention is not compatible',
        })
      }

      const existingBlock = await prisma.profileBlock.findFirst({
        where: {
          OR: [
            {
              blockerProfileId: currentProfile.id,
              blockedProfileId: targetProfile.id,
            },
            {
              blockerProfileId: targetProfile.id,
              blockedProfileId: currentProfile.id,
            },
          ],
        },
      })

      if (existingBlock) {
        return reply.code(403).send({
          error: 'This interaction is not available',
        })
      }

      const profileAId =
        currentProfile.id < targetProfile.id
          ? currentProfile.id
          : targetProfile.id

      const profileBId =
        currentProfile.id < targetProfile.id
          ? targetProfile.id
          : currentProfile.id

      const existingMatch = await prisma.match.findUnique({
        where: {
          profileAId_profileBId: {
            profileAId,
            profileBId,
          },
        },
      })

      if (existingMatch) {
        return reply.send({
          matched: true,
          alreadyMatched: true,
          match: existingMatch,
        })
      }

      const existingLike = await prisma.profileLike.findUnique({
        where: {
          fromProfileId_toProfileId: {
            fromProfileId: currentProfile.id,
            toProfileId: targetProfile.id,
          },
        },
      })

      if (existingLike) {
        if (existingLike.intent !== intent) {
          return reply.code(409).send({
            error: 'You have already liked this profile with another intention',
          })
        }

        return reply.send({
          liked: true,
          matched: false,
          message: 'You have already liked this profile',
        })
      }

      const reciprocalLike = await prisma.profileLike.findUnique({
        where: {
          fromProfileId_toProfileId: {
            fromProfileId: targetProfile.id,
            toProfileId: currentProfile.id,
          },
        },
      })

      if (reciprocalLike && reciprocalLike.intent !== intent) {
        return reply.code(409).send({
          error: 'Your like intentions do not match',
          message: 'Both people must choose the same relationship intention',
        })
      }

      try {
        const result = await prisma.$transaction(async (tx) => {
          // Save the like.
          const like = await tx.profileLike.create({
            data: {
              fromProfileId: currentProfile.id,
              toProfileId: targetProfile.id,
              intent,
            },
          })

          // Notify the person who received the like.
          await tx.notification.create({
            data: {
              userId: targetProfile.user.id,
              actorProfileId: currentProfile.id,
              type: 'LIKE_RECEIVED',
              title: 'New like!',
              body: `${currentProfile.displayName} liked your profile`,
              entityId: like.id,
              idempotencyKey: `like:${like.id}`,
            },
          })

          // No mutual like yet.
          if (!reciprocalLike) {
            return {
              matched: false,
              match: null,
            }
          }

          // Create the mutual match.
          const match = await tx.match.create({
            data: {
              profileAId,
              profileBId,
              intent,
            },
          })

          // Notify both users about the match.
          await tx.notification.createMany({
            data: [
              {
                userId: currentUser.id,
                actorProfileId: targetProfile.id,
                type: 'MATCH_CREATED',
                title: "It's a match!",
                body: `You and ${targetProfile.displayName} matched`,
                entityId: match.id,
                idempotencyKey: `match:${match.id}:${currentUser.id}`,
              },
              {
                userId: targetProfile.user.id,
                actorProfileId: currentProfile.id,
                type: 'MATCH_CREATED',
                title: "It's a match!",
                body: `You and ${currentProfile.displayName} matched`,
                entityId: match.id,
                idempotencyKey: `match:${match.id}:${targetProfile.user.id}`,
              },
            ],
            skipDuplicates: true,
          })

          return {
            matched: true,
            match,
          }
        })

        return reply.code(201).send({
          liked: true,
          matched: result.matched,
          message: result.matched
            ? "It's a match!"
            : 'Like sent successfully',
          match: result.match,
        })
      } catch (error: any) {
        if (error?.code === 'P2002') {
          const match = await prisma.match.findUnique({
            where: {
              profileAId_profileBId: {
                profileAId,
                profileBId,
              },
            },
          })

          if (match) {
            return reply.send({
              liked: true,
              matched: true,
              message: "It's a match!",
              match,
            })
          }

          return reply.code(409).send({
            error: 'This like has already been processed',
          })
        }

        throw error
      }
    } catch (error: any) {
      if (error?.statusCode === 401) {
        return reply.code(401).send({
          error: 'Invalid or expired authentication token',
        })
      }

      request.log.error(error)

      return reply.code(500).send({
        error: 'Unable to process like',
      })
    }
  })

  // List the authenticated user's matches.
  app.get('/api/matching/matches', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)

      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true },
      })

      if (
        !user ||
        user.status !== 'ACTIVE' ||
        !user.emailVerifiedAt ||
        !user.profile
      ) {
        return reply.code(403).send({
          error: 'An active, verified account with a profile is required',
        })
      }

      const profileId = user.profile.id

      const matches = await prisma.match.findMany({
        where: {
          OR: [
            { profileAId: profileId },
            { profileBId: profileId },
          ],
        },
        include: {
          profileA: {
            select: {
              id: true,
              displayName: true,
              country: true,
              countryCode: true,
              city: true,
              photos: {
                where: { visibility: 'PUBLIC' },
                orderBy: [
                  { isPrimary: 'desc' },
                  { createdAt: 'asc' },
                ],
                take: 1,
                select: {
                  id: true,
                  secureUrl: true,
                },
              },
            },
          },
          profileB: {
            select: {
              id: true,
              displayName: true,
              country: true,
              countryCode: true,
              city: true,
              photos: {
                where: { visibility: 'PUBLIC' },
                orderBy: [
                  { isPrimary: 'desc' },
                  { createdAt: 'asc' },
                ],
                take: 1,
                select: {
                  id: true,
                  secureUrl: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })

      const results = matches.map((match) => ({
        id: match.id,
        intent: match.intent,
        createdAt: match.createdAt,
        profile:
          match.profileAId === profileId
            ? match.profileB
            : match.profileA,
      }))

      return reply.send({
        matches: results,
        count: results.length,
      })
    } catch (error: any) {
      if (error?.statusCode === 401) {
        return reply.code(401).send({
          error: 'Invalid or expired authentication token',
        })
      }

      request.log.error(error)

      return reply.code(500).send({
        error: 'Unable to load matches',
      })
    }
  })

  // End a match.
  app.delete('/api/matching/matches/:matchId', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)

      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const paramsSchema = z.object({
        matchId: z.string().min(1),
      })

      const parsed = paramsSchema.safeParse(request.params)

      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid match ID' })
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true },
      })

      if (
        !user ||
        user.status !== 'ACTIVE' ||
        !user.emailVerifiedAt ||
        !user.profile
      ) {
        return reply.code(403).send({
          error: 'An active, verified account with a profile is required',
        })
      }

      const match = await prisma.match.findFirst({
        where: {
          id: parsed.data.matchId,
          OR: [
            { profileAId: user.profile.id },
            { profileBId: user.profile.id },
          ],
        },
      })

      if (!match) {
        return reply.code(404).send({
          error: 'Match not found',
        })
      }

      await prisma.match.delete({
        where: { id: match.id },
      })

      return reply.send({
        success: true,
        message: 'Match removed successfully',
      })
    } catch (error: any) {
      if (error?.statusCode === 401) {
        return reply.code(401).send({
          error: 'Invalid or expired authentication token',
        })
      }

      request.log.error(error)

      return reply.code(500).send({
        error: 'Unable to remove match',
      })
    }
  })
}

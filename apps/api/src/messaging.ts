
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './database.js'
import { getSocketServer } from './socket.js'

function getAuthenticatedUserId(request: any): string {
  return request.user?.sub ?? request.user?.id
}

async function getActiveProfile(userId: string) {
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
    return null
  }

  return user.profile
}

const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  idempotencyKey: z.string().min(8).max(128).optional(),
})

export async function registerMessagingRoutes(app: FastifyInstance) {

  // List conversations belonging to the authenticated profile.
  app.get('/api/messages/conversations', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)

      if (!userId) {
        return reply.code(401).send({
          error: 'Authentication required',
        })
      }

      const profile = await getActiveProfile(userId)

      if (!profile) {
        return reply.code(403).send({
          error: 'An active, verified account is required',
        })
      }

      const matches = await prisma.match.findMany({
        where: {
          OR: [
            { profileAId: profile.id },
            { profileBId: profile.id },
          ],
        },
        include: {
          profileA: {
            select: {
              id: true,
              displayName: true,
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
          conversation: {
            include: {
              messages: {
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      const conversations = await Promise.all(
        matches.map(async (match) => {
          const otherProfileId =
            match.profileAId === profile.id
              ? match.profileBId
              : match.profileAId

          const blocked = await prisma.profileBlock.findFirst({
            where: {
              OR: [
                {
                  blockerProfileId: profile.id,
                  blockedProfileId: otherProfileId,
                },
                {
                  blockerProfileId: otherProfileId,
                  blockedProfileId: profile.id,
                },
              ],
            },
          })

          if (blocked) return null

          const otherProfile =
            match.profileAId === profile.id
              ? match.profileB
              : match.profileA

          return {
            matchId: match.id,
            intent: match.intent,
            conversationId: match.conversation?.id ?? null,
            otherProfile,
            lastMessage: match.conversation?.messages[0] ?? null,
            createdAt: match.createdAt,
          }
        }),
      )

      const visibleConversations = conversations.filter(Boolean)

      return reply.send({
        conversations: visibleConversations,
        count: visibleConversations.length,
      })
    } catch (error: any) {
      if (error?.statusCode === 401) {
        return reply.code(401).send({
          error: 'Invalid or expired authentication token',
        })
      }

      request.log.error(error)

      return reply.code(500).send({
        error: 'Unable to load conversations',
      })
    }
  })

  // Retrieve message history.
  app.get('/api/messages/:conversationId', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)

      if (!userId) {
        return reply.code(401).send({
          error: 'Authentication required',
        })
      }

      const profile = await getActiveProfile(userId)

      if (!profile) {
        return reply.code(403).send({
          error: 'An active, verified account is required',
        })
      }

      const params = z.object({
        conversationId: z.string().min(1),
      }).safeParse(request.params)

      if (!params.success) {
        return reply.code(400).send({
          error: 'Invalid conversation ID',
        })
      }

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: params.data.conversationId,
          match: {
            OR: [
              { profileAId: profile.id },
              { profileBId: profile.id },
            ],
          },
        },
        include: {
          match: true,
        },
      })

      if (!conversation) {
        return reply.code(404).send({
          error: 'Conversation not found',
        })
      }

      const otherProfileId =
        conversation.match.profileAId === profile.id
          ? conversation.match.profileBId
          : conversation.match.profileAId

      const blocked = await prisma.profileBlock.findFirst({
        where: {
          OR: [
            {
              blockerProfileId: profile.id,
              blockedProfileId: otherProfileId,
            },
            {
              blockerProfileId: otherProfileId,
              blockedProfileId: profile.id,
            },
          ],
        },
      })

      if (blocked) {
        return reply.code(403).send({
          error: 'Messaging is unavailable',
        })
      }

      const messages = await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
          status: 'SENT',
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: 200,
        select: {
          id: true,
          senderProfileId: true,
          content: true,
          status: true,
          createdAt: true,
        },
      })

      return reply.send({
        conversationId: conversation.id,
        messages,
        count: messages.length,
      })
    } catch (error: any) {
      if (error?.statusCode === 401) {
        return reply.code(401).send({
          error: 'Invalid or expired authentication token',
        })
      }

      request.log.error(error)

      return reply.code(500).send({
        error: 'Unable to load messages',
      })
    }
  })

  // Send a message, deduct one credit, create a notification,
  // and broadcast the committed result through Socket.IO.
  app.post('/api/messages/:conversationId', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)

      if (!userId) {
        return reply.code(401).send({
          error: 'Authentication required',
        })
      }

      const profile = await getActiveProfile(userId)

      if (!profile) {
        return reply.code(403).send({
          error: 'An active, verified account is required',
        })
      }

      const params = z.object({
        conversationId: z.string().min(1),
      }).safeParse(request.params)

      const body = sendMessageSchema.safeParse(request.body)

      if (!params.success || !body.success) {
        return reply.code(400).send({
          error: 'Invalid conversation ID or message content',
        })
      }

      const { conversationId } = params.data
      const { content, idempotencyKey } = body.data

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          match: {
            OR: [
              { profileAId: profile.id },
              { profileBId: profile.id },
            ],
          },
        },
        include: {
          match: true,
        },
      })

      if (!conversation) {
        return reply.code(404).send({
          error: 'Conversation not found',
        })
      }

      const recipientProfileId =
        conversation.match.profileAId === profile.id
          ? conversation.match.profileBId
          : conversation.match.profileAId

      const blocked = await prisma.profileBlock.findFirst({
        where: {
          OR: [
            {
              blockerProfileId: profile.id,
              blockedProfileId: recipientProfileId,
            },
            {
              blockerProfileId: recipientProfileId,
              blockedProfileId: profile.id,
            },
          ],
        },
      })

      if (blocked) {
        return reply.code(403).send({
          error: 'Messaging is unavailable',
        })
      }

      const recipient = await prisma.profile.findFirst({
        where: {
          id: recipientProfileId,
          user: {
            is: {
              status: 'ACTIVE',
              emailVerifiedAt: { not: null },
            },
          },
        },
      })

      if (!recipient) {
        return reply.code(403).send({
          error: 'The recipient account is unavailable',
        })
      }

      if (idempotencyKey) {
        const previousMessage = await prisma.message.findUnique({
          where: { idempotencyKey },
        })

        if (previousMessage) {
          if (
            previousMessage.senderProfileId !== profile.id ||
            previousMessage.conversationId !== conversation.id
          ) {
            return reply.code(409).send({
              error: 'Idempotency key already used',
            })
          }

          return reply.send({
            sent: true,
            duplicate: true,
            message: previousMessage,
          })
        }
      }

      const messageKey = idempotencyKey
        ? `message:${idempotencyKey}`
        : `message:${crypto.randomUUID()}`

      const transactionKey = `credit:${messageKey}`

      const result = await prisma.$transaction(
        async (tx) => {
          if (idempotencyKey) {
            const previous = await tx.message.findUnique({
              where: { idempotencyKey },
            })

            if (previous) {
              if (
                previous.senderProfileId !== profile.id ||
                previous.conversationId !== conversation.id
              ) {
                throw new Error('IDEMPOTENCY_CONFLICT')
              }

              return {
                message: previous,
                duplicate: true,
                balance: null,
              }
            }
          }

          const ledger = await tx.creditTransaction.aggregate({
            where: { userId },
            _sum: { amount: true },
          })

          const balance = ledger._sum.amount ?? 0

          if (balance < 1) {
            throw new Error('INSUFFICIENT_CREDITS')
          }

          const message = await tx.message.create({
            data: {
              conversationId: conversation.id,
              senderProfileId: profile.id,
              content,
              idempotencyKey,
            },
          })

          await tx.creditTransaction.create({
            data: {
              userId,
              type: 'MESSAGE_SENT',
              amount: -1,
              description: 'Outgoing message',
              reference: message.id,
              idempotencyKey: transactionKey,
            },
          })

          const notification = await tx.notification.create({
            data: {
              userId: recipient.userId,
              actorProfileId: profile.id,
              type: 'MESSAGE_RECEIVED',
              title: 'New message',
              body: `${profile.displayName} sent you a message`,
              entityId: message.id,
              idempotencyKey: `message:${message.id}`,
            },
          })

          return {
            message,
            notification,
            duplicate: false,
            balance: balance - 1,
          }
        },
        {
          isolationLevel: 'Serializable',
        },
      )

      // Broadcast only after the database transaction commits.
      // Duplicate requests are never broadcast again.
      if (!result.duplicate) {
        const io = getSocketServer()

        if (io) {
          io.to(`conversation:${conversation.id}`).emit(
            'message:new',
            {
              conversationId: conversation.id,
              message: result.message,
            },
          )

          io.to(`user:${recipient.userId}`).emit(
            'notification:new',
            {
              notification: result.notification,
            },
          )
        }
      }

      return reply.code(result.duplicate ? 200 : 201).send({
        sent: true,
        duplicate: result.duplicate,
        message: result.message,
        remainingCredits: result.balance,
      })
    } catch (error: any) {
      if (error?.statusCode === 401) {
        return reply.code(401).send({
          error: 'Invalid or expired authentication token',
        })
      }

      if (error?.message === 'INSUFFICIENT_CREDITS') {
        return reply.code(402).send({
          error: 'Insufficient message credits',
          requiredCredits: 1,
        })
      }

      if (error?.message === 'IDEMPOTENCY_CONFLICT') {
        return reply.code(409).send({
          error: 'Idempotency key already used',
        })
      }

      if (error?.code === 'P2002') {
        return reply.code(409).send({
          error: 'This message request has already been processed',
        })
      }

      if (error?.code === 'P2034') {
        return reply.code(409).send({
          error: 'A concurrent transaction occurred. Please retry.',
        })
      }

      request.log.error(error)

      return reply.code(500).send({
        error: 'Unable to send message',
      })
    }
  })

  // Create or retrieve a conversation for an existing mutual match.
  app.post('/api/messages/conversations', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)

      if (!userId) {
        return reply.code(401).send({
          error: 'Authentication required',
        })
      }

      const profile = await getActiveProfile(userId)

      if (!profile) {
        return reply.code(403).send({
          error: 'An active, verified account is required',
        })
      }

      const body = z.object({
        matchId: z.string().min(1),
      }).safeParse(request.body)

      if (!body.success) {
        return reply.code(400).send({
          error: 'A valid matchId is required',
        })
      }

      const match = await prisma.match.findFirst({
        where: {
          id: body.data.matchId,
          OR: [
            { profileAId: profile.id },
            { profileBId: profile.id },
          ],
        },
      })

      if (!match) {
        return reply.code(404).send({
          error: 'Match not found',
        })
      }

      const otherProfileId =
        match.profileAId === profile.id
          ? match.profileBId
          : match.profileAId

      const blocked = await prisma.profileBlock.findFirst({
        where: {
          OR: [
            {
              blockerProfileId: profile.id,
              blockedProfileId: otherProfileId,
            },
            {
              blockerProfileId: otherProfileId,
              blockedProfileId: profile.id,
            },
          ],
        },
      })

      if (blocked) {
        return reply.code(403).send({
          error: 'Messaging is unavailable',
        })
      }

      const conversation = await prisma.conversation.upsert({
        where: {
          matchId: match.id,
        },
        update: {},
        create: {
          matchId: match.id,
        },
      })

      return reply.send({
        success: true,
        conversation,
      })
    } catch (error: any) {
      if (error?.statusCode === 401) {
        return reply.code(401).send({
          error: 'Invalid or expired authentication token',
        })
      }

      request.log.error(error)

      return reply.code(500).send({
        error: 'Unable to create conversation',
      })
    }
  })
}


import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './database.js'

function getAuthenticatedUserId(request: any): string {
  return request.user?.sub ?? request.user?.id
}

async function getActiveUser(userId: string) {
  return prisma.user.findFirst({
    where: {
      id: userId,
      status: 'ACTIVE',
      emailVerifiedAt: { not: null },
    },
    select: { id: true },
  })
}

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
})

export async function registerNotificationRoutes(app: FastifyInstance) {
  // List notifications for the authenticated user.
  app.get('/api/notifications', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const user = await getActiveUser(userId)
      if (!user) {
        return reply.code(403).send({
          error: 'An active, verified account is required',
        })
      }

      const parsed = listSchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid pagination parameters',
        })
      }

      const { limit, cursor } = parsed.data

      const notifications = await prisma.notification.findMany({
        where: { userId },
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: limit + 1,
        ...(cursor ? {
          cursor: { id: cursor },
          skip: 1,
        } : {}),
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          entityId: true,
          readAt: true,
          createdAt: true,
          actorProfile: {
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
                  secureUrl: true,
                },
              },
            },
          },
        },
      })

      const hasMore = notifications.length > limit
      const items = hasMore ? notifications.slice(0, limit) : notifications

      return {
        notifications: items,
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      }
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({
        error: 'Failed to load notifications',
      })
    }
  })

  // Get unread notification count.
  app.get('/api/notifications/unread-count', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const user = await getActiveUser(userId)
      if (!user) {
        return reply.code(403).send({
          error: 'An active, verified account is required',
        })
      }

      const count = await prisma.notification.count({
        where: {
          userId,
          readAt: null,
        },
      })

      return { unreadCount: count }
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({
        error: 'Failed to load unread count',
      })
    }
  })

  // Mark one notification as read.
  app.patch('/api/notifications/:notificationId/read', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const user = await getActiveUser(userId)
      if (!user) {
        return reply.code(403).send({
          error: 'An active, verified account is required',
        })
      }

      const params = z.object({
        notificationId: z.string().min(1),
      }).safeParse(request.params)

      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid notification ID' })
      }

      const result = await prisma.notification.updateMany({
        where: {
          id: params.data.notificationId,
          userId,
          readAt: null,
        },
        data: {
          readAt: new Date(),
        },
      })

      if (result.count === 0) {
        const existing = await prisma.notification.findFirst({
          where: {
            id: params.data.notificationId,
            userId,
          },
          select: { id: true, readAt: true },
        })

        if (!existing) {
          return reply.code(404).send({
            error: 'Notification not found',
          })
        }

        return {
          success: true,
          alreadyRead: true,
        }
      }

      return { success: true, alreadyRead: false }
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({
        error: 'Failed to mark notification as read',
      })
    }
  })

  // Mark all notifications as read.
  app.patch('/api/notifications/read-all', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const user = await getActiveUser(userId)
      if (!user) {
        return reply.code(403).send({
          error: 'An active, verified account is required',
        })
      }

      const result = await prisma.notification.updateMany({
        where: {
          userId,
          readAt: null,
        },
        data: {
          readAt: new Date(),
        },
      })

      return {
        success: true,
        markedAsRead: result.count,
      }
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({
        error: 'Failed to mark notifications as read',
      })
    }
  })
}

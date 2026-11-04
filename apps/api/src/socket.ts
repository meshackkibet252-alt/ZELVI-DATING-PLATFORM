
import type { FastifyInstance } from 'fastify'
import { Server } from 'socket.io'
import { prisma } from './database.js'

let socketServer: Server | null = null

export function getSocketServer(): Server | null {
  return socketServer
}

export function configureSocket(app: FastifyInstance) {
  const io = new Server(app.server, {
    cors: {
      origin: ['http://localhost:5173'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  })

  socketServer = io

  // Authenticate every socket connection using the existing JWT.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token

      if (typeof token !== 'string' || !token) {
        return next(new Error('Authentication required'))
      }

      const payload = app.jwt.verify<{
        sub?: string
        id?: string
      }>(token)

      const userId = payload.sub ?? payload.id

      if (!userId) {
        return next(new Error('Invalid authentication token'))
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
        return next(new Error('Active verified account required'))
      }

      socket.data.userId = user.id
      socket.data.profileId = user.profile.id

      next()
    } catch {
      next(new Error('Invalid or expired authentication token'))
    }
  })

  io.on('connection', (socket) => {
    const profileId = socket.data.profileId as string
    const userId = socket.data.userId as string

    // Private room for notifications and account events.
    socket.join(`user:${userId}`)

    app.log.info({
      userId,
      profileId,
    }, 'Authenticated Socket.IO connection established')

    // Join a conversation only after verifying match participation
    // and checking that neither participant has blocked the other.
    socket.on('conversation:join', async (conversationId, callback) => {
      try {
        if (
          typeof conversationId !== 'string' ||
          conversationId.length < 1 ||
          conversationId.length > 128
        ) {
          if (typeof callback === 'function') {
            callback({
              success: false,
              error: 'Invalid conversation ID',
            })
          }
          return
        }

        const conversation = await prisma.conversation.findFirst({
          where: {
            id: conversationId,
            match: {
              OR: [
                { profileAId: profileId },
                { profileBId: profileId },
              ],
            },
          },
          include: {
            match: true,
          },
        })

        if (!conversation) {
          if (typeof callback === 'function') {
            callback({
              success: false,
              error: 'Conversation not found',
            })
          }
          return
        }

        const otherProfileId =
          conversation.match.profileAId === profileId
            ? conversation.match.profileBId
            : conversation.match.profileAId

        const blocked = await prisma.profileBlock.findFirst({
          where: {
            OR: [
              {
                blockerProfileId: profileId,
                blockedProfileId: otherProfileId,
              },
              {
                blockerProfileId: otherProfileId,
                blockedProfileId: profileId,
              },
            ],
          },
        })

        if (blocked) {
          if (typeof callback === 'function') {
            callback({
              success: false,
              error: 'Messaging is unavailable',
            })
          }
          return
        }

        await socket.join(`conversation:${conversation.id}`)

        if (typeof callback === 'function') {
          callback({
            success: true,
            conversationId: conversation.id,
          })
        }
      } catch (error) {
        app.log.error(error)

        if (typeof callback === 'function') {
          callback({
            success: false,
            error: 'Unable to join conversation',
          })
        }
      }
    })

    socket.on('conversation:leave', async (conversationId) => {
      if (typeof conversationId === 'string') {
        await socket.leave(`conversation:${conversationId}`)
      }
    })

    socket.on('disconnect', (reason) => {
      app.log.info({
        userId,
        reason,
      }, 'Socket.IO connection closed')
    })
  })

  app.addHook('onClose', async () => {
    await io.close()
    socketServer = null
  })

  app.log.info('Socket.IO real-time server configured')
}

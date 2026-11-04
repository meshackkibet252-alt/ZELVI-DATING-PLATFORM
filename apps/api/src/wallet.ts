import type { FastifyInstance } from 'fastify'
import { prisma } from './database.js'

function getAuthenticatedUserId(request: any): string | null {
  const user = request.user as { sub?: string } | undefined
  return user?.sub ?? null
}

export async function registerWalletRoutes(app: FastifyInstance) {
  // Get current wallet balance and credit summary.
  app.get('/api/wallet/me', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)

      if (!userId) {
        return reply.code(401).send({
          error: 'Authentication required',
        })
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          status: true,
          emailVerifiedAt: true,
        },
      })

      if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) {
        return reply.code(403).send({
          error: 'An active, verified account is required',
        })
      }

      const transactions = await prisma.creditTransaction.aggregate({
        where: { userId },
        _sum: { amount: true },
      })

      const balance = transactions._sum.amount ?? 0

      const summary = await prisma.creditTransaction.groupBy({
        by: ['type'],
        where: { userId },
        _sum: { amount: true },
      })

      return reply.send({
        success: true,
        wallet: {
          balance,
          currency: 'MESSAGE_CREDITS',
          breakdown: summary.map((item) => ({
            type: item.type,
            amount: item._sum.amount ?? 0,
          })),
        },
      })
    } catch (error: any) {
      if (error?.statusCode === 401) {
        return reply.code(401).send({
          error: 'Invalid or expired authentication token',
        })
      }

      request.log.error(error)

      return reply.code(500).send({
        error: 'Unable to retrieve wallet balance',
      })
    }
  })

  // Get wallet transaction history.
  app.get('/api/wallet/transactions', async (request, reply) => {
    try {
      await request.jwtVerify()

      const userId = getAuthenticatedUserId(request)

      if (!userId) {
        return reply.code(401).send({
          error: 'Authentication required',
        })
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          status: true,
          emailVerifiedAt: true,
        },
      })

      if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) {
        return reply.code(403).send({
          error: 'An active, verified account is required',
        })
      }

      const query = request.query as {
        limit?: string
        cursor?: string
      }

      const requestedLimit = Number(query.limit ?? 30)
      const limit = Number.isInteger(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 100)
        : 30

      const transactions = await prisma.creditTransaction.findMany({
        where: { userId },
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: limit,
        ...(query.cursor
          ? {
              skip: 1,
              cursor: { id: query.cursor },
            }
          : {}),
        select: {
          id: true,
          type: true,
          amount: true,
          description: true,
          reference: true,
          createdAt: true,
        },
      })

      return reply.send({
        success: true,
        transactions,
        nextCursor:
          transactions.length === limit
            ? transactions[transactions.length - 1]?.id ?? null
            : null,
      })
    } catch (error: any) {
      if (error?.statusCode === 401) {
        return reply.code(401).send({
          error: 'Invalid or expired authentication token',
        })
      }

      request.log.error(error)

      return reply.code(500).send({
        error: 'Unable to retrieve wallet transactions',
      })
    }
  })
}
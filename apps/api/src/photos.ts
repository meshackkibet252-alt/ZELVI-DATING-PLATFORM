import type { FastifyInstance } from 'fastify'
import { fileTypeFromBuffer } from 'file-type'
import { prisma } from './database.js'
import { getCloudinary } from './cloudinary.js'
import type { Prisma } from '../../../generated/prisma/client.js'
const MAX_PHOTOS = 6
const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
]
async function getActiveProfile(request: any) {
  await request.jwtVerify()
  const user = await prisma.user.findUnique({
    where: { id: request.user.sub },
    select: {
      id: true,
      status: true,
      emailVerifiedAt: true,
      profile: {
        select: { id: true },
      },
    },
  })
  if (
    !user ||
    user.status !== 'ACTIVE' ||
    !user.emailVerifiedAt ||
    !user.profile
  ) {
    return null
  }
  return {
    userId: user.id,
    profileId: user.profile.id,
  }
}
function isAuthenticationError(error: any): boolean {
  return (
    error?.statusCode === 401 ||
    error?.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER' ||
    error?.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' ||
    error?.code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID'
  )
}
function uploadToCloudinary(buffer: Buffer, userId: string): Promise<any> {
  const cloudinary = getCloudinary()
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `zelvi/profiles/${userId}`,
        resource_type: 'image',
        allowed_formats: ['jpg', 'png', 'webp'],
      },
      (error: unknown, result: any) => {
        if (error) return reject(error)
        if (!result) return reject(new Error('Image upload failed'))
        resolve(result)
      },
    )
    stream.end(buffer)
  })
}
export async function registerPhotoRoutes(app: FastifyInstance) {
  // UPLOAD PROFILE PHOTO
  app.post('/api/profile/photos', async (request, reply) => {
    let uploadedPublicId: string | undefined
    try {
      const account = await getActiveProfile(request)
      if (!account) {
        return reply.code(403).send({
          error: 'An active, verified account with a profile is required.',
        })
      }
      const file = await request.file({
        limits: { files: 1, fileSize: MAX_FILE_SIZE },
      })
      if (!file) {
        return reply.code(400).send({
          error: 'Please select an image to upload.',
        })
      }
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return reply.code(400).send({
          error: 'Only JPEG, PNG and WebP images are allowed.',
        })
      }
      const buffer = await file.toBuffer()
      const detectedType = await fileTypeFromBuffer(buffer)
      if (
        !detectedType ||
        !ALLOWED_MIME_TYPES.includes(detectedType.mime) ||
        detectedType.mime !== file.mimetype
      ) {
        return reply.code(400).send({
          error: 'The image content does not match its declared file type.',
        })
      }
      const result = await uploadToCloudinary(buffer, account.userId)
      uploadedPublicId = result.public_id
      const photo = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const photoCount = await tx.profilePhoto.count({
            where: { profileId: account.profileId },
          })
          if (photoCount >= MAX_PHOTOS) {
            throw new Error('PHOTO_LIMIT_REACHED')
          }
          return tx.profilePhoto.create({
            data: {
              profileId: account.profileId,
              publicId: result.public_id,
              secureUrl: result.secure_url,
              format: result.format,
              bytes: result.bytes,
              width: result.width,
              height: result.height,
              isPrimary: photoCount === 0,
              visibility: 'PUBLIC',
            },
            select: {
              id: true,
              secureUrl: true,
              format: true,
              bytes: true,
              width: true,
              height: true,
              isPrimary: true,
              visibility: true,
              createdAt: true,
            },
          })
        },
        { isolationLevel: 'Serializable' },
      )
      uploadedPublicId = undefined
      return reply.code(201).send({
        message: 'Profile photo uploaded successfully.',
        photo,
      })
    } catch (error: any) {
      if (uploadedPublicId) {
        try {
          await getCloudinary().uploader.destroy(uploadedPublicId)
        } catch {
          request.log.error('Cloudinary cleanup failed.')
        }
      }
      if (isAuthenticationError(error)) {
        return reply.code(401).send({
          error: 'Authentication required.',
        })
      }
      if (error?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({
          error: 'Image must not exceed 5 MB.',
        })
      }
      if (error?.message === 'PHOTO_LIMIT_REACHED') {
        return reply.code(400).send({
          error: 'You can upload a maximum of 6 profile photos.',
        })
      }
      if (error?.code === 'P2034') {
        return reply.code(409).send({
          error: 'Another photo upload is being processed. Please try again.',
        })
      }
      request.log.error(error)
      return reply.code(500).send({
        error: 'Unable to upload profile photo.',
      })
    }
  })
  // LIST MY PROFILE PHOTOS
  app.get('/api/profile/photos', async (request, reply) => {
    try {
      const account = await getActiveProfile(request)
      if (!account) {
        return reply.code(403).send({
          error: 'An active, verified account is required.',
        })
      }
      const profile = await prisma.profile.findUnique({
        where: { id: account.profileId },
        select: {
          photos: {
            orderBy: [
              { isPrimary: 'desc' },
              { createdAt: 'asc' },
            ],
            select: {
              id: true,
              secureUrl: true,
              format: true,
              bytes: true,
              width: true,
              height: true,
              isPrimary: true,
              visibility: true,
              createdAt: true,
            },
          },
        },
      })
      if (!profile) {
        return reply.code(404).send({
          error: 'Profile not found.',
        })
      }
      return reply.send({ photos: profile.photos })
    } catch (error: any) {
      if (isAuthenticationError(error)) {
        return reply.code(401).send({
          error: 'Authentication required.',
        })
      }
      request.log.error(error)
      return reply.code(500).send({
        error: 'Unable to retrieve profile photos.',
      })
    }
  })
  // DELETE MY PROFILE PHOTO
  app.delete('/api/profile/photos/:photoId', async (request: any, reply) => {
    try {
      const account = await getActiveProfile(request)
      if (!account) {
        return reply.code(403).send({
          error: 'An active, verified account is required.',
        })
      }
      const { photoId } = request.params as { photoId: string }
      const photo = await prisma.profilePhoto.findFirst({
        where: {
          id: photoId,
          profileId: account.profileId,
        },
      })
      if (!photo) {
        return reply.code(404).send({
          error: 'Photo not found.',
        })
      }
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.profilePhoto.delete({
          where: { id: photo.id },
        })
        if (photo.isPrimary) {
          const nextPhoto = await tx.profilePhoto.findFirst({
            where: { profileId: photo.profileId },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          })
          if (nextPhoto) {
            await tx.profilePhoto.update({
              where: { id: nextPhoto.id },
              data: { isPrimary: true },
            })
          }
        }
      })
      try {
        const result = await getCloudinary().uploader.destroy(photo.publicId)
        if (result.result !== 'ok' && result.result !== 'not found') {
          request.log.error(
            { publicId: photo.publicId, result: result.result },
            'Cloudinary photo cleanup requires attention.',
          )
        }
      } catch (cleanupError) {
        request.log.error(
          { publicId: photo.publicId, err: cleanupError },
          'Cloudinary photo cleanup failed.',
        )
      }
      return reply.send({
        message: 'Profile photo deleted successfully.',
      })
    } catch (error: any) {
      if (isAuthenticationError(error)) {
        return reply.code(401).send({
          error: 'Authentication required.',
        })
      }
      request.log.error(error)
      return reply.code(500).send({
        error: 'Unable to delete profile photo.',
      })
    }
  })  // SET PRIMARY PROFILE PHOTO
  app.patch('/api/profile/photos/:photoId/primary', async (request: any, reply) => {
    try {
      const account = await getActiveProfile(request)
      if (!account) {
        return reply.code(403).send({
          error: 'An active, verified account is required.',
        })
      }
      const { photoId } = request.params as { photoId: string }
      const photo = await prisma.profilePhoto.findFirst({
        where: {
          id: photoId,
          profileId: account.profileId,
        },
        select: {
          id: true,
          profileId: true,
        },
      })
      if (!photo) {
        return reply.code(404).send({
          error: 'Photo not found.',
        })
      }
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.profilePhoto.updateMany({
          where: { profileId: photo.profileId },
          data: { isPrimary: false },
        })
        await tx.profilePhoto.update({
          where: { id: photo.id },
          data: { isPrimary: true },
        })
      })
      return reply.send({
        message: 'Primary profile photo updated successfully.',
      })
    } catch (error: any) {
      if (isAuthenticationError(error)) {
        return reply.code(401).send({
          error: 'Authentication required.',
        })
      }
      request.log.error(error)
      return reply.code(500).send({
        error: 'Unable to update primary profile photo.',
      })
    }
  })
  // CHANGE PROFILE PHOTO VISIBILITY
  app.patch('/api/profile/photos/:photoId/visibility', async (request: any, reply) => {
    try {
      const account = await getActiveProfile(request)
      if (!account) {
        return reply.code(403).send({
          error: 'An active, verified account is required.',
        })
      }
      const { photoId } = request.params as { photoId: string }
      const body = request.body as { visibility?: string } | null
      const allowedVisibility = [
        'PUBLIC',
        'MATCHES_ONLY',
        'PRIVATE',
      ]
      if (!body || !allowedVisibility.includes(body.visibility ?? '')) {
        return reply.code(400).send({
          error: 'Visibility must be PUBLIC, MATCHES_ONLY or PRIVATE.',
        })
      }
      const photo = await prisma.profilePhoto.findFirst({
        where: {
          id: photoId,
          profileId: account.profileId,
        },
        select: { id: true },
      })
      if (!photo) {
        return reply.code(404).send({
          error: 'Photo not found.',
        })
      }
      const updatedPhoto = await prisma.profilePhoto.update({
        where: { id: photo.id },
        data: {
          visibility: body.visibility as 'PUBLIC' | 'MATCHES_ONLY' | 'PRIVATE',
        },
        select: {
          id: true,
          visibility: true,
          isPrimary: true,
        },
      })
      return reply.send({
        message: 'Photo visibility updated successfully.',
        photo: updatedPhoto,
      })
    } catch (error: any) {
      if (isAuthenticationError(error)) {
        return reply.code(401).send({
          error: 'Authentication required.',
        })
      }
      request.log.error(error)
      return reply.code(500).send({
        error: 'Unable to update photo visibility.',
      })
    }
  })
}


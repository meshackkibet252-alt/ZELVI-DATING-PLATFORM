
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { v2 as cloudinary } from 'cloudinary'

dotenv.config({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
})

const cloudName = process.env.CLOUDINARY_CLOUD_NAME
const apiKey = process.env.CLOUDINARY_API_KEY
const apiSecret = process.env.CLOUDINARY_API_SECRET

export function isCloudinaryConfigured(): boolean {
  return Boolean(cloudName && apiKey && apiSecret)
}

export function getCloudinary() {
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary credentials are not configured.')
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  })

  return cloudinary
}
export async function testCloudinaryConnection() {
  const cloudinary = getCloudinary()

  return cloudinary.api.ping()
}
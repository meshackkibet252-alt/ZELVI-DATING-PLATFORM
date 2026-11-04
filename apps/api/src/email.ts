import { Resend } from 'resend'

const apiKey = process.env.RESEND_API_KEY
const emailFrom = process.env.EMAIL_FROM

const resend = apiKey ? new Resend(apiKey) : null

export async function sendVerificationEmail(
  email: string,
  token: string,
): Promise<void> {
  if (!resend || !emailFrom) {
    throw new Error('Email service is not configured.')
  }

  const webUrl = (
    process.env.WEB_URL || 'http://localhost:5173'
  ).replace(/\/+$/, '')

  const verificationUrl =
    `${webUrl}/verify-email?token=${encodeURIComponent(token)}`

  const { error } = await resend.emails.send({
    from: emailFrom,
    to: [email],
    subject: 'Verify your ZELVI account',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:30px;color:#222">
        <h1 style="color:#16865b">Welcome to ZELVI</h1>
        <p>Thanks for joining ZELVI.</p>
        <p>Please verify your email address to activate your account.</p>
        <p style="margin:30px 0">
          <a href="${verificationUrl}"
             style="background:#16865b;color:white;padding:14px 24px;text-decoration:none;border-radius:8px">
            Verify my email
          </a>
        </p>
        <p>This link expires in 30 minutes and can only be used once.</p>
        <p>If you did not create a ZELVI account, you can ignore this email.</p>
        <p>— The ZELVI Team</p>
      </div>
    `,
    text: `Welcome to ZELVI. Verify your email using this link: ${verificationUrl}. This link expires in 30 minutes.`,
  })

  if (error) {
    throw new Error(`Unable to send verification email: ${error.message}`)
  }
}
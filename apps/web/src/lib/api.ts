const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:4000'

export const TOKEN_KEY = 'zelvi_token'

export function getAuthToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function saveAuthToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearAuthToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken()

  const headers = new Headers(options.headers)

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(
      data.error || `Request failed with status ${response.status}`,
    )
  }

  return data as T
}

export { API_BASE_URL }
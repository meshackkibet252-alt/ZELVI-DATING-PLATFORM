import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import {
  apiRequest,
  clearAuthToken,
  getAuthToken,
  saveAuthToken,
} from './api'

import {
  createSocketConnection,
} from './socket'

import type { Socket } from 'socket.io-client'

interface User {
  id: string
  email: string
  status: string
  emailVerifiedAt: string | null
  createdAt: string
}

interface Profile {
  id: string
  displayName: string
  [key: string]: unknown
}

interface LoginResponse {
  token: string
  tokenType: string
  expiresIn: string
  user: {
    id: string
    email: string
    displayName: string | null
  }
}

interface ProfileResponse {
  user: User
  profile: Profile
}

interface AuthContextType {
  user: User | null
  profile: Profile | null
  socket: Socket | null
  loading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [loading, setLoading] = useState(true)

  const connectSocket = useCallback((token: string) => {
    setSocket(previous => {
      previous?.disconnect()

      const connection = createSocketConnection(token)
      connection.connect()

      return connection
    })
  }, [])

  const logout = useCallback(() => {
    clearAuthToken()

    setUser(null)
    setProfile(null)

    setSocket(previous => {
      previous?.disconnect()
      return null
    })
  }, [])

  const refreshProfile = useCallback(async () => {
    const response = await apiRequest<ProfileResponse>(
      '/api/profile/me',
    )

    setUser(response.user)
    setProfile(response.profile)
  }, [])

  const login = useCallback(async (
    email: string,
    password: string,
  ) => {
    const response = await apiRequest<LoginResponse>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
    )

    saveAuthToken(response.token)

    try {
      const profileResponse = await apiRequest<ProfileResponse>(
        '/api/profile/me',
      )

      setUser(profileResponse.user)
      setProfile(profileResponse.profile)

      connectSocket(response.token)
    } catch (error) {
      clearAuthToken()
      throw error
    }
  }, [connectSocket])

  useEffect(() => {
    let cancelled = false

    async function restoreSession() {
      const token = getAuthToken()

      if (!token) {
        setLoading(false)
        return
      }

      try {
        const response = await apiRequest<ProfileResponse>(
          '/api/profile/me',
        )

        if (cancelled) return

        setUser(response.user)
        setProfile(response.profile)
        connectSocket(token)
      } catch {
        if (!cancelled) {
          clearAuthToken()
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    restoreSession()

    return () => {
      cancelled = true
    }
  }, [connectSocket])

  useEffect(() => {
    return () => {
      socket?.disconnect()
    }
  }, [socket])

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        socket,
        loading,
        isAuthenticated: Boolean(user),
        login,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error(
      'useAuth must be used inside an AuthProvider.',
    )
  }

  return context
}
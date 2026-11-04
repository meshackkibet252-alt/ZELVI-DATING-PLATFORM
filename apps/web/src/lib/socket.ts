import { io, type Socket } from 'socket.io-client'
import { API_BASE_URL } from './api'

export interface ZelviMessage {
  id: string
  conversationId: string
  senderProfileId: string
  content: string
  createdAt: string
}

export interface ZelviNotification {
  id: string
  type: string
  title: string
  body: string
  createdAt: string
  readAt: string | null
}

export function createSocketConnection(token: string): Socket {
  return io(API_BASE_URL, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    auth: {
      token,
    },
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  })
}
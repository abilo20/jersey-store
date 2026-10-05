import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken } from './utils/jwt.js';

interface ClientConnection {
  ws: WebSocket;
  role: 'admin' | 'customer' | 'guest';
  userId?: number;
  sessionId?: string;
  isAlive: boolean;
}

let wss: WebSocketServer | null = null;
const clients = new Set<ClientConnection>();

export function initWebSocketServer(server: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    const client: ClientConnection = {
      ws,
      role: 'guest',
      isAlive: true
    };
    clients.add(client);

    // Heartbeat ping/pong
    ws.on('pong', () => {
      client.isAlive = true;
    });

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'auth') {
          if (data.token) {
            const payload = verifyToken(data.token);
            if (payload) {
              client.role = payload.type;
              client.userId = payload.id;
            }
          }
          if (data.sessionId) {
            client.sessionId = data.sessionId;
          }
          ws.send(JSON.stringify({ type: 'authenticated', role: client.role }));
        }
      } catch (err) {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      clients.delete(client);
    });

    ws.on('error', () => {
      clients.delete(client);
    });

    // Send connection greeting
    ws.send(JSON.stringify({ type: 'connected', message: 'Connected to Mira Sport Realtime Server' }));
  });

  // Heartbeat interval to clean dead connections
  const interval = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        client.ws.terminate();
        clients.delete(client);
      } else {
        client.isAlive = false;
        client.ws.ping();
      }
    }
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  return wss;
}

export interface RealtimeNotification {
  type: 'order:new' | 'payment:submitted' | 'payment:verified' | 'payment:rejected' | 'order:updated' | 'review:new' | 'settings:updated' | 'notification:new' | 'admin:notification' | string;
  title: string;
  message: string;
  timestamp?: string;
  data?: any;
  target?: 'all' | 'admins' | 'customers' | number; // number means specific userId
}

export function broadcastNotification(notif: RealtimeNotification): void {
  if (!wss) return;

  const payload = JSON.stringify({
    ...notif,
    timestamp: notif.timestamp || new Date().toISOString()
  });

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      if (notif.target === 'all' || !notif.target) {
        client.ws.send(payload);
      } else if (notif.target === 'admins' && client.role === 'admin') {
        client.ws.send(payload);
      } else if (notif.target === 'customers' && client.role === 'customer') {
        client.ws.send(payload);
      } else if (typeof notif.target === 'number' && client.userId === notif.target) {
        client.ws.send(payload);
      }
    }
  }
}

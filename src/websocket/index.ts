import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { verifyAccessToken } from "../utils/jwt.js";
import { logger } from "../config/logger.js";
import { config } from "../config/index.js";

let io: Server | null = null;

export function initWebSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    path: "/ws",
    cors: {
      origin: config.corsOrigins,
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (!token) {
        return next(new Error("Authentication required"));
      }
      const payload = verifyAccessToken(token as string);
      (socket as any).userId = payload.userId;
      (socket as any).userEmail = payload.email;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const userId = (socket as any).userId;
    logger.info({ userId }, "WebSocket client connected");

    // Join personal room for notifications
    socket.join(`user:${userId}`);

    // Join chama rooms
    socket.on("join:chama", (chamaId: string) => {
      socket.join(`chama:${chamaId}`);
      logger.info({ userId, chamaId }, "Joined chama room");
    });

    socket.on("leave:chama", (chamaId: string) => {
      socket.leave(`chama:${chamaId}`);
    });

    // Chat events
    socket.on("chat:send", (data: { chamaId: string; content: string }) => {
      io?.to(`chama:${data.chamaId}`).emit("chat:message", {
        chamaId: data.chamaId,
        message: {
          userId,
          content: data.content,
          createdAt: new Date().toISOString(),
        },
      });
    });

    socket.on("typing:start", (chamaId: string) => {
      socket.to(`chama:${chamaId}`).emit("chat:typing", { chamaId, userId });
    });

    socket.on("typing:stop", (chamaId: string) => {
      socket.to(`chama:${chamaId}`).emit("chat:typing", { chamaId, userId, stopped: true });
    });

    socket.on("disconnect", () => {
      logger.info({ userId }, "WebSocket client disconnected");
    });
  });

  logger.info("WebSocket server initialized");
  return io;
}

export function getIO(): Server {
  if (!io) throw new Error("WebSocket server not initialized");
  return io;
}

// Helper functions for services to emit events
export function emitToUser(userId: string, event: string, data: unknown) {
  io?.to(`user:${userId}`).emit(event, data);
}

export function emitToChama(chamaId: string, event: string, data: unknown) {
  io?.to(`chama:${chamaId}`).emit(event, data);
}

export function emitNotification(notification: unknown) {
  const n = notification as any;
  io?.to(`user:${n.userId}`).emit("notification:new", { notification });
}

export function emitTransaction(userId: string, transaction: unknown, wallet: unknown) {
  io?.to(`user:${userId}`).emit("transaction:update", { transaction, wallet });
}

export function emitMpdate(meetingId: string, chamaId: string, attendeesCount: number, rsvps: unknown) {
  io?.to(`chama:${chamaId}`).emit("meeting:rsvp_update", { meetingId, attendeesCount, rsvps });
}

export function emitVoteUpdate(voteId: string, chamaId: string, options: unknown, totalVotes: number) {
  io?.to(`chama:${chamaId}`).emit("vote:update", { voteId, options, totalVotes });
}

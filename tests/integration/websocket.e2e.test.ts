import http from "http";
import type { AddressInfo } from "net";
import { io as clientIo, type Socket as ClientSocket } from "socket.io-client";
import jwt from "jsonwebtoken";

import { initWebSocket, emitToUser, emitToChama } from "../../src/websocket/index.js";
import { config } from "../../src/config/index.js";

jest.mock("../../src/config/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const USER_A = { userId: "user-a", email: "a@test.dev" };
const USER_B = { userId: "user-b", email: "b@test.dev" };
const CHAMA_ID = "chama-42";

function signAccessToken(payload: { userId: string; email: string }): string {
  return jwt.sign({ ...payload, type: "access" }, config.jwt.secret, { expiresIn: "5m" });
}

function connectClient(port: number, token: string | null): ClientSocket {
  return clientIo(`http://localhost:${port}`, {
    path: "/ws",
    transports: ["websocket"],
    auth: token ? { token } : {},
    reconnection: false,
    forceNew: true,
    timeout: 4000,
  });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (err) => reject(err));
  });
}

function waitForEvent<T = unknown>(socket: ClientSocket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe("WebSocket e2e", () => {
  let httpServer: http.Server;
  let port: number;

  beforeAll(async () => {
    httpServer = http.createServer();
    initWebSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("rejects connection with no token", async () => {
    const socket = connectClient(port, null);
    try {
      await expect(waitForConnect(socket)).rejects.toThrow(/Authentication required/);
    } finally {
      socket.disconnect();
    }
  });

  it("rejects connection with invalid token", async () => {
    const socket = connectClient(port, "not.a.jwt");
    try {
      await expect(waitForConnect(socket)).rejects.toThrow(/Invalid token/);
    } finally {
      socket.disconnect();
    }
  });

  it("accepts connection with valid token at path /ws", async () => {
    const token = signAccessToken(USER_A);
    const socket = connectClient(port, token);
    try {
      await waitForConnect(socket);
      expect(socket.connected).toBe(true);
    } finally {
      socket.disconnect();
    }
  });

  it("emitToUser delivers notification:new to the user's personal room", async () => {
    const token = signAccessToken(USER_A);
    const socket = connectClient(port, token);
    try {
      await waitForConnect(socket);
      const received = waitForEvent<{ notification: { title: string } }>(socket, "notification:new");
      await new Promise((r) => setTimeout(r, 50));
      emitToUser(USER_A.userId, "notification:new", { notification: { title: "hello" } });
      const payload = await received;
      expect(payload.notification.title).toBe("hello");
    } finally {
      socket.disconnect();
    }
  });

  it("join:chama routes chama-scoped broadcasts to that client", async () => {
    const token = signAccessToken(USER_A);
    const socket = connectClient(port, token);
    try {
      await waitForConnect(socket);
      socket.emit("join:chama", CHAMA_ID);
      await new Promise((r) => setTimeout(r, 80));

      const received = waitForEvent<{ voteId: string }>(socket, "vote:update");
      emitToChama(CHAMA_ID, "vote:update", { voteId: "v1", totalVotes: 3 });
      const payload = await received;
      expect(payload.voteId).toBe("v1");
    } finally {
      socket.disconnect();
    }
  });

  it("chat:send broadcasts chat:message to peers in the same chama", async () => {
    const tokenA = signAccessToken(USER_A);
    const tokenB = signAccessToken(USER_B);
    const socketA = connectClient(port, tokenA);
    const socketB = connectClient(port, tokenB);
    try {
      await Promise.all([waitForConnect(socketA), waitForConnect(socketB)]);
      socketA.emit("join:chama", CHAMA_ID);
      socketB.emit("join:chama", CHAMA_ID);
      await new Promise((r) => setTimeout(r, 80));

      const receivedOnB = waitForEvent<{
        chamaId: string;
        message: { userId: string; content: string };
      }>(socketB, "chat:message");

      socketA.emit("chat:send", { chamaId: CHAMA_ID, content: "hi team" });

      const payload = await receivedOnB;
      expect(payload.chamaId).toBe(CHAMA_ID);
      expect(payload.message.userId).toBe(USER_A.userId);
      expect(payload.message.content).toBe("hi team");
    } finally {
      socketA.disconnect();
      socketB.disconnect();
    }
  });

  it("leave:chama stops delivery of chama broadcasts", async () => {
    const token = signAccessToken(USER_A);
    const socket = connectClient(port, token);
    try {
      await waitForConnect(socket);
      socket.emit("join:chama", CHAMA_ID);
      await new Promise((r) => setTimeout(r, 60));
      socket.emit("leave:chama", CHAMA_ID);
      await new Promise((r) => setTimeout(r, 60));

      let received = false;
      socket.once("vote:update", () => {
        received = true;
      });
      emitToChama(CHAMA_ID, "vote:update", { voteId: "v-late" });
      await new Promise((r) => setTimeout(r, 200));
      expect(received).toBe(false);
    } finally {
      socket.disconnect();
    }
  });
});

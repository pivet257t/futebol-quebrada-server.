
import express from "express";
import http from "http";
import cors from "cors";
import { Server, Room, Client, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";

type PlayerData = {
  x: number;
  y: number;
  rotation: number;
};

type BallState = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  rz: number;
};

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

const PORT = Number(process.env.PORT || 2567);
const ROOM_NAME = "match";
const MAX_PLAYERS = 2;

const roomCodes = new Map<string, string>();
const roomCodeById = new Map<string, string>();

function makeCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  do {
    code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (roomCodes.has(code));

  return code;
}

class MatchRoom extends Room {
  maxClients = MAX_PLAYERS;
  private players = new Map<string, PlayerData>();

  onCreate() {
    this.setPatchRate(50);

    this.onMessage("move", (client: Client, data: any) => {
      if (!this.players.has(client.sessionId) || !data) return;

      const old = this.players.get(client.sessionId)!;
      const x = Number(data.x);
      const y = Number(data.y);
      const rotation = Number(data.rotation);

      this.players.set(client.sessionId, {
        x: Number.isFinite(x)
          ? Math.max(-17, Math.min(17, x))
          : old.x,
        y: Number.isFinite(y)
          ? Math.max(-29, Math.min(29, y))
          : old.y,
        rotation: Number.isFinite(rotation)
          ? rotation
          : old.rotation,
      });

      this.broadcastPlayers();
    });

    this.onMessage("kick", (client: Client, data: any) => {
      if (!data || !this.clients.includes(client)) return;

      const vx = Number(data.vx ?? data.dx);
      const vy = Number(data.vy ?? data.dy);
      const vz = Number(data.vz ?? data.dz);
      const power = Number(data.power ?? 0.5);

      if (![vx, vy, vz, power].every(Number.isFinite)) return;

      this.broadcast("kick", {
        vx,
        vy,
        vz,
        dx: vx,
        dy: vy,
        dz: vz,
        power: Math.max(0, Math.min(1, power)),
      });
    });

    this.onMessage("ball-state", (client: Client, data: any) => {
      if (!data || !this.clients.includes(client)) return;

      // O primeiro jogador conectado controla a simulação da bola.
      if (this.clients[0]?.sessionId !== client.sessionId) return;

      const keys: (keyof BallState)[] = [
        "x", "y", "z", "vx", "vy", "vz", "rx", "rz",
      ];

      const state: Partial<BallState> = {};

      for (const key of keys) {
        const value = Number(data[key]);
        if (!Number.isFinite(value)) return;
        state[key] = value;
      }

      this.broadcast("ball-state", state);
    });
  }

  onJoin(client: Client) {
    this.players.set(client.sessionId, {
      x: 0,
      y: 0,
      rotation: 0,
    });

    this.broadcastPlayers();
  }

  onLeave(client: Client) {
    this.players.delete(client.sessionId);
    this.broadcastPlayers();

    if (this.clients.length <= 1) {
      const code = roomCodeById.get(this.roomId);

      if (code) {
        roomCodes.delete(code);
        roomCodeById.delete(this.roomId);
      }
    }
  }

  onDispose() {
    const code = roomCodeById.get(this.roomId);

    if (code) {
      roomCodes.delete(code);
      roomCodeById.delete(this.roomId);
    }
  }

  private broadcastPlayers() {
    // Mantém a ordem de conexão para o HTML identificar o host.
    const snapshot: Record<string, PlayerData> = {};

    for (const client of this.clients) {
      const player = this.players.get(client.sessionId);
      if (player) snapshot[client.sessionId] = player;
    }

    this.broadcast("players", snapshot);
  }
}

gameServer.define(ROOM_NAME, MatchRoom);

app.post("/api/rooms/create", async (_req, res) => {
  try {
    const room = await matchMaker.createRoom(ROOM_NAME, {});
    const roomId = (room as any).roomId;

    if (!roomId) {
      throw new Error("O servidor não retornou o ID da sala.");
    }

    const code = makeCode();

    roomCodes.set(code, roomId);
    roomCodeById.set(roomId, code);

    res.json({
      roomId,
      code,
      status: "waiting",
    });
  } catch (error) {
    console.error("Erro ao criar sala:", error);
    res.status(500).json({
      message: "Não foi possível criar a sala.",
    });
  }
});

app.post("/api/rooms/join", async (req, res) => {
  const code = String(req.body?.code || "")
    .trim()
    .toUpperCase();

  const roomId = roomCodes.get(code);

  if (!code || !roomId) {
    res.status(404).json({
      message: "Código de sala inválido ou expirado.",
    });
    return;
  }

  try {
    const rooms = await matchMaker.query({ roomId });

    if (!rooms.length) {
      roomCodes.delete(code);
      roomCodeById.delete(roomId);

      res.status(404).json({
        message: "Essa sala não está mais disponível.",
      });
      return;
    }

    if (Number(rooms[0].clients ?? 0) >= MAX_PLAYERS) {
      res.status(409).json({
        message: "A sala já está cheia.",
      });
      return;
    }

    res.json({
      roomId,
      code,
      status: "joining",
    });
  } catch (error) {
    console.error("Erro ao consultar sala:", error);
    res.status(500).json({
      message: "Não foi possível entrar na sala.",
    });
  }
});

app.get("/", (_req, res) => {
  res.status(200).send(
    "Futebol de Quebrada — servidor online"
  );
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: roomCodes.size });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, rooms: roomCodes.size });
});

gameServer.listen(PORT).then(() => {
  console.log(
    `Servidor Futebol de Quebrada iniciado na porta ${PORT}`
  );
}).catch((error) => {
  console.error("Falha ao iniciar o servidor:", error);
  process.exit(1);
});


import { Server, Room, Client, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import http from "http";

type PlayerData = {
  x: number;
  y: number;
  rotation: number;
};

type KickData = {
  dx: number;
  dy: number;
  dz: number;
  power: number;
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
app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.get("/", (_req, res) => {
  res.status(200).send("Futebol de Quebrada — servidor online.");
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    game: "Futebol de Quebrada"
  });
});

class MatchRoom extends Room {
  maxClients = 2;

  players: Record<string, PlayerData> = {};
  hostSessionId: string | null = null;
  lastBallState: BallState | null = null;

  onCreate() {
    this.setMetadata({
      game: "Futebol de Quebrada",
      createdAt: Date.now()
    });

    this.onMessage(
      "move",
      (client: Client, data: Partial<PlayerData>) => {
        const player = this.players[client.sessionId];

        if (!player || !data || typeof data !== "object") return;

        if (typeof data.x === "number" && Number.isFinite(data.x)) {
          player.x = Math.max(-1000, Math.min(1000, data.x));
        }

        if (typeof data.y === "number" && Number.isFinite(data.y)) {
          player.y = Math.max(-1000, Math.min(1000, data.y));
        }

        if (
          typeof data.rotation === "number" &&
          Number.isFinite(data.rotation)
        ) {
          player.rotation = data.rotation;
        }

        this.broadcast("players", this.players);
      }
    );

    this.onMessage(
      "kick",
      (client: Client, data: Partial<KickData>) => {
        if (!this.players[client.sessionId]) return;
        if (!data || typeof data !== "object") return;

        const dx = Number(data.dx);
        const dy = Number(data.dy);
        const dz = Number(data.dz);
        const power = Number(data.power);

        const kick: KickData = {
          dx: Number.isFinite(dx)
            ? Math.max(-1, Math.min(1, dx))
            : 0,
          dy: Number.isFinite(dy)
            ? Math.max(-1, Math.min(1, dy))
            : 0,
          dz: Number.isFinite(dz)
            ? Math.max(-1, Math.min(1, dz))
            : -1,
          power: Number.isFinite(power)
            ? Math.max(0.22, Math.min(1, power))
            : 0.5
        };

        // Encaminha o chute do jogador 2 ao anfitrião,
        // que é responsável por simular a física da bola.
        if (client.sessionId !== this.hostSessionId) {
          const host = this.clients.find(
            (c) => c.sessionId === this.hostSessionId
          );

          if (host) {
            host.send("kick", kick);
          }
        }

        // Mantém o evento disponível para o outro jogador,
        // sem enviá-lo de volta a quem chutou.
        this.broadcast("kick", kick, { except: client });
      }
    );

    this.onMessage(
      "ball-state",
      (client: Client, data: Partial<BallState>) => {
        // Só o anfitrião pode publicar o estado da bola.
        if (client.sessionId !== this.hostSessionId) return;
        if (!data || typeof data !== "object") return;

        const keys: (keyof BallState)[] = [
          "x", "y", "z", "vx", "vy", "vz", "rx", "rz"
        ];

        const ball = {} as BallState;

        for (const key of keys) {
          const value = data[key];

          if (typeof value !== "number" || !Number.isFinite(value)) {
            return;
          }

          ball[key] = Math.max(-10000, Math.min(10000, value));
        }

        this.lastBallState = ball;

        this.broadcast("ball-state", ball, { except: client });
      }
    );
  }

  onJoin(client: Client) {
    if (!this.hostSessionId) {
      this.hostSessionId = client.sessionId;
    }

    this.players[client.sessionId] = {
      x: 0,
      y: 0,
      rotation: 0
    };

    client.send("players", this.players);
    this.broadcast("players", this.players);

    if (this.lastBallState) {
      client.send("ball-state", this.lastBallState);
    }

    console.log(
      "Jogador entrou:",
      client.sessionId,
      "Anfitrião:",
      this.hostSessionId
    );
  }

  onLeave(client: Client) {
    delete this.players[client.sessionId];

    if (this.hostSessionId === client.sessionId) {
      this.hostSessionId = Object.keys(this.players)[0] || null;
    }

    this.broadcast("players", this.players);

    console.log("Jogador saiu:", client.sessionId);
  }
}

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer
  })
});

gameServer.define("match", MatchRoom);

const roomCodes = new Map<string, string>();

function createCode(): string {
  for (let i = 0; i < 100; i++) {
    const code = String(
      Math.floor(100000 + Math.random() * 900000)
    );

    if (!roomCodes.has(code)) {
      return code;
    }
  }

  throw new Error("Não foi possível gerar um código de sala.");
}

app.post("/api/rooms/create", async (_req, res) => {
  let code: string | undefined;

  try {
    code = createCode();

    const room = await matchMaker.createRoom("match", { code });

    roomCodes.set(code, room.roomId);

    res.status(201).json({
      status: "ok",
      code,
      roomId: room.roomId,
      message: "Sala criada"
    });
  } catch (error) {
    if (code) roomCodes.delete(code);

    console.error("Erro ao criar sala:", error);

    if (!res.headersSent) {
      res.status(500).json({
        status: "error",
        message: "Não foi possível criar a sala. Tente novamente."
      });
    }
  }
});

app.post("/api/rooms/join", (req, res) => {
  const code = String(req.body?.code || "").trim();

  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({
      status: "error",
      message: "Digite o código de 6 números."
    });
    return;
  }

  const roomId = roomCodes.get(code);

  if (!roomId) {
    res.status(404).json({
      status: "error",
      message: "Sala não encontrada. Confira o código ou crie outra sala."
    });
    return;
  }

  res.json({
    status: "ok",
    code,
    roomId
  });
});

app.use((
  err: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) => {
  console.error("Erro HTTP:", err);

  if (!res.headersSent) {
    res.status(400).json({
      status: "error",
      message: "Não foi possível processar a solicitação."
    });
  }
});

const port = Number(process.env.PORT || 2567);

gameServer.listen(port)
  .then(() => {
    console.log("Servidor iniciado na porta", port);
  })
  .catch((error: unknown) => {
    console.error("Falha ao iniciar o servidor:", error);
    process.exitCode = 1;
  });


import { Server, Room, Client, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import http from "http";

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

type KickData = {
  dx: number;
  dy: number;
  dz: number;
  power: number;
};

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/", (_req, res) => {
  res.status(200).send("Futebol de Quebrada — servidor online.");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", game: "Futebol de Quebrada" });
});

const FIELD_W = 36;
const FIELD_L = 60;
const HALF_W = FIELD_W / 2;
const HALF_L = FIELD_L / 2;
const GOAL_Z = -HALF_L;
const START_Z = HALF_L - 8;
const BALL_RADIUS = 0.25;
const GOAL_WIDTH = 8.3;
const GOAL_HEIGHT = 3.05;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

class MatchRoom extends Room {
  maxClients = 2;

  players: Record<string, PlayerData> = {};
  ball: BallState = this.initialBall();
  score = 0;
  lastGoalAt = 0;
  lastKickAt: Record<string, number> = {};
  lastTouch: string | null = null;
  elapsed = 0;

  initialBall(): BallState {
    return {
      x: 0,
      y: BALL_RADIUS,
      z: START_Z - 1.2,
      vx: 0,
      vy: 0,
      vz: 0,
      rx: 0,
      rz: 0
    };
  }

  onCreate() {
    this.setMetadata({
      game: "Futebol de Quebrada",
      createdAt: Date.now()
    });

    this.setSimulationInterval((dt) => this.simulate(dt), 1000 / 60);

    this.onMessage("move", (client: Client, data: Partial<PlayerData>) => {
      const p = this.players[client.sessionId];
      if (!p || !data || typeof data !== "object") return;

      if (finite(data.x)) p.x = clamp(data.x, -HALF_W + 0.5, HALF_W - 0.5);
      if (finite(data.y)) p.y = clamp(data.y, GOAL_Z + 0.5, HALF_L - 0.5);
      if (finite(data.rotation)) p.rotation = data.rotation;

      this.broadcast("players", this.players);
    });

    this.onMessage("kick", (client: Client, data: Partial<KickData>) => {
      if (!this.players[client.sessionId] || !data) return;

      const now = Date.now();
      if (now - (this.lastKickAt[client.sessionId] || 0) < 120) return;

      const p = this.players[client.sessionId];
      const distance = Math.hypot(p.x - this.ball.x, p.y - this.ball.z);

      // O servidor só aceita o chute se o jogador estiver perto.
      if (distance > 2.25 || now - this.lastGoalAt < 1200) return;

      const dx = Number(data.dx);
      const dy = Number(data.dy);
      const dz = Number(data.dz);
      const power = Number(data.power);

      if (![dx, dy, dz, power].every(Number.isFinite)) return;

      const kick: KickData = {
        dx: clamp(dx, -1, 1),
        dy: clamp(dy, -1, 1),
        dz: clamp(dz, -1, 1),
        power: clamp(power, 0.22, 1)
      };

      const length = Math.hypot(kick.dx, kick.dy, kick.dz);
      if (length < 0.01) return;

      kick.dx /= length;
      kick.dy /= length;
      kick.dz /= length;

      const speed = 11 + kick.power * 19;

      // A física acontece aqui, no servidor.
      this.ball.vx = kick.dx * speed;
      this.ball.vy = Math.max(1, kick.dy * speed + 2);
      this.ball.vz = kick.dz * speed;

      this.lastTouch = client.sessionId;
      this.lastKickAt[client.sessionId] = now;

      this.broadcast("kick", {
        playerId: client.sessionId,
        power: kick.power
      });
    });

    this.onMessage("reset", (_client: Client) => {
      this.score = 0;
      this.ball = this.initialBall();
      this.lastTouch = null;
      this.lastGoalAt = Date.now();
      this.broadcastSnapshot();
    });
  }

  simulate(deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.05);
    this.elapsed += dt;

    const b = this.ball;
    b.vy -= 9.8 * dt;

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;

    if (b.y < BALL_RADIUS) {
      b.y = BALL_RADIUS;

      if (Math.abs(b.vy) > 0.85) {
        b.vy = Math.abs(b.vy) * 0.30;
      } else {
        b.vy = 0;
      }

      b.vx *= Math.pow(0.992, dt * 60);
      b.vz *= Math.pow(0.992, dt * 60);
    }

    // Laterais do campo.
    const sideLimit = HALF_W - BALL_RADIUS;
    const endLimit = HALF_L - BALL_RADIUS;

    if (b.x > sideLimit) {
      b.x = sideLimit;
      b.vx = -Math.abs(b.vx) * 0.68;
    } else if (b.x < -sideLimit) {
      b.x = -sideLimit;
      b.vx = Math.abs(b.vx) * 0.68;
    }

    // Linha final oposta ao gol.
    if (b.z > endLimit) {
      b.z = endLimit;
      b.vz = -Math.abs(b.vz) * 0.58;
    }

    // Gol no lado do goleiro.
    if (b.z <= GOAL_Z - 0.15) {
      const scored =
        Math.abs(b.x) < GOAL_WIDTH / 2 &&
        b.y > 0.08 &&
        b.y < GOAL_HEIGHT;

      if (scored && Date.now() - this.lastGoalAt > 1200) {
        this.score++;
        this.lastGoalAt = Date.now();
        this.broadcast("goal", {
          score: this.score,
          scorerId: this.lastTouch
        });
        this.ball = this.initialBall();
      } else {
        b.z = GOAL_Z;
        b.vz = Math.abs(b.vz) * 0.58;
      }
    }

    b.vx *= Math.pow(0.997, dt * 60);
    b.vz *= Math.pow(0.997, dt * 60);
    b.rx += b.vz * dt * 1.7;
    b.rz -= b.vx * dt * 1.7;

    this.broadcastSnapshot();
  }

  broadcastSnapshot() {
    this.broadcast("ball-state", this.ball);
    this.broadcast("score", { score: this.score });
  }

  onJoin(client: Client) {
    this.players[client.sessionId] = {
      x: 0,
      y: 0,
      rotation: 0
    };

    client.send("players", this.players);
    this.broadcast("players", this.players);
    client.send("ball-state", this.ball);
    client.send("score", { score: this.score });

    console.log("Jogador entrou:", client.sessionId);
  }

  onLeave(client: Client) {
    delete this.players[client.sessionId];
    delete this.lastKickAt[client.sessionId];

    if (this.lastTouch === client.sessionId) {
      this.lastTouch = null;
    }

    this.broadcast("players", this.players);
    console.log("Jogador saiu:", client.sessionId);
  }
}

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

gameServer.define("match", MatchRoom);

const roomCodes = new Map<string, string>();

function createCode(): string {
  for (let i = 0; i < 100; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!roomCodes.has(code)) return code;
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

  res.json({ status: "ok", code, roomId });
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
  .then(() => console.log("Servidor iniciado na porta", port))
  .catch((error: unknown) => {
    console.error("Falha ao iniciar o servidor:", error);
    process.exitCode = 1;
  });

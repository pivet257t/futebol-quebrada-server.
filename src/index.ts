
import { Server, Room, Client, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import http from "http";

type PlayerData = {
  x: number;
  y: number;
  rotation: number;
  vx: number;
  vz: number;
  lastMoveAt: number;
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
  score: number;
  goalsA: number;
  goalsB: number;
  lastGoal: string;
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
  res.json({
    status: "ok",
    game: "Futebol de Quebrada",
    authority: "server",
    multiplayer: true
  });
});

const FIELD_HALF_WIDTH = 18;
const FIELD_HALF_LENGTH = 30;
const GOAL_HALF_WIDTH = 4.25;
const GOAL_HEIGHT = 3.2;

const BALL_RADIUS = 0.25;

// Raio horizontal aproximado do corpo do jogador.
// Deve ser compatível com a cápsula usada no HTML.
const PLAYER_COLLISION_RADIUS = 0.42;
const PLAYER_COLLISION_HEIGHT = 1.5;

const GRAVITY = 18;
const BOUNCE = 0.58;
const ROLLING_FRICTION = 0.982;
const AIR_DRAG = 0.998;
const MAX_SPEED = 35;
const BALL_UPDATE_MS = 50;
const GOAL_RESET_SECONDS = 1.5;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function createInitialBall(): BallState {
  return {
    x: 0,
    y: BALL_RADIUS,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    rx: 0,
    rz: 0,
    score: 0,
    goalsA: 0,
    goalsB: 0,
    lastGoal: ""
  };
}

class MatchRoom extends Room {
  maxClients = 2;

  players: Record<string, PlayerData> = {};
  ball: BallState = createInitialBall();

  private goalResetTimer = 0;
  private lastKickAt: Record<string, number> = {};

  onCreate() {
    this.setMetadata({
      game: "Futebol de Quebrada",
      createdAt: Date.now()
    });

    this.onMessage(
      "move",
      (client: Client, data: Partial<PlayerData>) => {
        const player = this.players[client.sessionId];

        if (!player || !data || typeof data !== "object") {
          return;
        }

        const now = Date.now();
        const elapsed = clamp(
          (now - player.lastMoveAt) / 1000,
          0.016,
          0.15
        );

        const oldX = player.x;
        const oldZ = player.y;

        const requestedX =
          typeof data.x === "number" && Number.isFinite(data.x)
            ? clamp(data.x, -1000, 1000)
            : player.x;

        const requestedZ =
          typeof data.y === "number" && Number.isFinite(data.y)
            ? clamp(data.y, -1000, 1000)
            : player.y;

        const moveVX = clamp(
          (requestedX - oldX) / elapsed,
          -10,
          10
        );

        const moveVZ = clamp(
          (requestedZ - oldZ) / elapsed,
          -10,
          10
        );

        let nextX = requestedX;
        let nextZ = requestedZ;

        // Impede o jogador de atravessar a bola quando
        // ela está ao alcance do corpo.
        if (this.ball.y <= PLAYER_COLLISION_HEIGHT) {
          const minDistance =
            PLAYER_COLLISION_RADIUS + BALL_RADIUS;

          let dx = nextX - this.ball.x;
          let dz = nextZ - this.ball.z;
          let distance = Math.sqrt(dx * dx + dz * dz);

          if (distance < minDistance) {
            if (distance < 0.0001) {
              const angle = player.rotation || 0;
              dx = Math.sin(angle);
              dz = Math.cos(angle);
              distance = 1;
            }

            const nx = dx / distance;
            const nz = dz / distance;

            // Mantém o corpo fora da esfera.
            nextX = this.ball.x + nx * minDistance;
            nextZ = this.ball.z + nz * minDistance;

            // Só transmite impulso quando o jogador
            // realmente está se deslocando contra a bola.
            const approachSpeed =
              moveVX * -nx + moveVZ * -nz;

            if (approachSpeed > 0) {
              const impulse = Math.min(approachSpeed * 0.9, 6);

              this.ball.vx += -nx * impulse;
              this.ball.vz += -nz * impulse;

              this.ball.vx = clamp(
                this.ball.vx,
                -MAX_SPEED,
                MAX_SPEED
              );

              this.ball.vz = clamp(
                this.ball.vz,
                -MAX_SPEED,
                MAX_SPEED
              );
            }
          }
        }

        player.x = nextX;
        player.y = nextZ;

        player.vx = clamp(
          (player.x - oldX) / elapsed,
          -10,
          10
        );

        player.vz = clamp(
          (player.y - oldZ) / elapsed,
          -10,
          10
        );

        if (
          typeof data.rotation === "number" &&
          Number.isFinite(data.rotation)
        ) {
          player.rotation = data.rotation;
        }

        player.lastMoveAt = now;

        this.broadcast("players", this.players);
      }
    );

    this.onMessage(
      "kick",
      (client: Client, data: Partial<KickData>) => {
        const player = this.players[client.sessionId];

        if (!player || !data || typeof data !== "object") return;
        if (this.goalResetTimer > 0) return;

        const now = Date.now();
        const last = this.lastKickAt[client.sessionId] || 0;

        if (now - last < 180) return;
        this.lastKickAt[client.sessionId] = now;

        const dx = finite(data.dx);
        const dy = finite(data.dy);
        const dz = finite(data.dz, -1);
        const power = clamp(finite(data.power, 0.5), 0.22, 1);

        const distance = Math.hypot(
          player.x - this.ball.x,
          player.y - this.ball.z
        );

        // O chute só acontece quando a bola está perto.
        if (distance > 1.35) return;

        // Não permite chutar através do corpo da bola
        // quando ela está muito acima do jogador.
        if (this.ball.y > PLAYER_COLLISION_HEIGHT + BALL_RADIUS) {
          return;
        }

        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (length < 0.001) return;

        const nx = dx / length;
        const ny = dy / length;
        const nz = dz / length;

        const speed = 11 + power * 19;

        this.ball.vx = clamp(
          nx * speed,
          -MAX_SPEED,
          MAX_SPEED
        );

        this.ball.vy = clamp(
          Math.max(1.5, ny * speed + 2.5),
          -MAX_SPEED,
          MAX_SPEED
        );

        this.ball.vz = clamp(
          nz * speed,
          -MAX_SPEED,
          MAX_SPEED
        );

        this.ball.lastGoal = "";

        this.broadcast("kick-confirmed", {
          sessionId: client.sessionId,
          power
        });

        this.broadcastBall();
      }
    );

    this.onMessage("reset-match", (client: Client) => {
      if (!this.players[client.sessionId]) return;

      this.ball = createInitialBall();
      this.goalResetTimer = 0;

      this.broadcast("score-state", {
        score: 0,
        goalsA: 0,
        goalsB: 0,
        matchOver: false,
        lastGoal: ""
      });

      this.broadcastBall();
    });

    this.setSimulationInterval((deltaTime) => {
      this.simulateBall(deltaTime / 1000);
    }, BALL_UPDATE_MS);
  }

  private collideBallWithPlayers() {
    const b = this.ball;

    for (const player of Object.values(this.players)) {
      // A esfera só toca o corpo se as alturas coincidirem.
      if (b.y - BALL_RADIUS > PLAYER_COLLISION_HEIGHT) {
        continue;
      }

      if (b.y + BALL_RADIUS < 0) continue;

      let dx = b.x - player.x;
      let dz = b.z - player.y;
      let distance = Math.sqrt(dx * dx + dz * dz);

      const minimumDistance =
        PLAYER_COLLISION_RADIUS + BALL_RADIUS;

      if (distance >= minimumDistance) continue;

      if (distance < 0.0001) {
        dx = 1;
        dz = 0;
        distance = 1;
      }

      const nx = dx / distance;
      const nz = dz / distance;

      // Corrige a penetração da bola no jogador.
      b.x = player.x + nx * minimumDistance;
      b.z = player.y + nz * minimumDistance;

      // Velocidade relativa ao jogador.
      const relativeVX = b.vx - player.vx;
      const relativeVZ = b.vz - player.vz;

      const closingSpeed =
        relativeVX * nx + relativeVZ * nz;

      // Resposta de colisão: a bola rebate ao contato.
      if (closingSpeed < 0) {
        const restitution = 0.45;

        b.vx -= (1 + restitution) * closingSpeed * nx;
        b.vz -= (1 + restitution) * closingSpeed * nz;
      }

      // Um jogador em movimento empurra a bola.
      // O impulso é aplicado apenas na direção do contato.
      const playerSpeedTowardBall =
        player.vx * nx + player.vz * nz;

      if (playerSpeedTowardBall > 0) {
        const push = Math.min(playerSpeedTowardBall * 0.65, 4);

        b.vx += nx * push;
        b.vz += nz * push;
      }

      b.vx = clamp(b.vx, -MAX_SPEED, MAX_SPEED);
      b.vz = clamp(b.vz, -MAX_SPEED, MAX_SPEED);
    }
  }

  private simulateBall(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;

    dt = Math.min(dt, 0.05);

    if (this.goalResetTimer > 0) {
      this.goalResetTimer -= dt;

      if (this.goalResetTimer <= 0) {
        this.ball.x = 0;
        this.ball.y = BALL_RADIUS;
        this.ball.z = 0;
        this.ball.vx = 0;
        this.ball.vy = 0;
        this.ball.vz = 0;
        this.ball.rx = 0;
        this.ball.rz = 0;

        this.broadcastBall();
      }

      return;
    }

    const b = this.ball;

    // Integração com subpassos para reduzir penetrações
    // durante movimentos rápidos da bola.
    const steps = Math.max(1, Math.ceil(dt / 0.01));
    const step = dt / steps;

    for (let i = 0; i < steps; i++) {
      b.vy -= GRAVITY * step;

      b.x += b.vx * step;
      b.y += b.vy * step;
      b.z += b.vz * step;

      b.rx += b.vz * step / BALL_RADIUS;
      b.rz -= b.vx * step / BALL_RADIUS;

      b.vx *= Math.pow(AIR_DRAG, step * 60);
      b.vy *= Math.pow(AIR_DRAG, step * 60);
      b.vz *= Math.pow(AIR_DRAG, step * 60);

      // Chão: quique ou rolamento.
      if (b.y < BALL_RADIUS) {
        b.y = BALL_RADIUS;

        if (b.vy < -1.1) {
          b.vy = -b.vy * BOUNCE;
        } else {
          b.vy = 0;
        }

        b.vx *= Math.pow(ROLLING_FRICTION, step * 60);
        b.vz *= Math.pow(ROLLING_FRICTION, step * 60);
      }

      // Contato com jogadores a cada subpasso.
      this.collideBallWithPlayers();

      if (b.x < -FIELD_HALF_WIDTH + BALL_RADIUS) {
        b.x = -FIELD_HALF_WIDTH + BALL_RADIUS;
        b.vx = Math.abs(b.vx) * 0.72;
      }

      if (b.x > FIELD_HALF_WIDTH - BALL_RADIUS) {
        b.x = FIELD_HALF_WIDTH - BALL_RADIUS;
        b.vx = -Math.abs(b.vx) * 0.72;
      }

      const insideGoalWidth = Math.abs(b.x) <= GOAL_HALF_WIDTH;
      const lowEnough = b.y <= GOAL_HEIGHT;

      if (
        insideGoalWidth &&
        lowEnough &&
        b.z < -FIELD_HALF_LENGTH
      ) {
        this.registerGoal("A");
        return;
      }

      if (
        insideGoalWidth &&
        lowEnough &&
        b.z > FIELD_HALF_LENGTH
      ) {
        this.registerGoal("B");
        return;
      }

      if (b.z < -FIELD_HALF_LENGTH) {
        b.z = -FIELD_HALF_LENGTH;
        b.vz = Math.abs(b.vz) * 0.72;
      }

      if (b.z > FIELD_HALF_LENGTH) {
        b.z = FIELD_HALF_LENGTH;
        b.vz = -Math.abs(b.vz) * 0.72;
      }

      b.vx = clamp(b.vx, -MAX_SPEED, MAX_SPEED);
      b.vy = clamp(b.vy, -MAX_SPEED, MAX_SPEED);
      b.vz = clamp(b.vz, -MAX_SPEED, MAX_SPEED);
    }

    this.broadcastBall();
  }

  private registerGoal(team: "A" | "B") {
    if (team === "A") {
      this.ball.goalsA += 1;
    } else {
      this.ball.goalsB += 1;
    }

    this.ball.score += 1;
    this.ball.lastGoal = team;

    this.ball.x = 0;
    this.ball.y = BALL_RADIUS;
    this.ball.z = 0;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.vz = 0;

    this.goalResetTimer = GOAL_RESET_SECONDS;

    const result = {
      score: this.ball.score,
      goalsA: this.ball.goalsA,
      goalsB: this.ball.goalsB,
      lastGoal: team,
      matchOver: false
    };

    this.broadcast("goal", result);
    this.broadcast("score-state", result);
    this.broadcastBall();
  }

  private broadcastBall() {
    this.broadcast("ball-state", { ...this.ball });
  }

  onJoin(client: Client) {
    this.players[client.sessionId] = {
      x: 0,
      y: 0,
      rotation: 0,
      vx: 0,
      vz: 0,
      lastMoveAt: Date.now()
    };

    client.send("players", this.players);
    this.broadcast("players", this.players);

    client.send("ball-state", { ...this.ball });

    client.send("score-state", {
      score: this.ball.score,
      goalsA: this.ball.goalsA,
      goalsB: this.ball.goalsB,
      lastGoal: this.ball.lastGoal,
      matchOver: false
    });

    console.log("Jogador entrou:", client.sessionId);
  }

  onLeave(client: Client) {
    delete this.players[client.sessionId];
    delete this.lastKickAt[client.sessionId];

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

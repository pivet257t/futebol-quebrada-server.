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
  clientTime?: number;
  sequence?: number;
  revision?: number;
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
  lastTouch: string;
  revision: number;
  trajectoryOwner: string;
  trajectoryUntil: number;
};

type TrajectoryData = {
  sequence: number;
  revision: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx?: number;
  rz?: number;
};

type BallMoveData = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx?: number;
  rz?: number;
  clientTime?: number;
  sequence?: number;
  prediction?: boolean;
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
    authority: "server-validated-with-ball-move-sync",
    multiplayer: true,
    physics: "server-validated",
    prediction: true,
    sharedBall: true,
    ballMoveSync: true
  });
});

const FIELD_HALF_WIDTH = 18;
const FIELD_HALF_LENGTH = 30;
const GOAL_HALF_WIDTH = 4.25;
const GOAL_HEIGHT = 3.2;

const BALL_RADIUS = 0.25;
const PLAYER_RADIUS = 0.42;
const PLAYER_HEIGHT = 1.5;
const PLAYER_BALL_DISTANCE = PLAYER_RADIUS + BALL_RADIUS;
const PLAYER_PLAYER_DISTANCE = PLAYER_RADIUS * 2;

const GRAVITY = 18;
const BOUNCE = 0.58;
const ROLLING_FRICTION = 0.982;
const AIR_DRAG = 0.998;
const MAX_BALL_SPEED = 35;
const MAX_PLAYER_SPEED = 6;
const MAX_PLAYER_STEP = 0.18;

const SIMULATION_MS = 1000 / 60;
const BALL_BROADCAST_MS = 33;
const PLAYER_BROADCAST_MS = 33;
const GOAL_RESET_SECONDS = 1.5;

const KICK_COOLDOWN_MS = 120;
const CONTACT_COOLDOWN_MS = 100;
const MAX_CONTACT_IMPULSE = 5;
const MIN_CONTACT_SPEED = 0.12;
const KICK_DISTANCE_ALLOWANCE = 0.48;
const CONTACT_DISTANCE_ALLOWANCE = 0.35;

const MAX_KICK_POWER = 1;
const TRAJECTORY_LEASE_MS = 180;
const MAX_TRAJECTORY_SPEED = 35;

// A transmissão contínua da bola usa um intervalo separado dos chutes.
// Os clientes podem enviar previsões, mas não podem sobrescrever livremente
// a posição oficial da bola nem anular um chute confirmado.
const BALL_MOVE_MIN_INTERVAL_MS = 20;
const BALL_MOVE_MAX_DISTANCE_PER_PACKET = 1.6;
const BALL_MOVE_MAX_POSITION_ERROR = 2.5;
const BALL_MOVE_MAX_VELOCITY_ERROR = 18;
const BALL_MOVE_IDLE_VELOCITY = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function distance2D(
  x1: number,
  z1: number,
  x2: number,
  z2: number
): number {
  return Math.hypot(x1 - x2, z1 - z2);
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
    lastGoal: "",
    lastTouch: "",
    revision: 0,
    trajectoryOwner: "",
    trajectoryUntil: 0
  };
}

class MatchRoom extends Room {
  maxClients = 2;

  players: Record<string, PlayerData> = {};
  ball: BallState = createInitialBall();

  private goalResetTimer = 0;
  private lastKickAt: Record<string, number> = {};
  private lastContactAt: Record<string, number> = {};
  private lastContactSequence: Record<string, number> = {};
  private lastTrajectorySequence: Record<string, number> = {};

  private lastBallMoveAt: Record<string, number> = {};
  private lastBallMoveSequence: Record<string, number> = {};

  private simulationAccumulator = 0;
  private lastBallBroadcastAt = 0;
  private lastPlayersBroadcastAt = 0;
  private lastBallMoveOwner = "";

  onCreate() {
    this.setMetadata({
      game: "Futebol de Quebrada",
      createdAt: Date.now()
    });

    this.onMessage("move", (client: Client, data: Partial<PlayerData>) => {
      this.handleMove(client, data);
    });

    this.onMessage("kick", (client: Client, data: Partial<KickData>) => {
      this.handleKick(client, data);
    });

    this.onMessage(
      "ball-contact",
      (client: Client, data: Partial<KickData>) => {
        this.handleBallContact(client, data);
      }
    );

    this.onMessage(
      "ball-trajectory",
      (client: Client, data: Partial<TrajectoryData>) => {
        this.handleTrajectory(client, data);
      }
    );

    // Novo caminho de sincronização contínua da bola.
    // O HTML transmite posição e velocidade em paralelo ao movimento
    // do jogador. O servidor valida os dados antes de atualizar o estado.
    this.onMessage(
      "ball-move",
      (client: Client, data: Partial<BallMoveData>) => {
        this.handleBallMove(client, data);
      }
    );

    this.onMessage("reset-match", (client: Client) => {
      if (!this.players[client.sessionId]) return;
      this.resetMatch();
    });

    this.setSimulationInterval((deltaTime) => {
      const elapsed = clamp(deltaTime / 1000, 0, 0.1);
      this.simulationAccumulator += elapsed;

      let steps = 0;

      while (
        this.simulationAccumulator >= SIMULATION_MS / 1000 &&
        steps < 6
      ) {
        this.simulate(SIMULATION_MS / 1000);
        this.simulationAccumulator -= SIMULATION_MS / 1000;
        steps++;
      }

      if (steps >= 6) {
        this.simulationAccumulator = 0;
      }

      const now = Date.now();

      if (now - this.lastBallBroadcastAt >= BALL_BROADCAST_MS) {
        this.lastBallBroadcastAt = now;
        this.broadcastBall();
      }

      if (now - this.lastPlayersBroadcastAt >= PLAYER_BROADCAST_MS) {
        this.lastPlayersBroadcastAt = now;
        this.broadcast("players", this.players);
      }

      if (
        this.ball.trajectoryOwner &&
        now > this.ball.trajectoryUntil
      ) {
        this.ball.trajectoryOwner = "";
      }
    }, SIMULATION_MS);
  }

  private handleMove(
    client: Client,
    data: Partial<PlayerData>
  ) {
    const player = this.players[client.sessionId];

    if (!player || !data || typeof data !== "object") return;

    const now = Date.now();

    const elapsed = clamp(
      (now - player.lastMoveAt) / 1000,
      0.016,
      0.1
    );

    const oldX = player.x;
    const oldZ = player.y;

    const requestedX = finite(data.x, oldX);
    const requestedZ = finite(data.y, oldZ);

    const dx = requestedX - oldX;
    const dz = requestedZ - oldZ;
    const requestedDistance = Math.hypot(dx, dz);

    const maxDistance = Math.min(
      MAX_PLAYER_STEP,
      MAX_PLAYER_SPEED * elapsed
    );

    let nextX = oldX;
    let nextZ = oldZ;

    if (requestedDistance > 0.0001) {
      const allowed = Math.min(
        requestedDistance,
        maxDistance
      );

      nextX += dx / requestedDistance * allowed;
      nextZ += dz / requestedDistance * allowed;
    }

    nextX = clamp(
      nextX,
      -FIELD_HALF_WIDTH + PLAYER_RADIUS,
      FIELD_HALF_WIDTH - PLAYER_RADIUS
    );

    nextZ = clamp(
      nextZ,
      -FIELD_HALF_LENGTH + PLAYER_RADIUS,
      FIELD_HALF_LENGTH - PLAYER_RADIUS
    );

    const ballBlocked = this.resolvePlayerBallMovement(
      player,
      oldX,
      oldZ,
      nextX,
      nextZ
    );

    if (ballBlocked) {
      nextX = ballBlocked.x;
      nextZ = ballBlocked.z;
    }

    const playerBlocked = this.resolvePlayerPlayerMovement(
      client.sessionId,
      oldX,
      oldZ,
      nextX,
      nextZ
    );

    if (playerBlocked) {
      nextX = playerBlocked.x;
      nextZ = playerBlocked.z;
    }

    player.x = nextX;
    player.y = nextZ;

    player.vx = clamp(
      (nextX - oldX) / elapsed,
      -MAX_PLAYER_SPEED,
      MAX_PLAYER_SPEED
    );

    player.vz = clamp(
      (nextZ - oldZ) / elapsed,
      -MAX_PLAYER_SPEED,
      MAX_PLAYER_SPEED
    );

    if (
      typeof data.rotation === "number" &&
      Number.isFinite(data.rotation)
    ) {
      player.rotation = data.rotation;
    }

    player.lastMoveAt = now;

    if (ballBlocked) {
      this.applyPlayerBallImpulse(client.sessionId, player);
    }

    this.broadcast("players", this.players);
  }

  private handleBallMove(
    client: Client,
    data: Partial<BallMoveData>
  ) {
    const sessionId = client.sessionId;

    if (!this.players[sessionId] || !data || typeof data !== "object") {
      return;
    }

    if (this.goalResetTimer > 0) return;

    const now = Date.now();
    const lastPacketAt = this.lastBallMoveAt[sessionId] || 0;

    // Limita a frequência para evitar sobrecarga.
    if (now - lastPacketAt < BALL_MOVE_MIN_INTERVAL_MS) return;

    const sequence = Math.max(
      0,
      Math.floor(finite(data.sequence, 0))
    );

    const previousSequence = this.lastBallMoveSequence[sessionId] || 0;

    if (sequence > 0 && sequence <= previousSequence) return;

    if (sequence > 0) {
      this.lastBallMoveSequence[sessionId] = sequence;
    }

    this.lastBallMoveAt[sessionId] = now;

    const b = this.ball;
    const player = this.players[sessionId];

    const requestedX = clamp(
      finite(data.x, b.x),
      -FIELD_HALF_WIDTH - 2,
      FIELD_HALF_WIDTH + 2
    );

    const requestedY = clamp(
      finite(data.y, b.y),
      BALL_RADIUS,
      GOAL_HEIGHT + 3
    );

    const requestedZ = clamp(
      finite(data.z, b.z),
      -FIELD_HALF_LENGTH - 3,
      FIELD_HALF_LENGTH + 3
    );

    const requestedVX = clamp(
      finite(data.vx, b.vx),
      -MAX_BALL_SPEED,
      MAX_BALL_SPEED
    );

    const requestedVY = clamp(
      finite(data.vy, b.vy),
      -MAX_BALL_SPEED,
      MAX_BALL_SPEED
    );

    const requestedVZ = clamp(
      finite(data.vz, b.vz),
      -MAX_BALL_SPEED,
      MAX_BALL_SPEED
    );

    // O cliente só pode corrigir a bola se a posição transmitida estiver
    // razoavelmente próxima do estado oficial. Isso evita que um pacote
    // atrasado teletransporte a bola para trás depois de um chute.
    const positionError = Math.hypot(
      requestedX - b.x,
      requestedY - b.y,
      requestedZ - b.z
    );

    const velocityError = Math.hypot(
      requestedVX - b.vx,
      requestedVY - b.vy,
      requestedVZ - b.vz
    );

    // Se outro jogador acabou de chutar ou tocar na bola, os pacotes
    // antigos do outro cliente não podem substituir a nova trajetória.
    const hasFreshTrajectory =
      Boolean(b.trajectoryOwner) &&
      now <= b.trajectoryUntil &&
      b.trajectoryOwner !== sessionId;

    if (hasFreshTrajectory) {
      client.send("trajectory-correction", {
        reason: "newer-server-trajectory",
        ...b
      });
      return;
    }

    // O servidor continua sendo a autoridade da bola.
    // Aceita pequenas diferenças de previsão para reduzir o atraso visual,
    // mas nunca permite grandes saltos de posição ou velocidade.
    if (
      positionError > BALL_MOVE_MAX_POSITION_ERROR ||
      velocityError > BALL_MOVE_MAX_VELOCITY_ERROR
    ) {
      client.send("trajectory-correction", {
        reason: "ball-state-too-far",
        ...b
      });
      return;
    }

    const horizontalDistance = distance2D(
      player.x,
      player.y,
      requestedX,
      requestedZ
    );

    const nearBall =
      horizontalDistance <=
      PLAYER_BALL_DISTANCE + KICK_DISTANCE_ALLOWANCE + 0.7;

    // Para o jogador que acabou de interagir com a bola, aceitamos uma
    // reconciliação limitada. Se não está perto, não pode mover a bola
    // livremente só enviando coordenadas.
    const ownsRecentTrajectory =
      b.trajectoryOwner === sessionId &&
      now <= b.trajectoryUntil;

    const ballIsNearlyStill =
      Math.hypot(b.vx, b.vy, b.vz) < BALL_MOVE_IDLE_VELOCITY;

    if (!nearBall && !ownsRecentTrajectory && !ballIsNearlyStill) {
      client.send("trajectory-correction", {
        reason: "player-too-far",
        ...b
      });
      return;
    }

    // Limita o quanto a posição pode ser corrigida em um único pacote.
    // A velocidade e a simulação do servidor continuam determinando
    // a trajetória compartilhada.
    const dx = requestedX - b.x;
    const dy = requestedY - b.y;
    const dz = requestedZ - b.z;
    const distance = Math.hypot(dx, dy, dz);

    const maxCorrection = Math.min(
      BALL_MOVE_MAX_DISTANCE_PER_PACKET,
      Math.max(0.12, MAX_BALL_SPEED * ((now - lastPacketAt) / 1000))
    );

    if (distance > 0.0001) {
      const allowed = Math.min(distance, maxCorrection);
      const factor = allowed / distance;

      b.x += dx * factor;
      b.y += dy * factor;
      b.z += dz * factor;
    }

    // Não deixa o cliente apagar um chute confirmado. Quando a bola está
    // em movimento, usa a velocidade oficial e suaviza apenas pequenas
    // diferenças enviadas pela previsão local.
    const authoritativeSpeed = Math.hypot(b.vx, b.vy, b.vz);

    if (!ownsRecentTrajectory || authoritativeSpeed < 1.5) {
      b.vx = b.vx * 0.75 + requestedVX * 0.25;
      b.vy = b.vy * 0.75 + requestedVY * 0.25;
      b.vz = b.vz * 0.75 + requestedVZ * 0.25;
    }

    if (typeof data.rx === "number" && Number.isFinite(data.rx)) {
      b.rx = data.rx;
    }

    if (typeof data.rz === "number" && Number.isFinite(data.rz)) {
      b.rz = data.rz;
    }

    this.clampBallVelocity();

    // Se o cliente está próximo e a bola se moveu de forma válida,
    // registra quem teve o contato mais recente.
    if (nearBall && horizontalDistance <= PLAYER_BALL_DISTANCE + 0.55) {
      b.lastTouch = sessionId;
      this.lastBallMoveOwner = sessionId;
    }

    b.revision++;

    // Retransmite imediatamente para os dois jogadores, sem esperar
    // o próximo intervalo normal de broadcast.
    this.broadcastBall();
  }

  private resolvePlayerBallMovement(
    player: PlayerData,
    oldX: number,
    oldZ: number,
    nextX: number,
    nextZ: number
  ): { x: number; z: number } | null {
    const b = this.ball;

    if (
      b.y - BALL_RADIUS > PLAYER_HEIGHT ||
      b.y + BALL_RADIUS < 0
    ) {
      return null;
    }

    const dx = nextX - oldX;
    const dz = nextZ - oldZ;
    const lengthSquared = dx * dx + dz * dz;

    let t = 0;

    if (lengthSquared > 0.000001) {
      t = clamp(
        ((b.x - oldX) * dx + (b.z - oldZ) * dz) /
          lengthSquared,
        0,
        1
      );
    }

    const closestX = oldX + dx * t;
    const closestZ = oldZ + dz * t;

    const distance = distance2D(
      closestX,
      closestZ,
      b.x,
      b.z
    );

    if (distance >= PLAYER_BALL_DISTANCE) {
      return null;
    }

    let nx = closestX - b.x;
    let nz = closestZ - b.z;
    let length = Math.hypot(nx, nz);

    if (length < 0.0001) {
      nx = -dx;
      nz = -dz;
      length = Math.hypot(nx, nz);

      if (length < 0.0001) {
        nx = Math.sin(player.rotation);
        nz = Math.cos(player.rotation);
        length = 1;
      }
    }

    nx /= length;
    nz /= length;

    let x = nextX;
    let z = nextZ;

    const finalDistance = distance2D(
      x,
      z,
      b.x,
      b.z
    );

    if (finalDistance < PLAYER_BALL_DISTANCE) {
      x = b.x - nx * PLAYER_BALL_DISTANCE;
      z = b.z - nz * PLAYER_BALL_DISTANCE;
    }

    return {
      x: clamp(
        x,
        -FIELD_HALF_WIDTH + PLAYER_RADIUS,
        FIELD_HALF_WIDTH - PLAYER_RADIUS
      ),
      z: clamp(
        z,
        -FIELD_HALF_LENGTH + PLAYER_RADIUS,
        FIELD_HALF_LENGTH - PLAYER_RADIUS
      )
    };
  }

  private resolvePlayerPlayerMovement(
    sessionId: string,
    oldX: number,
    oldZ: number,
    nextX: number,
    nextZ: number
  ): { x: number; z: number } | null {
    let x = nextX;
    let z = nextZ;
    let collided = false;

    for (let iteration = 0; iteration < 3; iteration++) {
      for (const [otherId, other] of Object.entries(this.players)) {
        if (otherId === sessionId) continue;

        let dx = x - other.x;
        let dz = z - other.y;
        let distance = Math.hypot(dx, dz);

        if (distance >= PLAYER_PLAYER_DISTANCE) continue;

        if (distance < 0.0001) {
          dx = oldX - other.x;
          dz = oldZ - other.y;
          distance = Math.hypot(dx, dz);

          if (distance < 0.0001) {
            dx = 1;
            dz = 0;
            distance = 1;
          }
        }

        x =
          other.x +
          (dx / distance) * PLAYER_PLAYER_DISTANCE;

        z =
          other.y +
          (dz / distance) * PLAYER_PLAYER_DISTANCE;

        x = clamp(
          x,
          -FIELD_HALF_WIDTH + PLAYER_RADIUS,
          FIELD_HALF_WIDTH - PLAYER_RADIUS
        );

        z = clamp(
          z,
          -FIELD_HALF_LENGTH + PLAYER_RADIUS,
          FIELD_HALF_LENGTH - PLAYER_RADIUS
        );

        collided = true;
      }
    }

    return collided ? { x, z } : null;
  }

  private applyKickImpulse(
    client: Client,
    data: Partial<KickData>
  ): boolean {
    const player = this.players[client.sessionId];

    if (!player || !data || typeof data !== "object") {
      return false;
    }

    if (this.goalResetTimer > 0) return false;

    const now = Date.now();
    const last = this.lastKickAt[client.sessionId] || 0;

    if (now - last < KICK_COOLDOWN_MS) {
      client.send("kick-rejected", {
        reason: "cooldown",
        revision: this.ball.revision
      });

      return false;
    }

    const horizontalDistance = distance2D(
      player.x,
      player.y,
      this.ball.x,
      this.ball.z
    );

    if (
      horizontalDistance >
      PLAYER_BALL_DISTANCE + KICK_DISTANCE_ALLOWANCE
    ) {
      client.send("kick-rejected", {
        reason: "too-far",
        revision: this.ball.revision
      });

      return false;
    }

    if (
      this.ball.y - BALL_RADIUS > PLAYER_HEIGHT ||
      this.ball.y + BALL_RADIUS < 0
    ) {
      client.send("kick-rejected", {
        reason: "height",
        revision: this.ball.revision
      });

      return false;
    }

    const dx = finite(data.dx);
    const dy = finite(data.dy);
    const dz = finite(data.dz, -1);

    const power = clamp(
      finite(data.power, 0.5),
      0.22,
      MAX_KICK_POWER
    );

    const length = Math.hypot(dx, dy, dz);

    if (length < 0.001) return false;

    const nx = dx / length;
    const ny = dy / length;
    const nz = dz / length;

    const speed = 11 + power * 19;

    this.lastKickAt[client.sessionId] = now;

    this.ball.vx += nx * speed;
    this.ball.vy += Math.max(
      1.5,
      ny * speed + 2.5
    );
    this.ball.vz += nz * speed;

    this.clampBallVelocity();

    this.ball.lastTouch = client.sessionId;
    this.ball.lastGoal = "";
    this.ball.trajectoryOwner = client.sessionId;
    this.ball.trajectoryUntil = now + TRAJECTORY_LEASE_MS;
    this.ball.revision++;

    const result = {
      sessionId: client.sessionId,
      sequence: finite(data.sequence),
      power,
      revision: this.ball.revision,
      trajectoryOwner: this.ball.trajectoryOwner,
      x: this.ball.x,
      y: this.ball.y,
      z: this.ball.z,
      vx: this.ball.vx,
      vy: this.ball.vy,
      vz: this.ball.vz
    };

    this.broadcast("kick-confirmed", result);
    this.broadcastBall();

    return true;
  }

  private handleKick(
    client: Client,
    data: Partial<KickData>
  ) {
    this.applyKickImpulse(client, data);
  }

  private handleBallContact(
    client: Client,
    data: Partial<KickData>
  ) {
    const player = this.players[client.sessionId];

    if (!player || !data || typeof data !== "object") return;
    if (this.goalResetTimer > 0) return;

    const now = Date.now();

    const sequence = Math.max(
      0,
      Math.floor(finite(data.sequence, 0))
    );

    const lastSequence =
      this.lastContactSequence[client.sessionId] || 0;

    if (sequence > 0 && sequence <= lastSequence) return;

    if (sequence > 0) {
      this.lastContactSequence[client.sessionId] = sequence;
    }

    const distance = distance2D(
      player.x,
      player.y,
      this.ball.x,
      this.ball.z
    );

    if (
      distance >
      PLAYER_BALL_DISTANCE + CONTACT_DISTANCE_ALLOWANCE
    ) {
      client.send("ball-contact-rejected", {
        sequence,
        revision: this.ball.revision,
        reason: "too-far"
      });

      return;
    }

    if (
      this.ball.y - BALL_RADIUS > PLAYER_HEIGHT ||
      this.ball.y + BALL_RADIUS < 0
    ) {
      client.send("ball-contact-rejected", {
        sequence,
        revision: this.ball.revision,
        reason: "height"
      });

      return;
    }

    const last = this.lastContactAt[client.sessionId] || 0;

    if (now - last < CONTACT_COOLDOWN_MS) {
      client.send("ball-contact-rejected", {
        sequence,
        revision: this.ball.revision,
        reason: "cooldown"
      });

      return;
    }

    let dx = this.ball.x - player.x;
    let dz = this.ball.z - player.y;
    let length = Math.hypot(dx, dz);

    if (length < 0.0001) {
      dx = Math.sin(player.rotation);
      dz = Math.cos(player.rotation);
      length = Math.hypot(dx, dz) || 1;
    }

    dx /= length;
    dz /= length;

    const playerTowardBall =
      player.vx * dx + player.vz * dz;

    const ballTowardPlayer =
      -(this.ball.vx * dx + this.ball.vz * dz);

    if (
      playerTowardBall < MIN_CONTACT_SPEED &&
      ballTowardPlayer < MIN_CONTACT_SPEED
    ) {
      client.send("ball-contact-rejected", {
        sequence,
        revision: this.ball.revision,
        reason: "no-approach"
      });

      return;
    }

    this.lastContactAt[client.sessionId] = now;

    const relativeSpeed = Math.max(
      0,
      playerTowardBall + ballTowardPlayer
    );

    const impulse = clamp(
      relativeSpeed * 0.65,
      0.25,
      MAX_CONTACT_IMPULSE
    );

    this.ball.vx += dx * impulse;
    this.ball.vz += dz * impulse;

    this.clampBallVelocity();

    this.ball.lastTouch = client.sessionId;
    this.ball.trajectoryOwner = client.sessionId;
    this.ball.trajectoryUntil = now + TRAJECTORY_LEASE_MS;
    this.ball.revision++;

    const confirmation = {
      sessionId: client.sessionId,
      sequence,
      revision: this.ball.revision,
      trajectoryOwner: this.ball.trajectoryOwner,
      x: this.ball.x,
      y: this.ball.y,
      z: this.ball.z,
      vx: this.ball.vx,
      vy: this.ball.vy,
      vz: this.ball.vz
    };

    client.send("ball-contact-confirmed", confirmation);
    this.broadcast("ball-contact-confirmed", confirmation);
    this.broadcastBall();
  }

  private handleTrajectory(
    client: Client,
    data: Partial<TrajectoryData>
  ) {
    if (!this.players[client.sessionId] || !data) return;

    const sequence = Math.max(
      0,
      Math.floor(finite(data.sequence, 0))
    );

    const lastSequence =
      this.lastTrajectorySequence[client.sessionId] || 0;

    if (sequence > 0 && sequence <= lastSequence) return;

    if (sequence > 0) {
      this.lastTrajectorySequence[client.sessionId] = sequence;
    }

    client.send("trajectory-correction", {
      reason: "server-authoritative",
      ...this.ball
    });
  }

  private applyPlayerBallImpulse(
    sessionId: string,
    player: PlayerData
  ) {
    const b = this.ball;

    if (
      b.y - BALL_RADIUS > PLAYER_HEIGHT ||
      b.y + BALL_RADIUS < 0
    ) {
      return;
    }

    let dx = b.x - player.x;
    let dz = b.z - player.y;
    let distance = Math.hypot(dx, dz);

    if (
      distance >
      PLAYER_BALL_DISTANCE + CONTACT_DISTANCE_ALLOWANCE
    ) {
      return;
    }

    if (distance < 0.0001) {
      dx = Math.sin(player.rotation);
      dz = Math.cos(player.rotation);
      distance = Math.hypot(dx, dz) || 1;
    }

    const nx = dx / distance;
    const nz = dz / distance;

    const speedTowardBall =
      player.vx * nx + player.vz * nz;

    if (speedTowardBall <= MIN_CONTACT_SPEED) return;

    const now = Date.now();
    const last = this.lastContactAt[sessionId] || 0;

    if (now - last < CONTACT_COOLDOWN_MS) return;

    this.lastContactAt[sessionId] = now;

    const impulse = Math.min(
      speedTowardBall * 0.75,
      MAX_CONTACT_IMPULSE
    );

    b.vx += nx * impulse;
    b.vz += nz * impulse;

    this.clampBallVelocity();

    b.lastTouch = sessionId;
    b.trajectoryOwner = sessionId;
    b.trajectoryUntil = now + TRAJECTORY_LEASE_MS;
    b.revision++;

    this.broadcast("ball-contact-confirmed", {
      sessionId,
      revision: b.revision,
      trajectoryOwner: b.trajectoryOwner,
      x: b.x,
      y: b.y,
      z: b.z,
      vx: b.vx,
      vy: b.vy,
      vz: b.vz
    });

    this.broadcastBall();
  }

  private clampBallVelocity() {
    this.ball.vx = clamp(
      this.ball.vx,
      -MAX_BALL_SPEED,
      MAX_BALL_SPEED
    );

    this.ball.vy = clamp(
      this.ball.vy,
      -MAX_BALL_SPEED,
      MAX_BALL_SPEED
    );

    this.ball.vz = clamp(
      this.ball.vz,
      -MAX_BALL_SPEED,
      MAX_BALL_SPEED
    );
  }

  private simulate(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;

    if (this.goalResetTimer > 0) {
      this.goalResetTimer -= dt;

      if (this.goalResetTimer <= 0) {
        const previous = this.ball;

        this.ball = {
          ...createInitialBall(),
          score: previous.score,
          goalsA: previous.goalsA,
          goalsB: previous.goalsB,
          lastGoal: previous.lastGoal,
          revision: previous.revision + 1
        };

        this.lastBallMoveOwner = "";
        this.broadcastBall();
      }

      return;
    }

    const b = this.ball;

    const steps = Math.max(
      1,
      Math.ceil(dt / 0.005)
    );

    const step = dt / steps;

    for (let i = 0; i < steps; i++) {
      const oldX = b.x;
      const oldY = b.y;
      const oldZ = b.z;

      b.vy -= GRAVITY * step;

      const nextX = b.x + b.vx * step;
      const nextY = b.y + b.vy * step;
      const nextZ = b.z + b.vz * step;

      this.resolveBallSweptCollision(
        oldX,
        oldY,
        oldZ,
        nextX,
        nextY,
        nextZ
      );

      b.x += b.vx * step;
      b.y += b.vy * step;
      b.z += b.vz * step;

      b.rx += (b.vz * step) / BALL_RADIUS;
      b.rz -= (b.vx * step) / BALL_RADIUS;

      b.vx *= Math.pow(AIR_DRAG, step * 60);
      b.vy *= Math.pow(AIR_DRAG, step * 60);
      b.vz *= Math.pow(AIR_DRAG, step * 60);

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

      this.clampBallVelocity();
    }
  }

  private resolveBallSweptCollision(
    oldX: number,
    oldY: number,
    oldZ: number,
    nextX: number,
    nextY: number,
    nextZ: number
  ) {
    const b = this.ball;

    const dx = nextX - oldX;
    const dz = nextZ - oldZ;
    const lengthSquared = dx * dx + dz * dz;

    for (const player of Object.values(this.players)) {
      let t = 0;

      if (lengthSquared > 0.000001) {
        t = clamp(
          (
            (player.x - oldX) * dx +
            (player.y - oldZ) * dz
          ) / lengthSquared,
          0,
          1
        );
      }

      const closestX = oldX + dx * t;
      const closestZ = oldZ + dz * t;
      const closestY = oldY + (nextY - oldY) * t;

      if (
        closestY - BALL_RADIUS > PLAYER_HEIGHT ||
        closestY + BALL_RADIUS < 0
      ) {
        continue;
      }

      let nx = closestX - player.x;
      let nz = closestZ - player.y;
      let distance = Math.hypot(nx, nz);

      if (distance >= PLAYER_BALL_DISTANCE) continue;

      if (distance < 0.0001) {
        nx = -dx;
        nz = -dz;
        distance = Math.hypot(nx, nz);

        if (distance < 0.0001) {
          nx = 1;
          nz = 0;
          distance = 1;
        }
      }

      nx /= distance;
      nz /= distance;

      const penetration = PLAYER_BALL_DISTANCE - distance;

      b.x += nx * penetration;
      b.z += nz * penetration;

      const relativeVX = b.vx - player.vx;
      const relativeVZ = b.vz - player.vz;

      const closingSpeed =
        relativeVX * nx + relativeVZ * nz;

      if (closingSpeed < 0) {
        const impulse = -(1 + 0.45) * closingSpeed;

        b.vx += impulse * nx;
        b.vz += impulse * nz;

        b.revision++;
      }
    }
  }

  private collideBallWithPlayers() {
    const b = this.ball;

    for (const player of Object.values(this.players)) {
      if (
        b.y - BALL_RADIUS > PLAYER_HEIGHT ||
        b.y + BALL_RADIUS < 0
      ) {
        continue;
      }

      let dx = b.x - player.x;
      let dz = b.z - player.y;
      let distance = Math.hypot(dx, dz);

      if (distance >= PLAYER_BALL_DISTANCE) continue;

      if (distance < 0.0001) {
        dx = 1;
        dz = 0;
        distance = 1;
      }

      const nx = dx / distance;
      const nz = dz / distance;

      b.x = player.x + nx * PLAYER_BALL_DISTANCE;
      b.z = player.y + nz * PLAYER_BALL_DISTANCE;

      const relativeVX = b.vx - player.vx;
      const relativeVZ = b.vz - player.vz;

      const closingSpeed =
        relativeVX * nx + relativeVZ * nz;

      if (closingSpeed < 0) {
        const impulse = -(1 + 0.45) * closingSpeed;

        b.vx += impulse * nx;
        b.vz += impulse * nz;

        b.revision++;
      }

      this.clampBallVelocity();
    }
  }

  private registerGoal(team: "A" | "B") {
    if (team === "A") {
      this.ball.goalsA++;
    } else {
      this.ball.goalsB++;
    }

    this.ball.score++;
    this.ball.lastGoal = team;

    this.ball.x = 0;
    this.ball.y = BALL_RADIUS;
    this.ball.z = 0;

    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.vz = 0;

    this.ball.lastTouch = "";
    this.ball.trajectoryOwner = "";
    this.ball.trajectoryUntil = 0;
    this.ball.revision++;

    this.lastBallMoveOwner = "";
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

  private resetMatch() {
    this.ball = createInitialBall();
    this.goalResetTimer = 0;

    this.lastKickAt = {};
    this.lastContactAt = {};
    this.lastContactSequence = {};
    this.lastTrajectorySequence = {};
    this.lastBallMoveAt = {};
    this.lastBallMoveSequence = {};
    this.lastBallMoveOwner = "";

    this.broadcast("score-state", {
      score: 0,
      goalsA: 0,
      goalsB: 0,
      matchOver: false,
      lastGoal: ""
    });

    this.broadcastBall();
  }

  private broadcastBall() {
    this.broadcast("ball-state", { ...this.ball });
  }

  onJoin(client: Client) {
    this.players[client.sessionId] = {
      x: this.playersCount === 1 ? -2 : 2,
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
    delete this.lastContactAt[client.sessionId];
    delete this.lastContactSequence[client.sessionId];
    delete this.lastTrajectorySequence[client.sessionId];
    delete this.lastBallMoveAt[client.sessionId];
    delete this.lastBallMoveSequence[client.sessionId];

    if (this.ball.trajectoryOwner === client.sessionId) {
      this.ball.trajectoryOwner = "";
      this.ball.trajectoryUntil = 0;
      this.ball.revision++;
      this.broadcastBall();
    }

    if (this.lastBallMoveOwner === client.sessionId) {
      this.lastBallMoveOwner = "";
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
    if (code) {
      roomCodes.delete(code);
    }

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

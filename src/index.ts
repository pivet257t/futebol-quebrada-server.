
import { Server, Room, Client, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import http from "http";

const app = express();
app.use(express.json());

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


app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    game: "Futebol de Quebrada"
  });
});

class MatchRoom extends Room {
  maxClients = 2;

  state = {
    players: {} as Record<string, {
      x: number;
      y: number;
      rotation: number;
    }>
  };

  onCreate() {
    this.setMetadata({
      createdAt: Date.now()
    });

    this.onMessage("move", (client, data) => {
      const player = this.state.players[client.sessionId];
      if (!player || !data) return;

      if (typeof data.x === "number") {
        player.x = Math.max(-1000, Math.min(1000, data.x));
      }

      if (typeof data.y === "number") {
        player.y = Math.max(-1000, Math.min(1000, data.y));
      }

      if (typeof data.rotation === "number") {
        player.rotation = data.rotation;
      }

      this.broadcast("players", this.state.players);
    });
  }

  onJoin(client: Client) {
    this.state.players[client.sessionId] = {
      x: 0,
      y: 0,
      rotation: 0
    };

    client.send("players", this.state.players);
    this.broadcast("players", this.state.players);

    console.log("Jogador entrou:", client.sessionId);
  }

  onLeave(client: Client) {
    delete this.state.players[client.sessionId];

    this.broadcast("players", this.state.players);
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

app.post("/api/rooms/create", async (_req, res) => {
  try {
    let code = "";

    for (let i = 0; i < 50; i++) {
      const candidate = String(
        Math.floor(100000 + Math.random() * 900000)
      );

      if (!roomCodes.has(candidate)) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      res.status(503).json({
        status: "error",
        message: "Tente criar a sala novamente"
      });
      return;
    }

    const room = await matchMaker.createRoom("match", {
      code
    });

    roomCodes.set(code, room.roomId);

    res.json({
      status: "ok",
      code,
      roomId: room.roomId,
      message: "Sala criada"
    });
  } catch (error) {
    console.error("Erro ao criar sala:", error);

    res.status(500).json({
      status: "error",
      message: "Não foi possível criar a sala"
    });
  }
});

app.post("/api/rooms/join", (req, res) => {
  const code = String(req.body?.code || "").trim();

  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({
      status: "error",
      message: "Digite um código de 6 números"
    });
    return;
  }

  const roomId = roomCodes.get(code);

  if (!roomId) {
    res.status(404).json({
      status: "error",
      message: "Sala não encontrada ou servidor reiniciado"
    });
    return;
  }

  res.json({
    status: "ok",
    roomId
  });
});

const port = Number(process.env.PORT || 2567);

gameServer.listen(port).then(() => {
  console.log("Servidor iniciado na porta", port);
});

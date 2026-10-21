
import { Server, Room, Client, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import http from "http";

const app = express();
app.use(express.json());

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

app.post("/api/rooms/create", async (_req, res) => {
  try {
    const room = await matchMaker.createRoom("match", {});

    res.json({
      status: "ok",
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

const port = Number(process.env.PORT || 2567);

gameServer.listen(port).then(() => {
  console.log("Servidor iniciado na porta", port);
});

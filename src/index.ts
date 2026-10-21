
import { Server, Room, Client } from "colyseus";
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

  onCreate() {
    this.setMetadata({
      createdAt: Date.now()
    });
  }

  onJoin(client: Client) {
    console.log("Jogador entrou:", client.sessionId);
  }

  onLeave(client: Client) {
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
    const room = await gameServer.createRoom("match", {});
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

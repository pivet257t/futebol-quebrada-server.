
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import http from "http";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", game: "Futebol de Quebrada" });
});

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer
  })
});

gameServer.define("match", class extends (await import("@colyseus/core")).Room {
  maxClients = 2;

  onCreate() {
    this.setMetadata({ createdAt: Date.now() });
  }

  onJoin(client) {
    console.log("Jogador entrou:", client.sessionId);
  }

  onLeave(client) {
    console.log("Jogador saiu:", client.sessionId);
  }
});

const port = Number(process.env.PORT || 2567);

gameServer.listen(port).then(() => {
  console.log(`Servidor iniciado na porta ${port}`);
});

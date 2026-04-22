const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

app.get("/{*any}", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

const rooms = {};
const TOTAL_ROUNDS = 5;
const MAX_PLAYERS = 5;

function randomRoomCode() {
  let code = "";
  for (let i = 0; i < 10; i++) code += Math.floor(Math.random() * 10);
  return code;
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function assignWords(players, submissions) {
  const ids = players.map((p) => p.id);
  let shuffled = shuffle(ids);

  let safe = false;
  let tries = 0;

  while (!safe && tries < 100) {
    safe = true;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] === shuffled[i]) {
        safe = false;
        shuffled = shuffle(ids);
        break;
      }
    }
    tries++;
  }

  if (!safe) {
    shuffled = [...ids.slice(1), ids[0]];
  }

  const assignments = {};

  for (let i = 0; i < ids.length; i++) {
    const receiverId = ids[i];
    const ownerId = shuffled[i];

    assignments[receiverId] = {
      ownerId,
      word: submissions[ownerId].word,
      hint: submissions[ownerId].hint,
      ownerNick: submissions[ownerId].nick
    };
  }

  return assignments;
}

function getOpenRooms() {
  return Object.entries(rooms)
    .filter(([_, room]) => !room.gameStarted && room.players.length < MAX_PLAYERS)
    .map(([roomCode, room]) => ({
      roomCode,
      hostNick: room.players.find((p) => p.host)?.nick || "Bilinmiyor",
      playerCount: room.players.length,
      maxPlayers: MAX_PLAYERS
    }));
}

function broadcastOpenRooms() {
  io.emit("openRooms", getOpenRooms());
}

function startRoundForRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const submittedCount = Object.keys(room.submissions).length;
  if (submittedCount !== room.players.length) return;

  const assignments = assignWords(room.players, room.submissions);

  room.players.forEach((p) => {
    io.to(p.id).emit("startRound", {
      ...assignments[p.id],
      players: room.players,
      round: room.currentRound,
      totalRounds: TOTAL_ROUNDS
    });
  });
}

function finishGame(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  io.to(roomCode).emit("gameFinished", {
    players: [...room.players].sort((a, b) => b.score - a.score)
  });

  room.gameStarted = false;
  room.currentRound = 1;
  room.roundFinishedCount = 0;
  room.submissions = {};
  room.pendingRequests = [];

  room.players = room.players.map((p) => ({
    ...p,
    ready: false
  }));

  broadcastOpenRooms();
}

io.on("connection", (socket) => {
  socket.emit("openRooms", getOpenRooms());

  socket.on("getOpenRooms", () => {
    socket.emit("openRooms", getOpenRooms());
  });

  socket.on("createRoom", ({ nick }) => {
    let roomCode;
    do {
      roomCode = randomRoomCode();
    } while (rooms[roomCode]);

    rooms[roomCode] = {
      players: [{ id: socket.id, nick, ready: false, host: true, score: 0 }],
      gameStarted: false,
      submissions: {},
      currentRound: 1,
      roundFinishedCount: 0,
      pendingRequests: []
    };

    socket.join(roomCode);
    socket.emit("roomCreated", {
      roomCode,
      players: rooms[roomCode].players
    });

    broadcastOpenRooms();
  });

  socket.on("requestJoinRoom", ({ roomCode, nick }) => {
    const room = rooms[roomCode];

    if (!room) {
      socket.emit("joinRejected", { message: "Oda bulunamadı" });
      return;
    }

    if (room.gameStarted) {
      socket.emit("joinRejected", { message: "Oyun başlamış knk" });
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      socket.emit("joinRejected", { message: "Oda dolu" });
      return;
    }

    const alreadyPlayer = room.players.some((p) => p.id === socket.id);
    if (alreadyPlayer) {
      socket.emit("joinRejected", { message: "Zaten odadasın knk" });
      return;
    }

    const alreadyPending = room.pendingRequests.some((r) => r.socketId === socket.id);
    if (alreadyPending) {
      socket.emit("joinRejected", { message: "Zaten katılma talebi gönderdin" });
      return;
    }

    room.pendingRequests.push({
      socketId: socket.id,
      nick
    });

    const host = room.players.find((p) => p.host);
    if (host) {
      io.to(host.id).emit("joinRequestReceived", {
        roomCode,
        socketId: socket.id,
        nick
      });
    }

    socket.emit("joinRequestSent", {
      roomCode,
      message: "Katılma talebin gönderildi"
    });
  });

  socket.on("acceptJoinRequest", ({ roomCode, socketId }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const host = room.players.find((p) => p.id === socket.id && p.host);
    if (!host) return;

    const requestIndex = room.pendingRequests.findIndex((r) => r.socketId === socketId);
    if (requestIndex === -1) return;

    if (room.players.length >= MAX_PLAYERS) {
      io.to(socketId).emit("joinRejected", { message: "Oda doldu knk" });
      room.pendingRequests.splice(requestIndex, 1);
      return;
    }

    const request = room.pendingRequests[requestIndex];
    room.pendingRequests.splice(requestIndex, 1);

    room.players.push({
      id: request.socketId,
      nick: request.nick,
      ready: false,
      host: false,
      score: 0
    });

    io.sockets.sockets.get(request.socketId)?.join(roomCode);

    io.to(request.socketId).emit("joinAccepted", {
      roomCode,
      players: room.players
    });

    io.to(roomCode).emit("roomUpdated", room.players);
    broadcastOpenRooms();
  });

  socket.on("rejectJoinRequest", ({ roomCode, socketId }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const host = room.players.find((p) => p.id === socket.id && p.host);
    if (!host) return;

    const requestIndex = room.pendingRequests.findIndex((r) => r.socketId === socketId);
    if (requestIndex === -1) return;

    room.pendingRequests.splice(requestIndex, 1);

    io.to(socketId).emit("joinRejected", {
      message: "Katılma talebiniz reddedildi"
    });
  });

  socket.on("toggleReady", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.gameStarted) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    player.ready = !player.ready;
    io.to(roomCode).emit("roomUpdated", room.players);
  });

  socket.on("startGame", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.host) return;

    const allReady = room.players.length >= 2 && room.players.every((p) => p.ready);
    if (!allReady) {
      socket.emit("errorMessage", "Herkes hazır değil knk");
      return;
    }

    room.gameStarted = true;
    room.currentRound = 1;
    room.roundFinishedCount = 0;
    room.submissions = {};
    room.pendingRequests = [];

    io.to(roomCode).emit("showWordScreen", {
      round: room.currentRound,
      totalRounds: TOTAL_ROUNDS
    });

    broadcastOpenRooms();
  });

  socket.on("submitWord", ({ roomCode, word, hint }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    room.submissions[socket.id] = {
      nick: player.nick,
      word,
      hint
    };

    const submittedCount = Object.keys(room.submissions).length;

    io.to(roomCode).emit("submissionUpdate", {
      submittedCount,
      totalPlayers: room.players.length
    });

    if (submittedCount === room.players.length) {
      startRoundForRoom(roomCode);
    }
  });

  socket.on("wrongGuess", ({ roomCode, ownerId, guesserId }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const owner = room.players.find((p) => p.id === ownerId);
    const guesser = room.players.find((p) => p.id === guesserId);

    if (!owner || !guesser) return;

    owner.score += 10;
    guesser.score -= 10;

    io.to(roomCode).emit("scoresUpdated", room.players);
  });

  socket.on("wordSolved", ({ roomCode, ownerId, guesserId }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const owner = room.players.find((p) => p.id === ownerId);
    const guesser = room.players.find((p) => p.id === guesserId);

    if (!owner || !guesser) return;

    owner.score += 20;
    guesser.score += 50;

    io.to(roomCode).emit("scoresUpdated", room.players);
  });

  socket.on("roundFinished", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.roundFinishedCount += 1;

    if (room.roundFinishedCount >= room.players.length) {
      if (room.currentRound >= TOTAL_ROUNDS) {
        finishGame(roomCode);
      } else {
        room.currentRound += 1;
        room.roundFinishedCount = 0;
        room.submissions = {};

        io.to(roomCode).emit("showWordScreen", {
          round: room.currentRound,
          totalRounds: TOTAL_ROUNDS
        });
      }
    }
  });

  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const before = room.players.length;

      room.players = room.players.filter((p) => p.id !== socket.id);
      room.pendingRequests = room.pendingRequests.filter((r) => r.socketId !== socket.id);
      delete room.submissions[socket.id];

      if (room.players.length !== before) {
        if (room.players.length === 0) {
          delete rooms[roomCode];
        } else {
          if (!room.players.some((p) => p.host)) {
            room.players[0].host = true;
          }
          io.to(roomCode).emit("roomUpdated", room.players);
        }
        broadcastOpenRooms();
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Sunucu çalışıyor: " + PORT);
});

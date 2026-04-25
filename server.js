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

const WORD_BANK = {
  cars: [
    ["RENAULT", "Fransız otomobil markası"], ["MERCEDES", "Alman lüks otomobil markası"],
    ["TOYOTA", "Japon otomobil markası"], ["HONDA", "Japon otomobil markası"],
    ["VOLKSWAGEN", "Alman otomobil markası"], ["BMW", "Alman premium marka"],
    ["AUDI", "Dört halkalı marka"], ["FORD", "Amerikan otomobil markası"],
    ["HYUNDAI", "Güney Koreli otomobil markası"], ["FIAT", "İtalyan otomobil markası"]
  ],
  celebrities: [
    ["KEMAL SUNAL", "Türk sinemasının efsane komedyeni"], ["TARKAN", "Megastar"],
    ["CEM YILMAZ", "Ünlü komedyen"], ["BARIŞ MANÇO", "Adam olacak çocuk"],
    ["SEZEN AKSU", "Minik Serçe"], ["AJDA PEKKAN", "Süperstar"],
    ["ŞENER ŞEN", "Yeşilçam efsanesi"], ["MÜSLÜM GÜRSES", "Arabeskin baba sesi"]
  ],
  cities: [
    ["İSTANBUL", "Türkiye'nin en kalabalık şehri"], ["ANKARA", "Başkent"],
    ["İZMİR", "Ege'nin incisi"], ["KONYA", "Mevlana şehri"],
    ["ANTALYA", "Turizm cenneti"], ["BURSA", "Yeşil şehir"],
    ["TRABZON", "Karadeniz şehri"], ["GAZİANTEP", "Baklava ile ünlü şehir"]
  ],
  cleanRandom: [
    ["BİLGİSAYAR", "Teknolojik cihaz"], ["KAHVE", "Sabah kurtarıcısı"],
    ["KİTAP", "Sayfalardan oluşur"], ["TELEFON", "Herkesin elinden düşmeyen cihaz"],
    ["GÜNEŞ", "Gündüz gökyüzünde"], ["DENİZ", "Mavi ve dalgalı"],
    ["ÇİKOLATA", "Tatlı krizinin ilacı"], ["KARPUZ", "Yaz meyvesi"]
  ]
};

function randomRoomCode() {
  let code = "";
  for (let i = 0; i < 10; i++) code += Math.floor(Math.random() * 10);
  return code;
}

function normalizeText(value) {
  return String(value || "").trim().toLocaleUpperCase("tr-TR");
}

function getDifficultySettings(difficulty) {
  if (difficulty === "easy") return { maxWrong: 12, classicTime: 12, fastTotal: 40 };
  if (difficulty === "hard") return { maxWrong: 7, classicTime: 8, fastTotal: 25 };
  return { maxWrong: 10, classicTime: 10, fastTotal: 30 };
}


function roomSettings(room) {
  return {
    mode: room.mode,
    category: room.category,
    difficulty: room.difficulty,
    ...getDifficultySettings(room.difficulty)
  };
}

function pickRandomWord(category) {
  const key = category && WORD_BANK[category] ? category : "cleanRandom";
  const list = WORD_BANK[key];
  const [word, hint] = list[Math.floor(Math.random() * list.length)];
  return { word, hint, nick: "Sistem" };
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
  const ids = players.map((p) => p.id).filter((id) => submissions[id]);
  let shuffled = shuffle(ids);
  let safe = false;
  let tries = 0;

  while (!safe && tries < 100 && ids.length > 1) {
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

  if (!safe && ids.length > 1) shuffled = [...ids.slice(1), ids[0]];

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
      maxPlayers: MAX_PLAYERS,
      mode: room.mode,
      category: room.category,
      difficulty: room.difficulty
    }));
}

function broadcastOpenRooms() {
  io.emit("openRooms", getOpenRooms());
}

function startRoundForRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.gameStarted) return;

  const submittedCount = Object.keys(room.submissions).length;
  const needsManual = room.category === "manual";
  const host = room.players.find((p) => p.host);

  if (needsManual && room.mode === "battle") {
    if (!host || !room.submissions[host.id]) return;
    const sub = room.submissions[host.id];
    const settings = getDifficultySettings(room.difficulty);
    room.roundSolved = false;
    room.transitioning = false;
    room.players.forEach((p) => {
      io.to(p.id).emit("startRound", {
        ownerId: host.id,
        word: sub.word,
        hint: sub.hint,
        ownerNick: sub.nick,
        players: room.players,
        round: room.currentRound,
        totalRounds: TOTAL_ROUNDS,
        mode: room.mode,
        category: room.category,
        difficulty: room.difficulty,
        settings
      });
    });
    return;
  }

  if (needsManual && submittedCount !== room.players.length) return;

  const settings = getDifficultySettings(room.difficulty);
  room.roundSolved = false;

  if (!needsManual) {
    const wordPack = pickRandomWord(room.category);
    const ownerId = "system";
    room.players.forEach((p) => {
      io.to(p.id).emit("startRound", {
        ownerId,
        ...wordPack,
        ownerNick: "Sistem",
        players: room.players,
        round: room.currentRound,
        totalRounds: TOTAL_ROUNDS,
        mode: room.mode,
        category: room.category,
        difficulty: room.difficulty,
        settings
      });
    });
    return;
  }

  const assignments = assignWords(room.players, room.submissions);
  room.players.forEach((p) => {
    io.to(p.id).emit("startRound", {
      ...assignments[p.id],
      players: room.players,
      round: room.currentRound,
      totalRounds: TOTAL_ROUNDS,
      mode: room.mode,
      category: room.category,
      difficulty: room.difficulty,
      settings
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
  room.roundFinished = new Set();
  room.submissions = {};
  room.pendingRequests = [];
  room.players = room.players.map((p) => ({ ...p, ready: false }));
  broadcastOpenRooms();
}

function goNextRoundOrFinish(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  if (room.currentRound >= TOTAL_ROUNDS) {
    finishGame(roomCode);
    return;
  }
  room.currentRound += 1;
  room.roundFinished = new Set();
  room.submissions = {};
  room.roundSolved = false;
  room.transitioning = false;
  io.to(roomCode).emit("showWordScreen", {
    round: room.currentRound,
    totalRounds: TOTAL_ROUNDS,
    mode: room.mode,
    category: room.category,
    difficulty: room.difficulty,
    hostId: room.players.find((p) => p.host)?.id
  });
}

io.on("connection", (socket) => {
  socket.emit("openRooms", getOpenRooms());

  socket.on("getOpenRooms", () => socket.emit("openRooms", getOpenRooms()));

  socket.on("createRoom", ({ nick, mode = "classic", category = "manual", difficulty = "medium" }) => {
    let roomCode;
    do { roomCode = randomRoomCode(); } while (rooms[roomCode]);

    rooms[roomCode] = {
      players: [{ id: socket.id, nick, ready: false, host: true, score: 0, combo: 0 }],
      gameStarted: false,
      submissions: {},
      currentRound: 1,
      roundFinished: new Set(),
      pendingRequests: [],
      mode,
      category,
      difficulty,
      roundSolved: false
    };

    socket.join(roomCode);
    socket.emit("roomCreated", { roomCode, players: rooms[roomCode].players, settings: roomSettings(rooms[roomCode]) });
    broadcastOpenRooms();
  });

  socket.on("requestJoinRoom", ({ roomCode, nick }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit("joinRejected", { message: "Oda bulunamadı" });
    if (room.gameStarted) return socket.emit("joinRejected", { message: "Oyun başlamış knk" });
    if (room.players.length >= MAX_PLAYERS) return socket.emit("joinRejected", { message: "Oda dolu" });
    if (room.players.some((p) => p.id === socket.id)) return socket.emit("joinRejected", { message: "Zaten odadasın knk" });
    if (room.pendingRequests.some((r) => r.socketId === socket.id)) return socket.emit("joinRejected", { message: "Zaten katılma talebi gönderdin" });

    room.pendingRequests.push({ socketId: socket.id, nick });
    const host = room.players.find((p) => p.host);
    if (host) io.to(host.id).emit("joinRequestReceived", { roomCode, socketId: socket.id, nick });
    socket.emit("joinRequestSent", { roomCode, message: "Katılma talebin gönderildi" });
  });

  socket.on("acceptJoinRequest", ({ roomCode, socketId }) => {
    const room = rooms[roomCode];
    if (!room || room.gameStarted) return;
    const host = room.players.find((p) => p.id === socket.id && p.host);
    if (!host) return;
    const requestIndex = room.pendingRequests.findIndex((r) => r.socketId === socketId);
    if (requestIndex === -1) return;
    if (room.players.length >= MAX_PLAYERS) {
      io.to(socketId).emit("joinRejected", { message: "Oda doldu knk" });
      room.pendingRequests.splice(requestIndex, 1);
      return;
    }
    const request = room.pendingRequests.splice(requestIndex, 1)[0];
    room.players.push({ id: request.socketId, nick: request.nick, ready: false, host: false, score: 0, combo: 0 });
    io.sockets.sockets.get(request.socketId)?.join(roomCode);
    io.to(request.socketId).emit("joinAccepted", { roomCode, players: room.players, settings: roomSettings(room) });
    io.to(roomCode).emit("roomUpdated", { players: room.players, settings: roomSettings(room) });
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
    io.to(socketId).emit("joinRejected", { message: "Katılma talebiniz reddedildi" });
  });

  socket.on("toggleReady", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.gameStarted) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    player.ready = !player.ready;
    io.to(roomCode).emit("roomUpdated", { players: room.players, settings: roomSettings(room) });
  });

  socket.on("startGame", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.host) return;
    const allReady = room.players.length >= 2 && room.players.every((p) => p.ready);
    if (!allReady) return socket.emit("errorMessage", "Herkes hazır değil knk");

    room.gameStarted = true;
    room.currentRound = 1;
    room.roundFinished = new Set();
    room.submissions = {};
    room.pendingRequests = [];
    room.roundSolved = false;
    room.players.forEach((p) => { p.score = 0; p.combo = 0; });

    io.to(roomCode).emit("showWordScreen", {
      round: room.currentRound,
      totalRounds: TOTAL_ROUNDS,
      mode: room.mode,
      category: room.category,
      difficulty: room.difficulty,
      hostId: room.players.find((p) => p.host)?.id
    });
    broadcastOpenRooms();
  });

  socket.on("submitWord", ({ roomCode, word, hint }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    room.submissions[socket.id] = { nick: player.nick, word: normalizeText(word), hint: String(hint || "").trim() };
    const needed = room.mode === "battle" && room.category === "manual" ? 1 : room.players.length;
    const submittedCount = Object.keys(room.submissions).length;
    io.to(roomCode).emit("submissionUpdate", { submittedCount, totalPlayers: needed });
    if (submittedCount >= needed) startRoundForRoom(roomCode);
  });

  socket.on("startRandomRound", ({ roomCode }) => startRoundForRoom(roomCode));

  socket.on("correctGuess", ({ roomCode, playerId, timeLeft = 0 }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return;
    player.combo = (player.combo || 0) + 1;
    const comboBonus = player.combo >= 3 ? 10 : player.combo >= 2 ? 5 : 0;
    player.score += 10 + comboBonus + Math.max(0, Math.floor(Number(timeLeft) || 0));
    io.to(roomCode).emit("scoresUpdated", room.players);
  });

  socket.on("wrongGuess", ({ roomCode, ownerId, guesserId }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const guesser = room.players.find((p) => p.id === guesserId);
    const owner = room.players.find((p) => p.id === ownerId);
    if (guesser) {
      guesser.combo = 0;
      guesser.score -= 5;
    }
    if (owner && owner.id !== guesserId) owner.score += 5;
    io.to(roomCode).emit("scoresUpdated", room.players);
  });

  socket.on("wordSolved", ({ roomCode, ownerId, guesserId, timeLeft = 0 }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const guesser = room.players.find((p) => p.id === guesserId);
    const owner = room.players.find((p) => p.id === ownerId);
    if (guesser) guesser.score += 50 + Math.max(0, Math.floor(Number(timeLeft) || 0) * 2);
    if (owner && owner.id !== guesserId) owner.score += 20;

    if (room.mode === "battle" && !room.roundSolved && guesser) {
      room.roundSolved = true;
      guesser.score += 100;
      io.to(roomCode).emit("battleWinner", { winnerId: guesser.id, winnerNick: guesser.nick, players: room.players });
      io.to(roomCode).emit("scoresUpdated", room.players);
      if (!room.transitioning) {
        room.transitioning = true;
        setTimeout(() => goNextRoundOrFinish(roomCode), 2200);
      }
      return;
    }
    io.to(roomCode).emit("scoresUpdated", room.players);
  });

  socket.on("roundFinished", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.transitioning) return;
    room.roundFinished.add(socket.id);
    if (room.roundFinished.size >= room.players.length) {
      room.transitioning = true;
      setTimeout(() => goNextRoundOrFinish(roomCode), 700);
    }
  });

  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const before = room.players.length;
      room.players = room.players.filter((p) => p.id !== socket.id);
      room.pendingRequests = room.pendingRequests.filter((r) => r.socketId !== socket.id);
      delete room.submissions[socket.id];
      if (room.roundFinished) room.roundFinished.delete(socket.id);
      if (room.players.length !== before) {
        if (room.players.length === 0) delete rooms[roomCode];
        else {
          if (!room.players.some((p) => p.host)) room.players[0].host = true;
          io.to(roomCode).emit("roomUpdated", { players: room.players, settings: roomSettings(room) });
        }
        broadcastOpenRooms();
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Sunucu çalışıyor: " + PORT));

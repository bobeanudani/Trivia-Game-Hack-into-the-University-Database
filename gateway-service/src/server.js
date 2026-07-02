const express = require("express");
const cors = require("cors");
const { generatePlaylist, checkAnswerInPlaylist } = require("./gameLogic");

const app = express(); 

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

const { createClient } = require("redis");
const redisClient = createClient({
  url: "redis://redis:6379",
  socket: {
    reconnectStrategy: (retries) => {
      console.log(`🔄 Redis connection lost. Retry attempt: ${retries}`);
      return Math.min(retries * 100, 3000);
    }
  }
});

async function connectRedis() {
  try {
    await redisClient.connect();
    console.log("🟢 Connected securely to Redis Session Layer");
  } catch (err) {
    console.error("❌ Redis initial connection failed. Retrying in 5s...", err);
    setTimeout(connectRedis, 5000);
  }
}
connectRedis();

// -------------------- ROOM CODE GENERATOR --------------------

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // fără I, O, 0, 1 ca să nu confunde
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// -------------------- UTILS & DATABASE LAYER --------------------

function sessionKey(roomCode) {
  return `room:${roomCode}:session`;
}

function userLevelKey(roomCode, username) {
  return `room:${roomCode}:user_level:${username}`;
}

function userPlaylistKey(roomCode, username) {
  return `room:${roomCode}:user_playlist:${username}`;
}

async function getSession(roomCode) {
  try {
    const sessionData = await redisClient.get(sessionKey(roomCode));
    if (!sessionData) {
      return null;
    }
    return JSON.parse(sessionData);
  } catch (e) {
    console.error("Error reading session:", e);
    return null;
  }
}

function defaultSession() {
  return {
    status: "LOBBY",
    host: null,
    players: {},
    startedAt: null,
    duration: 180,
    timeLeft: 180,
    finishedPlayers: [],
    sabotagedBy: null,
    resetCountdown: null
  };
}

async function saveSession(roomCode, session) {
  await redisClient.set(sessionKey(roomCode), JSON.stringify(session));
}

async function nukeRoom(roomCode) {
  // Ștergem toate cheile din camera asta
  const keys = await redisClient.keys(`room:${roomCode}:*`);
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
  console.log(`🔥 Room ${roomCode} fully nuked from Redis.`);
}

async function triggerAutoResetCountdown(roomCode, gameSession) {
  if (gameSession.resetCountdown !== null && gameSession.resetCountdown > 0) return;

  console.log(`🏁 [${roomCode}] GAME OVER: Starting 15-second auto-reset countdown...`);
  gameSession.resetCountdown = 15;
  gameSession.status = "ENDED";
  await saveSession(roomCode, gameSession);

  let localCounter = 15;

  const resetInterval = setInterval(async () => {
    localCounter -= 1;

    if (localCounter > 0) {
      const session = await getSession(roomCode);
      if (!session) { clearInterval(resetInterval); return; }
      session.resetCountdown = localCounter;
      session.status = "ENDED";
      await saveSession(roomCode, session);
      console.log(`[${roomCode}] Resetting in: ${localCounter}s`);
    } else {
      clearInterval(resetInterval);
      console.log(`🔥 [${roomCode}] FLUSHING ROOM`);
      await nukeRoom(roomCode);
    }
  }, 1000);
}

async function pruneDeadPlayers(roomCode, gameSession) {
  if (!gameSession.players || Object.keys(gameSession.players).length === 0) return false;

  const now = Date.now();
  const timeoutLimit = 6000;
  let stateChanged = false;
  let hostDropped = false;

  for (const username in gameSession.players) {
    const lastSeen = gameSession.players[username].lastSeen || 0;

    if (now - lastSeen > timeoutLimit) {
      console.log(`📡 [${roomCode}] Player '${username}' timed out.`);
      delete gameSession.players[username];
      await redisClient.del(userLevelKey(roomCode, username));
      await redisClient.del(userPlaylistKey(roomCode, username));
      stateChanged = true;

      if (gameSession.host === username) {
        hostDropped = true;
      }
    }
  }

  if (hostDropped) {
    const remainingPlayers = Object.keys(gameSession.players);
    gameSession.host = remainingPlayers.length > 0 ? remainingPlayers[0] : null;
    stateChanged = true;
  }

  return stateChanged;
}

// -------------------- BACKGROUND CRON WORKER --------------------

setInterval(async () => {
  if (!redisClient.isOpen) return;

  try {
    // Găsim toate sesiunile active
    const roomKeys = await redisClient.keys("room:*:session");

    for (const key of roomKeys) {
      const roomCode = key.split(":")[1];
      const gameSession = await getSession(roomCode);
      if (!gameSession) continue;

      if (gameSession.status === "LOBBY" || gameSession.status === "PLAYING") {
        const now = Date.now();
        const timeoutLimit = 6000;
        let stateChanged = false;

        for (const username in gameSession.players) {
          const lastSeen = gameSession.players[username].lastSeen || 0;
          if (now - lastSeen > timeoutLimit) {
            console.log(`📡 [CRON][${roomCode}] Player '${username}' timed out.`);
            delete gameSession.players[username];
            await redisClient.del(userLevelKey(roomCode, username));
            await redisClient.del(userPlaylistKey(roomCode, username));
            stateChanged = true;

            if (gameSession.host === username) {
              const remaining = Object.keys(gameSession.players);
              gameSession.host = remaining.length > 0 ? remaining[0] : null;
            }
          }
        }

        const activePlayersCount = Object.keys(gameSession.players).length;

        if (activePlayersCount === 0 && gameSession.host !== null) {
          console.log(`🚨 [CRON][${roomCode}] 0 players left. Nuking room.`);
          await nukeRoom(roomCode);
          continue;
        }

        if (stateChanged) {
          await saveSession(roomCode, gameSession);
        }
      }
    }
  } catch (cronErr) {
    console.error("Error in Background Cron execution:", cronErr);
  }
}, 3000);

// -------------------- ROUTES --------------------

app.get("/health", (req, res) => {
  if (!redisClient.isOpen) {
    return res.status(503).json({ status: "error", message: "Redis layer initializing..." });
  }
  res.json({ status: "ok" });
});

// Creează o cameră nouă și returnează codul
app.post("/create", async (req, res) => {
  const { user } = req.body;
  if (!user) return res.status(400).json({ error: "Username required" });

  // Generăm un cod unic (retry dacă există deja)
  let roomCode;
  let attempts = 0;
  do {
    roomCode = generateRoomCode();
    const existing = await getSession(roomCode);
    if (!existing) break;
    attempts++;
  } while (attempts < 10);

  const session = defaultSession();
  session.host = user;
  session.players[user] = { level: 1, lastSeen: Date.now() };

  await saveSession(roomCode, session);

  const playerPlaylist = generatePlaylist();
  await redisClient.set(userPlaylistKey(roomCode, user), JSON.stringify(playerPlaylist));

  console.log(`🏠 Room ${roomCode} created by ${user}`);

  res.json({ ok: true, roomCode, isHost: true });
});

app.post("/join", async (req, res) => {
  const { user, roomCode } = req.body;
  if (!user) return res.status(400).json({ error: "Username required" });
  if (!roomCode) return res.status(400).json({ error: "Room code required" });

  const code = roomCode.toUpperCase().trim();
  let gameSession = await getSession(code);

  if (!gameSession) {
    return res.status(404).json({ error: `Room '${code}' not found.` });
  }

  if (gameSession.status !== "LOBBY") {
    return res.status(400).json({ error: "Game has already started or ended" });
  }

  await pruneDeadPlayers(code, gameSession);

  if (gameSession.players && gameSession.players[user]) {
    return res.status(400).json({ error: `Alias '${user}' is actively occupied.` });
  }

  gameSession.players[user] = { level: 1, lastSeen: Date.now() };
  await redisClient.del(userLevelKey(code, user));
  await saveSession(code, gameSession);

  const playerPlaylist = generatePlaylist();
  await redisClient.set(userPlaylistKey(code, user), JSON.stringify(playerPlaylist));

  res.json({ ok: true, roomCode: code, isHost: false });
});

app.post("/start", async (req, res) => {
  const { user, roomCode } = req.body;
  const code = roomCode?.toUpperCase().trim();
  const gameSession = await getSession(code);

  if (!gameSession) return res.status(404).json({ error: "Room not found" });
  if (user !== gameSession.host) return res.status(403).json({ error: "Only the host can start the game!" });
  if (gameSession.status !== "LOBBY") return res.status(400).json({ error: "Game is not in lobby state" });

  gameSession.status = "PLAYING";
  gameSession.startedAt = Date.now();
  await saveSession(code, gameSession);

  res.json({ success: true });
});

app.get("/game/:roomCode/:user", async (req, res) => {
  const { roomCode, user } = req.params;
  const code = roomCode.toUpperCase();

  let level = await redisClient.get(userLevelKey(code, user));
  if (!level) {
    level = 1;
    await redisClient.set(userLevelKey(code, user), level);
  }
  level = Number(level);

  const playlistData = await redisClient.get(userPlaylistKey(code, user));
  if (!playlistData) {
    return res.status(400).json({ error: "Playlist missing. Re-login required." });
  }
  const playlist = JSON.parse(playlistData);
  const questionData = playlist[level - 1];

  if (!questionData) {
    return res.json({ user, level, question: { title: "ERROR", text: "SYSTEM CORRUPTION DETECTED" } });
  }

  let finalizedText = questionData.question.text;
  if (level === 7) {
    finalizedText = `To run the SQL and update your grade to 10 type 'ilovesabd': \n\n UPDATE grades SET grade = 10 \n WHERE student_id = (SELECT id FROM students WHERE name = '${user}') \n AND course_id = (SELECT id FROM courses WHERE name = 'Sisteme avansate de baze de date');`;
  }

  res.json({ user, level, question: { title: questionData.question.title, text: finalizedText } });
});

app.get("/state/:roomCode", async (req, res) => {
  const code = req.params.roomCode.toUpperCase();
  const pingingUser = req.query.user;
  const now = Date.now();

  let gameSession = await getSession(code);
  if (!gameSession) {
    return res.status(404).json({ error: "Room not found" });
  }

  if (pingingUser && gameSession.players && gameSession.players[pingingUser]) {
    gameSession.players[pingingUser].lastSeen = now;
    await saveSession(code, gameSession);
  }

  if (gameSession.status === "LOBBY" || gameSession.status === "PLAYING") {
    const didPrune = await pruneDeadPlayers(code, gameSession);
    if (didPrune) await saveSession(code, gameSession);
  }

  const activePlayersCount = gameSession.players ? Object.keys(gameSession.players).length : 0;

  if (gameSession.status === "PLAYING" && activePlayersCount === 0) {
    await nukeRoom(code);
    return res.json({ status: "LOBBY", host: null, players: [], timeLeft: 180, finishedPlayers: [], sabotagedBy: null, resetCountdown: null });
  }

  if (gameSession.status === "PLAYING" && gameSession.startedAt) {
    const elapsed = Math.floor((now - gameSession.startedAt) / 1000);
    gameSession.timeLeft = Math.max(0, gameSession.duration - elapsed);

    if (gameSession.timeLeft <= 0) {
      gameSession.status = "ENDED";
      await saveSession(code, gameSession);
      await triggerAutoResetCountdown(code, gameSession);
    }
  }

  if (pingingUser && gameSession.host === pingingUser) {
  }

  const playerList = gameSession.players ? Object.keys(gameSession.players) : [];

  res.json({
    status: gameSession.status,
    host: gameSession.host,
    players: playerList,
    timeLeft: gameSession.timeLeft,
    finishedPlayers: gameSession.finishedPlayers,
    sabotagedBy: gameSession.sabotagedBy,
    resetCountdown: gameSession.resetCountdown
  });
});

app.post("/submit", async (req, res) => {
  const { user, answer, roomCode } = req.body;
  if (!user || !answer || !roomCode) return res.status(400).json({ error: "user, answer and roomCode required" });

  const code = roomCode.toUpperCase();
  let level = await redisClient.get(userLevelKey(code, user));
  if (!level) {
    level = 1;
    await redisClient.set(userLevelKey(code, user), level);
  }
  level = parseInt(level);
  const totalLevels = 7;

  if (level > totalLevels) {
    return res.json({ success: true, message: "You have already completed the game!", finished: true });
  }

  const playlistData = await redisClient.get(userPlaylistKey(code, user));
  const playlist = JSON.parse(playlistData);

  const correct = checkAnswerInPlaylist(playlist, level, answer);
  if (!correct) {
    return res.json({ success: false, message: "Wrong answer. Try again.", level });
  }

  const gameSession = await getSession(code);

  if (level === totalLevels) {
    const alreadyFinished = gameSession.finishedPlayers.some(p => p.name === user);

    if (!alreadyFinished && gameSession.startedAt) {
      const secondsTaken = Math.floor((Date.now() - gameSession.startedAt) / 1000);
      gameSession.finishedPlayers.push({ name: user, timeTook: `${secondsTaken}s` });

      const totalPlayersJoined = Object.keys(gameSession.players).length;
      if (gameSession.finishedPlayers.length === totalPlayersJoined) {
        gameSession.status = "ENDED";
        await triggerAutoResetCountdown(code, gameSession);
      }

      await saveSession(code, gameSession);
    }

    return res.json({ success: true, message: "🎉 ACCESS GRANTED: Grade changed to 9!", finished: true, level });
  }

  const nextLevel = level + 1;
  await redisClient.set(userLevelKey(code, user), nextLevel);

  const nextQuestionData = playlist[nextLevel - 1];
  let nextText = nextQuestionData.question.text;
  if (nextLevel === 7) {
    nextText = `To run the SQL and update your grade to 10 type 'ilovesabd': \n\n UPDATE grades SET grade = 10 \n WHERE student_id = (SELECT id FROM students WHERE name = '${user}') \n AND course_id = (SELECT id FROM courses WHERE name = 'Sisteme avansate de baze de date');`;
  }

  return res.json({
    success: true,
    message: "Correct! Moving to next level...",
    nextLevel,
    question: { title: nextQuestionData.question.title, text: nextText }
  });
});

app.post("/sabotage", async (req, res) => {
  const { user, roomCode } = req.body;
  const code = roomCode?.toUpperCase();
  const gameSession = await getSession(code);

  if (!gameSession || gameSession.status === "ENDED") {
    return res.json({ message: "Game already ended" });
  }

  gameSession.status = "ENDED";
  gameSession.sabotagedBy = user;
  await saveSession(code, gameSession);
  await triggerAutoResetCountdown(code, gameSession);

  return res.json({ message: `💀 ${user} triggered SYSTEM COMPROMISE` });
});

app.post("/leave", async (req, res) => {
  const { user, roomCode } = req.body;
  if (!user || !roomCode) return res.sendStatus(400);

  const code = roomCode.toUpperCase();
  let gameSession = await getSession(code);
  if (!gameSession) return res.json({ ok: true });

  if (gameSession.players && gameSession.players[user]) {
    console.log(`🚪 [${code}] Player '${user}' left.`);
    delete gameSession.players[user];
    await redisClient.del(userLevelKey(code, user));
    await redisClient.del(userPlaylistKey(code, user));

    if (gameSession.host === user) {
      const remaining = Object.keys(gameSession.players);
      gameSession.host = remaining.length > 0 ? remaining[0] : null;
    }

    const remainingCount = Object.keys(gameSession.players).length;
    if (remainingCount === 0) {
      console.log(`🔥 [${code}] Last player left. Nuking room.`);
      await nukeRoom(code);
      return res.json({ ok: true });
    }

    await saveSession(code, gameSession);
  }
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Gateway service running on port ${PORT}`);
});
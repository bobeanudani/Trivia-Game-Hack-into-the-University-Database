const BASE_URL = "";

let bootDone = false;
let user = "";
let roomCode = "";
let state = "LOGIN";
let announcedPlayers = []; 
let gameFinished = false; 
let isHost = false;
let hasStartedGameLocal = false;
let leaderboardPrinted = false;
let audioCtx = null;
let roomMenuStep = "CHOOSE";
let pendingUsername = "";

const terminal = document.getElementById("terminal");
const input = document.getElementById("cmdInput");

const statusEl = document.getElementById("status");
const userEl = document.getElementById("user");
const playersEl = document.getElementById("players");
const timerEl = document.getElementById("timer");

// -------------------- PRINT --------------------
function print(text, type = "normal") {
  const div = document.createElement("div");
  
  if (type === "ascii") {
    div.classList.add("ascii-art");
    div.textContent = text;
  } else {
    div.innerText = text === "" ? "\u00A0" : text; 
  }

  if (type === "success") div.style.color = "#00ff88";
  if (type === "error") div.style.color = "#ff4d4d";
  if (type === "system") div.style.color = "#66ccff";

  if (type === "system") {
    div.style.letterSpacing = "1px";
  }

  terminal.appendChild(div);

  const mobileSafetyBuffer = 80; 
  window.scrollTo({ top: document.documentElement.scrollHeight + mobileSafetyBuffer, behavior: "instant" });
  terminal.scrollTop = terminal.scrollHeight + mobileSafetyBuffer;
}

// -------------------- RETRO BOOT SEQUENCE --------------------
const BOOT_LOGS = [
  "INITIALIZING VECTOR NETWORK PROTOCOLS...",
  "LOADING KUBERNETES GATEWAY POD CONFIGURATION...",
  "CONNECTING TO REDIS ENGINE AT CLUSTERIP:6379...",
  "ESTABLISHING SECURE NGROK TUNNEL LINK...",
  "WARNING: UNAUTHORIZED ACCESS DETECTED...",
  "[OK] Network sync complete",
  "[OK] All pods reachable",
  "SYSTEM STATUS: READY TO OVERRIDE.",
  "RACE SYSTEM TO CHANGING THE GRADE FOR SABD INITIALIZED",
];

function triggerBootSequence() {
  let delay = 200;
  
  print("███████╗███╗   ███╗██╗    ██████╗  ██████╗  ██████╗ ████████╗", "ascii");
  print("██╔════╝████╗ ████║██║    ██╔══██╗██╔═══██╗██╔═══██╗╚══██╔══╝", "ascii");
  print("█████╗  ██╔████╔██║██║    ██████╔╝██║   ██║██║   ██║   ██║   ", "ascii");
  print("██╔══╝  ██║╚██╔╝██║██║    ██╔══██╗██║   ██║██║   ██║   ██║   ", "ascii");
  print("██║     ██║ ╚═╝ ██║██║    ██║  ██║╚██████╔╝╚██████╔╝   ██║   ", "ascii");
  print("╚═╝     ╚═╝     ╚═╝╚═╝    ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ", "ascii");
  print("-------------------------------------------------------------", "ascii");

  BOOT_LOGS.forEach((log, index) => {
    setTimeout(() => {
      let logType = log.includes("WARNING") ? "error" : "system";
      print(`[SYS_DIAG_${index + 1}] ${log}`, logType);
      if (index === BOOT_LOGS.length - 1) {
        bootDone = true;
      }
    }, delay);
    delay += 400; 
  });
}

window.onload = triggerBootSequence;

// -------------------- CHECK STATUS --------------------
function setNetworkStatus(connected) {
  const led = document.getElementById("statusLed");
  if (!led) return;
  if (connected) {
    led.classList.remove("disconnected");
  } else {
    led.classList.add("disconnected");
  }
}

// -------------------- INPUT LISTENER --------------------
input.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;

  const cmd = input.value.trim();
  input.value = "";

  print("> " + cmd);

  if (!bootDone) {
    print("SYSTEM STILL INITIALIZING...", "error");
    return;
  }

  if (cmd.toLowerCase() === "sudo self-destruct") {
    print("CRITICAL EXCEPTION! INITIATING SYSTEM PURGE...", "error");
    print("FATAL ERROR: CORE SEGMENTATION FAULT IN K8S PODS.", "error");
    print("ALL CONNECTED DATA DESTROYED. TERMINAL LOCKED.", "error");
    
    input.disabled = true;
    input.placeholder = "SYSTEM KILLED.";

    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sawtooth"; 
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc.frequency.linearRampToValueAtTime(110, audioCtx.currentTime + 2);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 3);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + 3);
    } catch(ae) {}

    document.body.style.transition = "transform 1.5s ease-in-out, filter 1.5s";
    document.body.style.transform = "rotate(180deg)";
    document.body.style.filter = "invert(1) hue-rotate(180deg) contrast(1.5)"; 
    setNetworkStatus(false);
    statusEl.innerText = "STATUS: KILLED";
    return;
  }

  // -------------------- ROOM MENU FLOW --------------------
  if (state === "LOGIN") {
    await handleLoginFlow(cmd);
    return;
  }

  if (state === "LOBBY") {
    if (isHost && cmd.toLowerCase() === "start") {
      await startGame();
    } else {
      print("WAITING FOR HOST TO START...", "system");
    }
    return;
  }

  if (state === "ENDED") {
    print("SESSION TERMINATED. CODES LOCKED.", "error");
    return;
  }

  if (cmd.toLowerCase() === "sabotage") {
    await sabotage();
    return;
  }

  await handleCommand(cmd);
});

// -------------------- LOGIN FLOW (multi-step) --------------------
async function handleLoginFlow(cmd) {
  if (roomMenuStep === "CHOOSE") {
    if (cmd === "1") {
      roomMenuStep = "ENTER_NAME_CREATE";
      print("");
      print("Enter your hacker alias:", "system");
    } else if (cmd === "2") {
      roomMenuStep = "ENTER_NAME_JOIN";
      print("");
      print("Enter your hacker alias:", "system");
    } else {
      print("Invalid option. Type 1 to CREATE or 2 to JOIN.", "error");
    }
    return;
  }

  if (roomMenuStep === "ENTER_NAME_CREATE") {
    if (!cmd) { print("INVALID ALIAS", "error"); return; }
    pendingUsername = cmd.trim();
    await createRoom(pendingUsername);
    return;
  }

  if (roomMenuStep === "ENTER_NAME_JOIN") {
    if (!cmd) { print("INVALID ALIAS", "error"); return; }
    pendingUsername = cmd.trim();
    roomMenuStep = "ENTER_CODE";
    print("");
    print("Enter the ROOM CODE:", "system");
    return;
  }

  if (roomMenuStep === "ENTER_CODE") {
    if (!cmd) { print("INVALID CODE", "error"); return; }
    await joinRoom(pendingUsername, cmd.trim().toUpperCase());
    return;
  }
}

// -------------------- CLICKABLE ROOM CODE --------------------
function printClickableCode(code) {
  const div = document.createElement("div");
  div.classList.add("ascii-art");
  div.style.cursor = "pointer";
  div.style.userSelect = "none";

  const codeSpan = document.createElement("span");
  codeSpan.textContent = `  ROOM CODE:  ${code}`;

  const hintSpan = document.createElement("span");
  hintSpan.textContent = "  [click to copy]";
  hintSpan.style.opacity = "0.5";
  hintSpan.style.fontSize = "0.85em";

  div.appendChild(codeSpan);
  div.appendChild(hintSpan);

  div.addEventListener("click", () => {
    function onCopied() {
      hintSpan.textContent = "  [copied!]";
      hintSpan.style.color = "#00ff88";
      hintSpan.style.opacity = "1";
      setTimeout(() => {
        hintSpan.textContent = "  [click to copy]";
        hintSpan.style.color = "";
        hintSpan.style.opacity = "0.5";
      }, 2000);
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(code).then(onCopied).catch(() => fallbackCopy());
    } else {
      fallbackCopy();
    }

    function fallbackCopy() {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        onCopied();
      } catch (e) {
        hintSpan.textContent = "  [copy failed — select manually]";
        hintSpan.style.color = "#ff4d4d";
        hintSpan.style.opacity = "1";
      }
      document.body.removeChild(ta);
    }
  });

  terminal.appendChild(div);
  window.scrollTo({ top: document.documentElement.scrollHeight + 80, behavior: "instant" });
}

// -------------------- CREATE ROOM --------------------
async function createRoom(name) {
  statusEl.innerText = "STATUS: CREATING ROOM...";
  try {
    const res = await fetch(`${BASE_URL}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: name })
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      print(`[ERROR]: ${data.error || "Failed to create room."}`, "error");
      roomMenuStep = "CHOOSE";
      printRoomMenu();
      return;
    }

    user = name;
    roomCode = data.roomCode;
    isHost = true;
    state = "LOBBY";

    statusEl.innerText = "STATUS: IN LOBBY";
    userEl.innerText = "USER: " + user;

    print("");
    print("================================", "ascii");
    printClickableCode(roomCode);
    print("================================", "ascii");
    print("");
    print("[CONNECTED TO LOBBY]", "success");
    print("👑 YOU ARE THE HOST. Type 'start' when everyone is ready.", "success");

    startStatePolling();
  } catch (err) {
    print("CRITICAL: Gateway connection timeout.", "error");
    statusEl.innerText = "STATUS: OFFLINE";
    setNetworkStatus(false);
    roomMenuStep = "CHOOSE";
    printRoomMenu();
  }
}

// -------------------- JOIN ROOM --------------------
async function joinRoom(name, code) {
  statusEl.innerText = "STATUS: AUTHENTICATING...";
  try {
    const res = await fetch(`${BASE_URL}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: name, roomCode: code })
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      print("");
      print(`[ACCESS DENIED]: ${data.error || "Unable to join session."}`, "error");
      statusEl.innerText = "STATUS: ACCESS DENIED";
      // Resetăm ca să poată reîncerca
      roomMenuStep = "CHOOSE";
      pendingUsername = "";
      print("");
      printRoomMenu();
      return;
    }

    user = name;
    roomCode = data.roomCode;
    isHost = false;
    state = "LOBBY";

    statusEl.innerText = "STATUS: IN LOBBY";
    userEl.innerText = "USER: " + user;

    print("");
    print(`[CONNECTED TO ROOM: ${roomCode}]`, "success");
    print("Waiting for host to initiate terminal launch protocol...", "system");

    startStatePolling();
  } catch (err) {
    print("CRITICAL: Gateway connection timeout.", "error");
    statusEl.innerText = "STATUS: OFFLINE";
    setNetworkStatus(false);
    roomMenuStep = "CHOOSE";
    pendingUsername = "";
    printRoomMenu();
  }
}

function printRoomMenu() {
  print("");
  print("================================", "ascii");
  print("   SELECT OPERATION MODE", "ascii");
  print("   [1] CREATE a new room", "ascii");
  print("   [2] JOIN an existing room", "ascii");
  print("================================", "ascii");
  print("");
}

// Afișăm meniul după ce boot-ul s-a terminat
const originalBoot = window.onload;
window.onload = () => {
  triggerBootSequence();
  // Așteptăm să termine boot-ul înainte să afișăm meniul
  const bootWait = BOOT_LOGS.length * 400 + 400;
  setTimeout(() => {
    printRoomMenu();
  }, bootWait);
};

// -------------------- START GAME --------------------
async function startGame() {
  print("Sending override launch sequence to cluster...", "system");
  await fetch(`${BASE_URL}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, roomCode })
  });
}

// -------------------- LOAD QUESTION --------------------
async function loadQuestion() {
  if (!user) return;

  const res = await fetch(`${BASE_URL}/game/${roomCode}/${user}`);
  const data = await res.json();

  updateUI(data);

  print("");
  print("================================", "system");
  print("LEVEL " + data.level + " - " + data.question.title, "system");
  print("================================", "system");
  print("");
  if (data.question && data.question.text) {
    print(data.question.text);
  } else {
    print("SYSTEM ERROR: Missing question data", "error");
  }
  print("");
}

// -------------------- HANDLE ANSWER --------------------
async function handleCommand(cmd) {
  if (!user) return;

  print("[...] Submitting payload...", "system");

  const res = await fetch(`${BASE_URL}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, answer: cmd, roomCode })
  });

  const data = await res.json();

  if (!data.success) {
    print(data.message, "error");
    return;
  }

  print(data.message, "success");
  
  if (data.finished) {
    gameFinished = true;
    print("\nYou completed the course! Hold tight for the final scoreboard or type 'sabotage' to close it out for everyone else.", "system");
    return;
  }

  await loadQuestion();
}

// -------------------- SABOTAGE --------------------
async function sabotage() {
  const res = await fetch(`${BASE_URL}/sabotage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, roomCode })
  });

  const data = await res.json();

  print("");
  print(data.message, "error");
  print("SESSION TERMINATED", "error");
  gameFinished = true;
  state = "ENDED";
  input.disabled = true;
}

// -------------------- STATE POLLING --------------------
function startStatePolling() {
  const stateInterval = setInterval(async () => {
    if (state === "ENDED" && leaderboardPrinted) {
      clearInterval(stateInterval);
      return;
    }

    try {
      const res = await fetch(`${BASE_URL}/state/${roomCode}?user=${encodeURIComponent(user)}`);
      
      if (res.status === 404) {
        // Camera a fost ștearsă (toți au plecat, etc.)
        if (state !== "ENDED") {
          clearInterval(stateInterval);
          state = "ENDED";
          input.disabled = true;
          print("\n[!] ROOM TERMINATED. TERMINAL SESSION CLOSED.", "error");
          statusEl.innerText = "STATUS: TERMINATED";
          setNetworkStatus(false);
        }
        return;
      }

      const serverState = await res.json();
      setNetworkStatus(true);

      if (serverState.host === user) {
        if (!isHost) { 
          isHost = true;
          print("");
          print("⚡ HOST MIGRATION COMPLETE", "system");
          print("👑 THE ORIGINAL HOST DISCONNECTED. YOU ARE NOW THE NEW HOST!", "success");
          print("Type 'start' when everyone is ready to deploy.", "success");
          print("");
        }
      } else {
        isHost = false;
      }

      handleStateUpdate(serverState);
    } catch (err) {
      console.error("Error fetching match state:", err);
      setNetworkStatus(false);
    }
  }, 2000); 
}

// -------------------- SABOTAGE & MULTI-WIN PROCESSING --------------------
function handleStateUpdate(serverState) {
  if (bootDone && (!serverState.players || serverState.players.length === 0)) {
    if (state !== "ENDED") {
      gameFinished = true;
      state = "ENDED";
      input.disabled = true;
      input.placeholder = "SESSION ABANDONED.";
      print("\n[!] ALL PLAYERS DISCONNECTED. TERMINAL SESSION TERMINATED.", "error");
      statusEl.innerText = "STATUS: ABANDONED";
      setNetworkStatus(false);
      return;
    }
  }

  if (serverState.players && serverState.players.length > 0) {
    playersEl.innerText = "PLAYERS: " + serverState.players.join(", ");
  } else {
    playersEl.innerText = "PLAYERS: --";
  }

  if (serverState.status === "PLAYING" && !hasStartedGameLocal) {
    hasStartedGameLocal = true;
    state = "PLAYING";
    print("");
    print("🚀 THE RACE HAS BEGUN! FETCHING DECRYPT KEYS...", "success");
    loadQuestion(); 
  }

  if (serverState.status === "PLAYING") {
    timerEl.innerText = "TIME: " + serverState.timeLeft + "s";
  }

  if (serverState.status === "ENDED" && !gameFinished && !serverState.sabotagedBy) {
    gameFinished = true;
    state = "ENDED";
    print("\n[!] TIME UP -- SYSTEM LOCKED \n YOUR GRADE WAS CHANGED TO: 4", "error");
    input.disabled = true;
  }

  if (serverState.sabotagedBy && state !== "ENDED") {
    gameFinished = true;
    state = "ENDED";
    print("");
    print(`💀 SYSTEM COMPROMISED BY ${serverState.sabotagedBy}`, "error");
    print("ALL PLAYERS WHO DIDN'T FINISH LOST", "error");
    input.disabled = true;
  }

  if (serverState.finishedPlayers && serverState.finishedPlayers.length > 0) {
    serverState.finishedPlayers.forEach(playerObj => {
      if (!announcedPlayers.includes(playerObj.name)) {
        announcedPlayers.push(playerObj.name); 
        print("");
        print(`🏆 ${playerObj.name} successfully changed their grade in ${playerObj.timeTook}!`, "success");
      }
    });
  }

  if (serverState.status === "ENDED" && !leaderboardPrinted) {
    leaderboardPrinted = true;
    state = "ENDED"; 
    input.disabled = true;
    printLeaderboard(serverState);
  }
  
  if (serverState.status === "ENDED" && serverState.resetCountdown !== null) {
    timerEl.innerText = "REBOOT: " + serverState.resetCountdown + "s";
    
    if (serverState.resetCountdown <= 0) {
      print("\n[SYSTEM] CODES CLEARED. REBOOTING SYSTEM MODULE...", "system");
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  }

  updateUI(serverState);
}

function printLeaderboard(serverState) {
  print("");
  print("========================================", "system");
  print("        FINAL LEADERBOARD               ", "system");
  print("========================================", "system");
  print("");

  let playersToRender = [];
  if (serverState.players && serverState.players.length > 0) {
    playersToRender = serverState.players;
  } else if (serverState.finishedPlayers && serverState.finishedPlayers.length > 0) {
    playersToRender = serverState.finishedPlayers.map(p => p.name);
  }

  if (playersToRender.length === 0) {
    print("NO ACTIVE CONFIGURATIONS FOUND IN SESSION", "error");
    return;
  }

  playersToRender.forEach(playerName => {
    const record = serverState.finishedPlayers.find(p => p.name === playerName);

    if (record) {
      print(`Name: ${record.name}`, "success");
      print(`Time took to finish: ${record.timeTook}`, "success");
    } else {
      print(`Name: ${playerName}`, "error");
      print(`Time took to finish: DNF`, "error");
    }
    print("----------------------------------------");
  });
  print("\nRefresh the page to play again!")
}

// -------------------- PHONE OPEN KEYBOARD ON SCREEN TOUCH --------------------
document.addEventListener("click", () => {
  if (input && !input.disabled) {
    input.focus();
  }
});

// -------------------- UI UPDATE --------------------
function updateUI(data) {
  if (state === "ENDED" || data.status === "ENDED") {
    statusEl.innerText = "STATUS: FINISHED";
  } else if (state === "LOBBY") {
    statusEl.innerText = "STATUS: IN LOBBY";
  } else {
    statusEl.innerText = "STATUS: ACTIVE RACE";
  }
}

// -------------------- RETRO TERMINAL KEY BEEP --------------------
input.addEventListener("input", () => {
  try {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle"; 
    osc.frequency.setValueAtTime(160, audioCtx.currentTime); 
    gain.gain.setValueAtTime(0.35, audioCtx.currentTime); 
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.06);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.06); 
  } catch (e) {}
});

// -------------------- LIVE DISCONNECT --------------------
window.addEventListener("beforeunload", () => {
  if (user && roomCode) {
    const leaveUrl = `${BASE_URL}/leave`; 
    const payload = JSON.stringify({ user, roomCode });

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(leaveUrl, blob);
    } else {
      fetch(leaveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true 
      });
    }
  }
});
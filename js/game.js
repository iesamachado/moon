// ═══════════════════════════════════════════════════════════
// MOON – CPU Binary Challenge · app.js  (versión sin Firebase)
// Costes de energía según el manual oficial:
//   INC, DEC          → 2 unidades
//   NOT, ROL, ROR, MOV → 1 unidad
//   AND, OR, XOR      → ½ unidad
// ═══════════════════════════════════════════════════════════

import { 
  db, collection, addDoc, doc, getDoc, setDoc, updateDoc, increment, query, orderBy, limit, getDocs 
} from "./firebase-config.js";
import { setupAuthListener } from "./auth.js";

// Usuario actual de Firebase
let currentUser = null;

// ──────────────────────────────────────────────────────────
// CONSTANTES
// ──────────────────────────────────────────────────────────
const REGISTERS   = ["A", "B", "C", "D"];
const BINARY_OPS  = ["MOV", "AND", "OR", "XOR"];
const MAX_ENERGY  = 3;   // Unidades de energía por turno (nivel normal, 1 jugador)
const MAX_BITS    = 8;   // Límite técnico máximo de bits

// Coste de energía de cada operación (del manual)
const OP_COST = {
  INC: 2,
  DEC: 2,
  NOT: 1,
  ROL: 1,
  ROR: 1,
  MOV: 1,
  AND: 0.5,
  OR:  0.5,
  XOR: 0.5
};

// ──────────────────────────────────────────────────────────
// ESTADO DEL JUEGO
// ──────────────────────────────────────────────────────────
const state = {
  regs:     { A: 0, B: 0, C: 0, D: 0 },
  targets:  [],
  moves:    0,
  energy:   MAX_ENERGY,   // energía disponible en el turno actual
  op:       "INC",
  reg1:     "A",
  reg2:     "B",
  won:      false,
  gameOver: false,
  played:   0,
  wonCount: 0,
  score:    0,    // Objetivos conseguidos en la partida actual
  highScore:0,    // Récord máximo del usuario
  numBits:  4     // Bits dinámicos de la arquitectura de la CPU
};

// ──────────────────────────────────────────────────────────
// UTILIDADES DINÁMICAS (dependen de numBits)
// ──────────────────────────────────────────────────────────
const $    = id => document.getElementById(id);
const mask = () => (1 << state.numBits) - 1;
const bin  = n  => (n & mask()).toString(2).padStart(state.numBits, "0");
const hex  = n  => "0x" + (n & mask()).toString(16).toUpperCase();
const rnd  = () => Math.floor(Math.random() * (1 << state.numBits));

const generateAvatar = (uid) => `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}&backgroundColor=00e5ff,transparent`;
const anonymizeName = (fullName) => {
  if (!fullName) return "Alumno Anónimo";
  const parts = fullName.trim().split(" ");
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const initials = parts.slice(1).map(p => p.charAt(0).toUpperCase()).join("");
  return `${first} ${initials}`;
};

// ──────────────────────────────────────────────────────────
// OPERACIONES CPU
// ──────────────────────────────────────────────────────────
const ops = {
  INC: (r, r1)     => { r[r1] = (r[r1] + 1) & mask(); },
  DEC: (r, r1)     => { r[r1] = (r[r1] - 1 + (1 << state.numBits)) & mask(); },
  NOT: (r, r1)     => { r[r1] = (~r[r1]) & mask(); },
  // ROL: desplaza a la izquierda; el bit más significativo pasa a la posición 0
  ROL: (r, r1)     => { r[r1] = ((r[r1] << 1) | (r[r1] >> (state.numBits - 1))) & mask(); },
  // ROR: desplaza a la derecha; el bit menos significativo pasa a la posición más significativa
  ROR: (r, r1)     => { r[r1] = ((r[r1] >> 1) | ((r[r1] & 1) << (state.numBits - 1))) & mask(); },
  // MOV: copia Registro 1 (origen) → Registro 2 (destino)
  MOV: (r, r1, r2) => { r[r2] = r[r1]; },
  // AND/OR/XOR: resultado → Registro 1
  AND: (r, r1, r2) => { r[r1] = (r[r1] & r[r2]) & mask(); },
  OR:  (r, r1, r2) => { r[r1] = (r[r1] | r[r2]) & mask(); },
  XOR: (r, r1, r2) => { r[r1] = (r[r1] ^ r[r2]) & mask(); }
};

function fmtCost(cost) {
  return cost === 0.5 ? "½⚡" : `-${cost}⚡`;
}

// ──────────────────────────────────────────────────────────
// LÓGICA DEL JUEGO
// ──────────────────────────────────────────────────────────
function startNewGame() {
  // Reset estado
  state.moves    = 0;
  state.won      = false;
  state.gameOver = false;
  state.energy   = MAX_ENERGY;
  state.score    = 0;

  // Registro A siempre empieza en 0
  // B, C, D → valores aleatorios (modo aprendiz del manual)
  state.regs = {
    A: 0,
    B: rnd(),
    C: rnd(),
    D: rnd()
  };

  // Lista de objetivos
  state.targets = [];
  let firstTarget;
  do { firstTarget = rnd(); } while (firstTarget === 0);
  state.targets.push(firstTarget);

  // Contabilidad
  state.played++;
  $("stat-played").textContent = state.played;

  // Refresca toda la UI
  REGISTERS.forEach(r => renderRegister(r, null));
  renderTargetsQueue();
  renderMoveCounter();
  renderBattery();
  updateOpButtonsAvailability();
  clearHistory();

  // Oculta overlays
  $("victory-overlay").classList.add("hidden");
  $("gameover-overlay").classList.add("hidden");
  $("reg-A").classList.remove("victory-pulse");
  $("target-A").classList.remove("hidden");
}

function executeOperation() {
  if (state.won || state.gameOver) return;

  const { op, reg1, reg2 } = state;
  const cost = OP_COST[op];

  // Comprueba si hay energía suficiente
  if (state.energy < cost) {
    flashNoEnergy();
    return;
  }

  // Snapshot anterior para animación
  const prev = { ...state.regs };

  // Ejecuta la operación
  ops[op](state.regs, reg1, reg2);
  state.moves++;
  state.energy = Math.max(0, +(state.energy - cost).toFixed(1));

  // Actualiza UI
  REGISTERS.forEach(r => renderRegister(r, prev[r]));
  renderMoveCounter();
  renderBattery();
  addHistoryEntry(cost);
  updateOpButtonsAvailability();

  // ¿Coincide el Registro A con algún objetivo?
  const matchedIdx = state.targets.indexOf(state.regs.A);
  if (matchedIdx !== -1) {
    // Objetivo conseguido
    state.targets.splice(matchedIdx, 1);
    state.wonCount++;
    state.score++;
    $("stat-won").textContent = state.wonCount;
    
    checkLevelUp();
    
    // Auto-añadir nuevo objetivo
    let newTarget;
    do { newTarget = rnd(); } while (newTarget === 0 || state.targets.includes(newTarget));
    state.targets.unshift(newTarget);
    
    renderTargetsQueue();
    
    // Efecto visual de acierto
    $("reg-A").classList.add("victory-pulse");
    setTimeout(() => $("reg-A").classList.remove("victory-pulse"), 800);
  }

  // ¿Atrapado? (Sin energía Y sin huecos para poder recargar)
  if (state.energy <= 0 && state.targets.length >= 4) {
    triggerGameOver();
  }
}

function checkLevelUp() {
  const expectedBits = Math.min(MAX_BITS, 4 + Math.floor(state.score / 10));
  if (expectedBits > state.numBits) {
    state.numBits = expectedBits;
    showLevelUpNotification(expectedBits);
    
    // Re-renderizar todos los registros para forzar la recreación del HTML
    REGISTERS.forEach(r => renderRegister(r, null));
  }
}

function showLevelUpNotification(bits) {
  const toast = document.createElement("div");
  toast.className = "level-up-toast";
  toast.innerHTML = `🚀 Nivel superado! Arquitectura ampliada a ${bits} BITS`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

function reloadEnergy() {
  if (state.won || state.gameOver) return;

  // Si ya hay 4 objetivos y recargamos, la nueva tarjeta no cabe y se cae por la cinta
  if (state.targets.length >= 4) {
    triggerGameOver();
    return;
  }

  // Añade un nuevo objetivo por la izquierda (índice 0), empujando el resto
  let newTarget;
  do { newTarget = rnd(); } while (newTarget === 0);
  state.targets.unshift(newTarget);
  
  // Restaura la energía
  state.energy = MAX_ENERGY;
  
  // Actualiza UI
  renderTargetsQueue();
  renderBattery();
  updateOpButtonsAvailability();
}

function triggerVictory() {
  state.won = true;
  state.wonCount++;

  $("stat-won").textContent           = state.wonCount;
  $("victory-bits").textContent       = bin(state.regs.A);
  $("victory-move-count").textContent = state.moves;

  $("reg-A").classList.add("victory-pulse");
  $("victory-overlay").classList.remove("hidden");
}

function triggerGameOver() {
  state.gameOver = true;
  if (state.targets.length > 0) {
    // Si perdimos por quedarnos sin slots o sin energia con objetivos pendientes
    $("gameover-bits").textContent = bin(state.targets[state.targets.length - 1]);
  } else {
    $("gameover-bits").textContent = "----";
  }
  
  // Mensaje de puntuación
  $("gameover-score-val").textContent = state.score;
  const msg = $("gameover-score-msg");
  if (state.score === 0) {
    msg.textContent = "¡Ánimo! Seguro que en la próxima partida logras completar algún objetivo.";
  } else if (state.score <= 2) {
    msg.textContent = "¡Buen trabajo! Has resuelto algunos objetivos.";
  } else if (state.score <= 5) {
    msg.textContent = "¡Genial! Tienes buena lógica de programación 👏";
  } else {
    msg.textContent = "¡IMPRESIONANTE! Eres un Hacker de Nivel Dios 🚀🔥";
  }

  // Guardar en Firebase si hay usuario logueado
  if (currentUser) {
    saveGameToFirebase(state.score, state.numBits);
  }

  $("gameover-overlay").classList.remove("hidden");
}

async function saveGameToFirebase(score, maxBits) {
  try {
    const userRef = doc(db, "users", currentUser.uid);
    const gamesRef = collection(userRef, "games");
    
    // Guardar la partida en el historial
    await addDoc(gamesRef, {
      score: score,
      maxBits: maxBits,
      timestamp: new Date()
    });

    // Actualizar los agregados del usuario (récord, jugadas, totales)
    const updates = {
      played: increment(1),
      wonCount: increment(score)
    };
    if (score > state.highScore) {
      updates.highScore = score;
      state.highScore = score; // actualizamos local
    }

    await setDoc(userRef, updates, { merge: true });

    // Refrescar los agregados desde la BD para que la UI se actualice
    fetchUserStats(currentUser.uid);
    
  } catch (error) {
    console.error("Error guardando partida en Firebase:", error);
  }
}

// Efecto visual cuando se intenta ejecutar sin energía
function flashNoEnergy() {
  const display = $("battery-display");
  display.classList.add("empty");
  $("btn-execute").classList.add("shake");
  setTimeout(() => {
    display.classList.remove("empty");
    $("btn-execute").classList.remove("shake");
  }, 600);
}

// ──────────────────────────────────────────────────────────
// RENDER
// ──────────────────────────────────────────────────────────
function renderRegister(reg, prevValue) {
  const val = state.regs[reg];

  $(`hex-${reg}`).textContent = hex(val);
  $(`dec-${reg}`).textContent = val;

  const container = $(`bits-${reg}`);
  
  if (container.children.length !== state.numBits) {
    container.innerHTML = "";
    for (let i = state.numBits - 1; i >= 0; i--) {
      const cell = document.createElement("div");
      cell.className = "bit-cell";
      cell.dataset.pos = i;
      cell.innerHTML = `<span class="bit-power">${1 << i}</span><span class="bit-val">0</span><span class="bit-pos">b${i}</span>`;
      container.appendChild(cell);
    }
  }

  const bitCells = container.querySelectorAll(".bit-cell");
  bitCells.forEach((cell, idx) => {
    const bitIndex = state.numBits - 1 - idx;
    const bitVal   = (val >> bitIndex) & 1;
    const prevBit  = prevValue !== null ? (prevValue >> bitIndex) & 1 : bitVal;

    if (prevValue !== null && prevBit !== bitVal) {
      cell.classList.add("flip");
      cell.addEventListener("animationend", () => cell.classList.remove("flip"), { once: true });
    }

    cell.querySelector(".bit-val").textContent = bitVal;
    cell.classList.toggle("on", bitVal === 1);
  });
}

function renderTargetsQueue() {
  const container = $("targets-queue");
  container.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const slot = document.createElement("div");
    if (i < state.targets.length) {
      slot.className = "target-slot filled";
      // El slot más a la derecha (índice alto) es el más antiguo
      if (i === 3) slot.classList.add("danger"); 
      slot.innerHTML = `<span class="obj-bits">${bin(state.targets[i])}</span>`;
    } else {
      slot.className = "target-slot empty";
    }
    container.appendChild(slot);
  }
}

function renderMoveCounter() {
  $("move-count").textContent = state.moves;
}

// ── Batería ───────────────────────────────────────────────
function renderBattery() {
  const e        = state.energy;
  const display  = $("battery-display");
  const pipsEl   = $("battery-pips");
  const valEl    = $("battery-val");

  // Número
  valEl.textContent = e % 1 === 0 ? e : e.toFixed(1);

  // Pips: 1 pip por unidad completa + ½ pip si hay fracción
  pipsEl.innerHTML = "";
  for (let i = 0; i < MAX_ENERGY; i++) {
    const pip = document.createElement("div");
    if (i + 1 <= Math.floor(e)) {
      pip.className = "battery-pip";
    } else if (i < e) {
      pip.className = "battery-pip half";   // medio pip
    } else {
      pip.className = "battery-pip empty-pip";
    }
    pipsEl.appendChild(pip);
  }

  // Estado visual del widget
  display.classList.remove("warn", "empty");
  if (e <= 0) {
    display.classList.add("empty");
  } else if (e <= 1) {
    display.classList.add("warn");
  }
}

// Marca los botones de operación que no se pueden pagar
function updateOpButtonsAvailability() {
  const btns = $("op-selector").querySelectorAll(".op-btn");
  btns.forEach(btn => {
    const cost = parseFloat(btn.dataset.cost);
    btn.classList.toggle("no-energy", state.energy < cost);
  });
}

function renderPreview() {
  const { op, reg1, reg2 } = state;
  const isBinary = BINARY_OPS.includes(op);
  const cost     = OP_COST[op];
  // MOV: reg1 (origen) → reg2 (destino)  — flecha derecha
  // AND/OR/XOR: reg1 recibe el resultado  — flecha izquierda
  const isMov    = op === 'MOV';
  const arrow    = isMov ? '→' : '←';
  const [left, right] = isMov ? [reg1, reg2] : [reg1, reg2];

  $("instr-preview").innerHTML = isBinary
    ? `<span class="preview-op">${op}</span>
       <span class="preview-r1">${left}</span>
       <span class="preview-arrow">${arrow}</span>
       <span class="preview-r2">${right}</span>
       <span class="preview-cost">(${fmtCost(cost)})</span>`
    : `<span class="preview-op">${op}</span>
       <span class="preview-r1">${reg1}</span>
       <span class="preview-cost">(${fmtCost(cost)})</span>`;

  // Atenúa Registro 2 para operaciones unarias
  const g = $("reg2-group");
  g.style.opacity       = isBinary ? "1"    : "0.3";
  g.style.pointerEvents = isBinary ? "auto" : "none";
}

// ── Historial ─────────────────────────────────────────────
function clearHistory() {
  $("history-list").innerHTML = '<li class="history-empty">— sin operaciones aún —</li>';
}

function addHistoryEntry(cost) {
  const list  = $("history-list");
  const empty = list.querySelector(".history-empty");
  if (empty) empty.remove();

  const { op, reg1, reg2 } = state;
  const isBinary = BINARY_OPS.includes(op);

  const li = document.createElement("li");
  li.className = "history-item";
  li.innerHTML = `<span class="h-num">${state.moves}.</span>
    <span class="h-op">${op}</span>
    <span class="h-r1">${reg1}</span>
    ${isBinary ? `<span class="h-arrow">←</span><span class="h-r2">${reg2}</span>` : ""}
    <span class="h-cost">${fmtCost(cost)}</span>`;
  list.prepend(li);
}

// ──────────────────────────────────────────────────────────
// EVENTOS
// ──────────────────────────────────────────────────────────
function initEvents() {

  // Operación
  $("op-selector").addEventListener("click", e => {
    const btn = e.target.closest(".op-btn");
    if (!btn) return;
    $("op-selector").querySelectorAll(".op-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.op = btn.dataset.op;
    renderPreview();
  });

  // Registro 1
  $("reg1-selector").addEventListener("click", e => {
    const btn = e.target.closest(".reg-btn");
    if (!btn) return;
    $("reg1-selector").querySelectorAll(".reg-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.reg1 = btn.dataset.reg;
    renderPreview();
  });

  // Registro 2
  $("reg2-selector").addEventListener("click", e => {
    const btn = e.target.closest(".reg-btn");
    if (!btn) return;
    $("reg2-selector").querySelectorAll(".reg-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.reg2 = btn.dataset.reg;
    renderPreview();
  });

  // Ejecutar
  $("btn-execute").addEventListener("click", executeOperation);

  // Recargar Energía
  const btnReload = $("btn-reload");
  if (btnReload) {
    btnReload.addEventListener("click", reloadEnergy);
  }

  // Nueva partida
  $("btn-new-game").addEventListener("click", startNewGame);

  // Ayuda (Pop-up)
  const btnHelp = $("btn-help");
  const btnCloseHelp = $("btn-close-help");
  const helpOverlay = $("help-overlay");
  if (btnHelp && btnCloseHelp && helpOverlay) {
    btnHelp.addEventListener("click", () => helpOverlay.classList.remove("hidden"));
    btnCloseHelp.addEventListener("click", () => helpOverlay.classList.add("hidden"));
    helpOverlay.addEventListener("click", e => {
      if (e.target === helpOverlay) helpOverlay.classList.add("hidden");
    });
  }

  // Ranking (Pop-up)
  const btnRanking = $("btn-ranking");
  const btnCloseRanking = $("btn-close-ranking");
  const rankingOverlay = $("ranking-overlay");
  if (btnRanking && btnCloseRanking && rankingOverlay) {
    btnRanking.addEventListener("click", () => {
      rankingOverlay.classList.remove("hidden");
      loadRanking();
    });
    btnCloseRanking.addEventListener("click", () => rankingOverlay.classList.add("hidden"));
    rankingOverlay.addEventListener("click", e => {
      if (e.target === rankingOverlay) rankingOverlay.classList.add("hidden");
    });
  }

  // Nueva ronda (victoria)
  $("btn-next-round").addEventListener("click", startNewGame);

  // Reintentar (game over)
  $("btn-retry").addEventListener("click", startNewGame);

  // Teclado: Enter = Ejecutar
  document.addEventListener("keydown", e => {
    if (e.key === "Enter") executeOperation();
  });
}

// Añade la clase shake al botón ejecutar (para feedback de sin energía)
(function injectShakeCSS() {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes shake-btn {
      0%,100% { transform: translateX(0); }
      20%     { transform: translateX(-6px); }
      40%     { transform: translateX(6px); }
      60%     { transform: translateX(-4px); }
      80%     { transform: translateX(4px); }
    }
    #btn-execute.shake { animation: shake-btn 0.4s ease; }
    .h-cost { color: rgba(255,181,71,0.6); font-size: 0.7rem; margin-left: 4px; }
  `;
  document.head.appendChild(style);
})();

// ─────────────────────────────────────────────────────────
// AUTENTICACIÓN LOCAL PARA EL JUEGO
// ─────────────────────────────────────────────────────────
setupAuthListener((user, isTeacher) => {
  if (user) {
    currentUser = user;
    if($("user-avatar")) $("user-avatar").src = generateAvatar(user.uid);
    if($("user-name")) $("user-name").textContent = anonymizeName(user.displayName);
    fetchUserStats(user.uid);
  }
});

async function fetchUserStats(uid) {
  try {
    const docSnap = await getDoc(doc(db, "users", uid));
    if (docSnap.exists()) {
      const data = docSnap.data();
      state.played = data.played || 0;
      state.wonCount = data.wonCount || 0;
      state.highScore = data.highScore || 0;
      $("stat-played").textContent = state.played;
      $("stat-won").textContent = state.wonCount;
    }
  } catch (error) {
    console.error("Error recuperando estadísticas:", error);
  }
}

// ──────────────────────────────────────────────────────────
// RANKING GLOBAL
// ──────────────────────────────────────────────────────────
async function loadRanking() {
  const list = $("ranking-list");
  list.innerHTML = `<div class="ranking-loading">Conectando con el satélite...</div>`;
  try {
    const q = query(collection(db, "users"), orderBy("highScore", "desc"), limit(10));
    const snapshot = await getDocs(q);
    
    list.innerHTML = "";
    if (snapshot.empty) {
      list.innerHTML = `<div class="ranking-item">Aún no hay datos de hackers.</div>`;
      return;
    }
    
    let pos = 1;
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const score = data.highScore || 0;
      const name = data.displayNameAnonymized || "Hacker Desconocido";
      const avatar = data.avatarUrl || "";
      
      list.innerHTML += `
        <div class="ranking-item ${pos <= 3 ? 'top-' + pos : ''}">
          <div class="rank-pos">#${pos}</div>
          <img src="${avatar}" class="rank-avatar" alt="bot">
          <div class="rank-name">${name}</div>
          <div class="rank-score">${score} pts</div>
        </div>
      `;
      pos++;
    });
  } catch (err) {
    console.error("Error cargando ranking:", err);
    list.innerHTML = `<div class="ranking-item">Error de conexión.</div>`;
  }
}

// ──────────────────────────────────────────────────────────
// ARRANQUE
// ──────────────────────────────────────────────────────────
function init() {
  initEvents();
  renderPreview();
  startNewGame();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

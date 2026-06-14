import { initAuthUI, setupAuthListener, anonymizeName, generateAvatar } from "./auth.js";
import { db, collection, query, orderBy, limit, getDocs } from "./firebase-config.js";

const $ = id => document.getElementById(id);

// Configurar navegación
$("btn-nav-game")?.addEventListener("click", () => window.location.href = "game.html");
$("btn-nav-classes")?.addEventListener("click", () => window.location.href = "classes.html");
$("btn-nav-tasks")?.addEventListener("click", () => window.location.href = "tasks.html");

initAuthUI();

setupAuthListener((user, isTeacher) => {
  const overlay = $("auth-overlay");
  const screenMenu = $("screen-menu");

  if (user) {
    overlay.classList.add("hidden");
    screenMenu.style.display = "block";

    const menuAvatar = $("menu-avatar");
    const menuName = $("menu-name");

    if (isTeacher) {
      menuAvatar.src = user.photoURL || "";
      menuName.textContent = user.displayName || "Docente";
      $("desc-nav-classes").textContent = "Gestiona tus cursos.";
    } else {
      const anonName = anonymizeName(user.displayName);
      const avatarUrl = generateAvatar(user.uid);
      menuAvatar.src = avatarUrl;
      menuName.textContent = anonName;
      $("desc-nav-classes").textContent = "Únete a una clase.";
    }

    loadGamesHistory(user.uid);
  } else {
    overlay.classList.remove("hidden");
    screenMenu.style.display = "none";
  }
});

async function loadGamesHistory(uid) {
  const container = $("games-history-list");
  if (!container) return;
  
  try {
    const q = query(collection(db, "users", uid, "games"), orderBy("timestamp", "desc"), limit(50));
    const snap = await getDocs(q);
    
    if (snap.empty) {
      container.innerHTML = "<p style='color: rgba(255,255,255,0.5);'>Aún no has jugado ninguna partida.</p>";
      return;
    }

    let html = "";
    snap.forEach(docSnap => {
      const data = docSnap.data();
      const date = data.timestamp ? data.timestamp.toDate().toLocaleString() : "Fecha desconocida";
      html += `
        <div style="display: flex; justify-content: space-between; padding: 10px 15px; background: rgba(255,255,255,0.05); border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);">
          <span style="color: rgba(255,255,255,0.8);">${date}</span>
          <span style="color: var(--accent-cyan); font-family: 'Share Tech Mono', monospace; font-weight: bold; font-size: 1.1rem;">${data.score} pts</span>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (err) {
    console.error("Error cargando historial de partidas:", err);
    container.innerHTML = "<p style='color: var(--accent-red);'>Error cargando el historial.</p>";
  }
}

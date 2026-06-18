// js/classes.js
import { currentUser, setupAuthListener } from "./auth.js";
import { db, collection, addDoc, query, where, getDocs, updateDoc, doc, getDoc, arrayUnion, serverTimestamp, orderBy, limit } from "./firebase-config.js";
import { fetchClassroomCourses, importClassroomStudents, loginTeacher, getTeacherToken, createClassroomAssignment, syncClassroomGrades } from "./classroom.js";

const $ = id => document.getElementById(id);

let isUserTeacher = false;
let currentDetailClassId = null;
let currentDetailClassData = null;

setupAuthListener((user, isTeacher) => {
  if (user) {
    isUserTeacher = isTeacher;
    if (isTeacher) {
      $("classes-actions-teacher").style.display = "flex";
      $("classes-actions-student").style.display = "none";
      loadTeacherClasses();
    } else {
      $("classes-actions-teacher").style.display = "none";
      $("classes-actions-student").style.display = "flex";
      loadStudentClasses();
    }
  }
});

// ════════════════════════════════════════════
// POPUPS PERSONALIZADOS
// ════════════════════════════════════════════
function customModal(title, text, type = 'alert', defaultPrompt = '') {
  return new Promise((resolve) => {
    $("custom-modal-title").textContent = title;
    $("custom-modal-text").textContent = text;
    
    $("custom-modal-input").style.display = type === 'prompt' ? 'block' : 'none';
    $("custom-modal-input").value = defaultPrompt;
    
    $("custom-modal-cancel").style.display = (type === 'prompt' || type === 'confirm') ? 'inline-block' : 'none';
    
    $("custom-modal-overlay").style.display = "flex";
    
    if (type === 'prompt') $("custom-modal-input").focus();
    
    const cleanup = () => {
      $("custom-modal-overlay").style.display = "none";
      $("custom-modal-ok").onclick = null;
      $("custom-modal-cancel").onclick = null;
    };
    
    $("custom-modal-ok").onclick = () => {
      cleanup();
      if (type === 'prompt') resolve($("custom-modal-input").value);
      else resolve(true);
    };
    
    $("custom-modal-cancel").onclick = () => {
      cleanup();
      if (type === 'prompt') resolve(null);
      else resolve(false);
    };
  });
}

const uiAlert = (msg) => customModal("Aviso", msg, "alert");
const uiPrompt = (msg, def) => customModal("Introducir dato", msg, "prompt", def || "");
const uiConfirm = (msg) => customModal("Confirmación", msg, "confirm");

// Expose to window for inline onclick handlers
window.uiAlert = uiAlert;

window.triggerSyncNotes = async (targetPoints, courseWorkId) => {
  if (!currentDetailClassData || !currentDetailClassData.classroomCourseId) return;

  const confirmSync = await uiConfirm("¿Seguro que quieres volcar las notas a Google Classroom? Se actualizarán las puntuaciones de todos los alumnos registrados.");
  if (!confirmSync) return;

  if (!getTeacherToken()) {
    await uiAlert("Se abrirá Google para renovar tu acceso a Classroom.");
    await loginTeacher();
    if (!getTeacherToken()) return;
  }

  // Obtenemos el botón visualmente para mostrar que está cargando (hack: usamos el evento si existe o no)
  // Como lo pasamos por inline, no tenemos acceso al evento fácilmente, mostraremos una alerta
  
  try {
    const taskData = { targetPoints, classroomCourseWorkId: courseWorkId };
    const synced = await syncClassroomGrades(currentDetailClassData.classroomCourseId, currentDetailClassId, taskData);
    await uiAlert(`¡Proceso completado! Se han sincronizado las notas de ${synced} alumnos en Google Classroom.`);
  } catch (err) {
    if (err.message === "401_UNAUTHORIZED") {
      await uiAlert("Tu sesión de Google ha caducado. Vamos a renovarla y luego inténtalo de nuevo.");
      await loginTeacher();
    } else {
      console.error("Error volcando notas:", err);
      await uiAlert("Hubo un error al intentar volcar las notas.");
    }
  }
};

// ════════════════════════════════════════════
// LÓGICA DE HISTORIAL DE ALUMNOS
// ════════════════════════════════════════════
window.viewStudentHistory = async (uid, name) => {
  if (!isUserTeacher) return;
  
  const overlay = $("student-history-overlay");
  const title = $("student-history-title");
  const list = $("student-history-list");
  
  title.textContent = `Partidas de ${name}`;
  list.innerHTML = "<p style='color: rgba(255,255,255,0.5);'>Cargando historial...</p>";
  overlay.style.display = "flex";
  
  try {
    const q = query(collection(db, "users", uid, "games"), orderBy("timestamp", "desc"), limit(50));
    const snap = await getDocs(q);
    
    if (snap.empty) {
      list.innerHTML = "<p style='color: rgba(255,255,255,0.5);'>El alumno aún no ha jugado ninguna partida.</p>";
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
    list.innerHTML = html;
  } catch (err) {
    console.error("Error cargando historial de alumno:", err);
    list.innerHTML = "<p style='color: var(--accent-red);'>Error cargando el historial.</p>";
  }
};

if ($("btn-close-history")) {
  $("btn-close-history").addEventListener("click", () => {
    $("student-history-overlay").style.display = "none";
  });
}

if ($("student-history-overlay")) {
  $("student-history-overlay").addEventListener("click", (e) => {
    if (e.target.id === "student-history-overlay") {
      $("student-history-overlay").style.display = "none";
    }
  });
}

// ════════════════════════════════════════════
// LÓGICA DE PROFESORES
// ════════════════════════════════════════════
$("btn-create-class").addEventListener("click", async () => {
  if (!isUserTeacher || !currentUser) return;
  
  const className = await uiPrompt("Introduce el nombre de la nueva clase (ej. 1º DAM):");
  if (!className || className.trim() === "") return;

  const code = Math.random().toString(36).substring(2, 8).toUpperCase(); // 6 chars alphanumeric
  
  try {
    const classData = {
      name: className.trim(),
      code: code,
      teacherId: currentUser.uid,
      students: [],
      createdAt: serverTimestamp()
    };
    
    await addDoc(collection(db, "classes"), classData);
    await uiAlert(`Clase "${classData.name}" creada con éxito.\nCódigo para alumnos: ${code}`);
    loadTeacherClasses();
  } catch (error) {
    console.error("Error al crear clase:", error);
    await uiAlert("Hubo un error al crear la clase.");
  }
});

$("btn-import-class").addEventListener("click", async () => {
  if (!isUserTeacher || !currentUser) return;
  
  try {
    const btn = $("btn-import-class");
    btn.disabled = true;
    btn.textContent = "Cargando...";

    // If token is missing (e.g. after page reload), request it again
    if (!getTeacherToken()) {
      await uiAlert("Para importar de Classroom necesitamos acceso a tus clases. Por favor, selecciona tu cuenta de Google en la ventana que se abrirá.");
      const success = await loginTeacher();
      if (!success) {
        btn.disabled = false;
        btn.textContent = "📥 Importar de Classroom";
        return;
      }
    }

    const courses = await fetchClassroomCourses();
    if (courses.length === 0) {
      await uiAlert("No se encontraron cursos activos en tu Google Classroom.");
      btn.disabled = false;
      btn.textContent = "📥 Importar de Classroom";
      return;
    }

    let courseListStr = courses.map((c, i) => `${i + 1}: ${c.name}`).join("\n");
    const choiceStr = await uiPrompt(`Selecciona el número del curso a importar:\n\n${courseListStr}`);
    
    if (!choiceStr) {
      btn.disabled = false;
      btn.textContent = "📥 Importar de Classroom";
      return;
    }

    const choiceIdx = parseInt(choiceStr.trim()) - 1;
    if (isNaN(choiceIdx) || choiceIdx < 0 || choiceIdx >= courses.length) {
      await uiAlert("Selección inválida.");
      btn.disabled = false;
      btn.textContent = "📥 Importar de Classroom";
      return;
    }

    const selectedCourse = courses[choiceIdx];
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Create class document first
    const classData = {
      name: selectedCourse.name + " (Classroom)",
      code: code,
      teacherId: currentUser.uid,
      classroomCourseId: selectedCourse.id,
      students: [],
      createdAt: serverTimestamp()
    };
    
    const docRef = await addDoc(collection(db, "classes"), classData);
    
    // Import students from classroom
    btn.textContent = "Importando alumnos...";
    const matched = await importClassroomStudents(selectedCourse.id, docRef.id);
    
    await uiAlert(`Clase importada con éxito.\nAlumnos vinculados automáticamente: ${matched}\nEl resto queda como "pendiente" hasta que inicien sesión con su email de Google.`);
    
    btn.disabled = false;
    btn.textContent = "📥 Importar de Classroom";
    loadTeacherClasses();
  } catch (err) {
    console.error("Error importando de Classroom:", err);
    await uiAlert("Hubo un error importando desde Classroom. Asegúrate de haber iniciado sesión como docente y de haber dado los permisos requeridos.");
    $("btn-import-class").disabled = false;
    $("btn-import-class").textContent = "📥 Importar de Classroom";
  }
});

async function loadTeacherClasses() {
  if (!currentUser) return;
  const container = $("classes-list");
  container.innerHTML = "<p style='color: rgba(255,255,255,0.5);'>Cargando clases...</p>";

  try {
    const q = query(collection(db, "classes"), where("teacherId", "==", currentUser.uid));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      container.innerHTML = "<p style='color: rgba(255,255,255,0.5);'>Aún no has creado ninguna clase.</p>";
      return;
    }
    
    container.innerHTML = "";
    querySnapshot.forEach((classDoc) => {
      const data = classDoc.data();
      const manualStudents = data.students || [];
      const classroomMembers = data.members || [];
      
      const pendingStudents = classroomMembers.filter(m => m.pending).map(m => m.name || m.email);
      // Evitar contar doble si por algún casual estuviera en ambos lados (normalmente no pasa)
      const registeredCount = manualStudents.length + classroomMembers.filter(m => !m.pending).length;
      
      const pendingHtml = pendingStudents.length > 0 
        ? `<div style="margin-top: 12px; font-size: 0.85rem; color: var(--accent-amber); background: rgba(255,193,7,0.1); padding: 8px; border-radius: 6px;">
             ⏳ <strong>Pendientes (${pendingStudents.length})</strong><br>
             <span style="color: rgba(255,255,255,0.7);">${pendingStudents.join(", ")}</span>
           </div>` 
        : "";

      const card = document.createElement("div");
      card.className = "class-card";
      card.innerHTML = `
        <div class="class-card-header">
          <h3 class="class-name">${data.name}</h3>
          <span class="class-code-badge">${data.code}</span>
        </div>
        <div class="class-card-body">
          <p>Alumnos registrados: <strong>${registeredCount}</strong></p>
          ${pendingHtml}
        </div>
      `;
      card.addEventListener("click", () => openClassDetail(classDoc.id, data));
      container.appendChild(card);
    });
  } catch (error) {
    console.error("Error cargando clases del profesor:", error);
    container.innerHTML = "<p style='color: var(--accent-red);'>Error al cargar las clases.</p>";
  }
}

// ════════════════════════════════════════════
// LÓGICA DE ALUMNOS
// ════════════════════════════════════════════
$("btn-join-class").addEventListener("click", async () => {
  if (isUserTeacher || !currentUser) return;
  
  const input = $("input-join-code");
  const code = input.value.trim().toUpperCase();
  if (code === "") {
    await uiAlert("Por favor, introduce un código de clase.");
    return;
  }

  try {
    // 1. Buscar la clase por el código
    const q = query(collection(db, "classes"), where("code", "==", code));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      await uiAlert("No se ha encontrado ninguna clase con ese código.");
      return;
    }

    const classDoc = querySnapshot.docs[0];
    const classData = classDoc.data();
    
    if (classData.students && classData.students.includes(currentUser.uid)) {
      await uiAlert("Ya perteneces a esta clase.");
      return;
    }

    // 2. Añadir el UID del alumno al array de students
    await updateDoc(doc(db, "classes", classDoc.id), {
      students: arrayUnion(currentUser.uid)
    });

    input.value = "";
    await uiAlert(`¡Te has unido con éxito a la clase "${classData.name}"!`);
    loadStudentClasses();
  } catch (error) {
    console.error("Error al unirse a la clase:", error);
    await uiAlert("Hubo un error al intentar unirse a la clase.");
  }
});

async function loadStudentClasses() {
  if (!currentUser) return;
  const container = $("classes-list");
  container.innerHTML = "<p style='color: rgba(255,255,255,0.5);'>Cargando clases...</p>";

  try {
    const q = query(collection(db, "classes"), where("students", "array-contains", currentUser.uid));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      container.innerHTML = "<p style='color: rgba(255,255,255,0.5);'>Aún no te has unido a ninguna clase.</p>";
      return;
    }

    container.innerHTML = "";
    querySnapshot.forEach((classDoc) => {
      const data = classDoc.data();
      
      const card = document.createElement("div");
      card.className = "class-card";
      card.innerHTML = `
        <div class="class-card-header">
          <h3 class="class-name">${data.name}</h3>
        </div>
        <div class="class-card-body">
          <p>Haz clic para ver las tareas y el ranking.</p>
        </div>
      `;
      card.addEventListener("click", () => openClassDetail(classDoc.id, data));
      container.appendChild(card);
    });
  } catch (error) {
    console.error("Error cargando clases del alumno:", error);
    container.innerHTML = "<p style='color: var(--accent-red);'>Error al cargar las clases.</p>";
  }
}

// ════════════════════════════════════════════
// VISTA DETALLE DE CLASE (MAESTRO-DETALLE)
// ════════════════════════════════════════════

$("btn-back-classes").addEventListener("click", () => {
  $("class-detail").style.display = "none";
  $("classes-list").style.display = "grid";
  if (isUserTeacher) {
    $("classes-actions-teacher").style.display = "flex";
  } else {
    $("classes-actions-student").style.display = "flex";
  }
});

function openClassDetail(classId, classData) {
  currentDetailClassId = classId;
  currentDetailClassData = classData;

  $("classes-list").style.display = "none";
  $("classes-actions-teacher").style.display = "none";
  $("classes-actions-student").style.display = "none";
  $("class-detail").style.display = "block";

  $("detail-class-name").textContent = classData.name;

  if (isUserTeacher && classData.classroomCourseId) {
    $("btn-refresh-students").style.display = "block";
  } else {
    $("btn-refresh-students").style.display = "none";
  }

  if (isUserTeacher) {
    $("students-column-title").textContent = "👥 Progreso de Alumnos";
    $("btn-create-task").style.display = "inline-block";
    loadClassStudents(classId, classData);
    loadClassTasks(classId, classData);
  } else {
    $("students-column-title").textContent = "🏆 Podium Top 3";
    $("btn-create-task").style.display = "none";
    loadClassStudents(classId, classData);
    loadClassTasks(classId, classData);
  }
}

async function loadClassStudents(classId, classData) {
  const container = $("detail-students-list");
  container.innerHTML = "<p style='color:rgba(255,255,255,0.5);'>Calculando puntuaciones en tiempo real...</p>";

  const manualStudents = classData.students || [];
  const classroomMembers = classData.members || [];
  
  const pendingStudents = classroomMembers.filter(m => m.pending);
  
  // Extraemos UIDs limpios para no tener duplicados
  const registeredSet = new Set();
  manualStudents.forEach(uid => registeredSet.add(uid));
  classroomMembers.filter(m => !m.pending).forEach(m => {
    // Depending on how we saved it in classroom.js (if members is an array of strings or objects)
    const uid = typeof m === "string" ? m : (m.uid || m.id);
    if(uid) registeredSet.add(uid);
  });

  const registeredUIDs = Array.from(registeredSet);

  const promises = registeredUIDs.map(async (uid) => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) {
        const udata = snap.data();
        let actualHighScore = udata.highScore || 0;
        
        try {
          const qGames = query(collection(db, "users", uid, "games"), orderBy("score", "desc"), limit(1));
          const snapGames = await getDocs(qGames);
          if (!snapGames.empty) {
            const bestScore = snapGames.docs[0].data().score || 0;
            if (bestScore > actualHighScore) {
              actualHighScore = bestScore;
            }
          }
        } catch(e) { console.error("Error fetching true high score:", e); }

        return {
          uid: uid,
          name: udata.displayNameAnonymized || udata.email || "Alumno Anónimo",
          score: actualHighScore,
          played: udata.played || 0
        };
      }
    } catch(e) { console.error("Error fetch student:", e); }
    return null;
  });

  const results = await Promise.all(promises);
  let studentsData = results.filter(s => s !== null);

  // Ordenar por puntuación de mayor a menor
  studentsData.sort((a, b) => b.score - a.score);

  let html = "";
  
  if (isUserTeacher) {
    // PROFESOR: Mostrar listado completo + pendientes
    for (const st of studentsData) {
      const safeName = st.name.replace(/'/g, "\\'");
      html += `
        <div class="student-row" onclick="window.viewStudentHistory('${st.uid}', '${safeName}')" style="cursor: pointer;" title="Ver historial de partidas">
          <div>
            <span class="student-name" style="display:block;">${st.name}</span>
            <span style="font-size: 0.8rem; color: rgba(255,255,255,0.5);">${st.played} partidas jugadas</span>
          </div>
          <span class="student-score">${st.score} pts</span>
        </div>
      `;
    }
    for (const p of pendingStudents) {
      html += `
        <div class="student-row">
          <span class="student-name" style="opacity:0.5;">${p.name || p.email}</span>
          <span class="student-pending">Aún no ha entrado al juego</span>
        </div>
      `;
    }
    if (html === "") {
      html = "<p style='color:rgba(255,255,255,0.5);'>No hay alumnos en esta clase.</p>";
    }
  } else {
    // ALUMNO: Mostrar solo Podium Top 3 y su propia posición si está fuera
    const top3 = studentsData.slice(0, 3);
    
    if (top3.length === 0) {
      html = "<p style='color:rgba(255,255,255,0.5);'>Aún no hay puntuaciones en esta clase.</p>";
    } else {
      const medals = ["🥇", "🥈", "🥉"];
      const podiumClasses = ["podium-1", "podium-2", "podium-3"];
      
      top3.forEach((st, idx) => {
        const isMe = st.uid === currentUser.uid;
        const myHighlight = isMe ? "border: 1px solid var(--accent-cyan); background: rgba(0,229,255,0.1);" : "";
        
        html += `
          <div class="student-row ${podiumClasses[idx]}" style="${myHighlight}">
            <span class="student-name" style="font-size: 1.1rem; color: #fff;">
              ${medals[idx]} ${st.name} ${isMe ? " <strong style='color:var(--accent-cyan)'>(Tú)</strong>" : ""}
            </span>
            <span class="student-score" style="font-size: 1.1rem; font-weight: bold;">${st.score} pts</span>
          </div>
        `;
      });
      
      // Mostrar propia posición si no está en el Top 3
      const myRank = studentsData.findIndex(s => s.uid === currentUser.uid);
      if (myRank > 2) {
        html += `
          <div style="text-align:center; margin: 15px 0; color: rgba(255,255,255,0.3); font-size: 1.2rem;">...</div>
          <div class="student-row" style="border: 1px dashed var(--accent-purple); background: rgba(180,125,255,0.05);">
            <span class="student-name">#${myRank + 1} Tú</span>
            <span class="student-score">${studentsData[myRank].score} pts</span>
          </div>
        `;
      }
    }
  }

  container.innerHTML = html;
}

$("btn-refresh-students").addEventListener("click", async () => {
  if (!isUserTeacher || !currentDetailClassId || !currentDetailClassData.classroomCourseId) return;
  
  const btn = $("btn-refresh-students");
  btn.disabled = true;
  btn.textContent = "🔄 ...";

  try {
    if (!getTeacherToken()) {
      await uiAlert("Renovando conexión con Google Classroom...");
      await loginTeacher();
    }
    if (getTeacherToken()) {
      const matched = await importClassroomStudents(currentDetailClassData.classroomCourseId, currentDetailClassId);
      
      // Volvemos a leer el documento de la clase actualizado
      const classSnap = await getDoc(doc(db, "classes", currentDetailClassId));
      if (classSnap.exists()) {
        currentDetailClassData = classSnap.data();
        await loadClassStudents(currentDetailClassId, currentDetailClassData);
        // Toast o alert de confirmación
        await uiAlert(`Sincronización completada.\nAlumnos registrados: ${matched}`);
      }
    }
  } catch(e) {
    console.error("Error sincronizando alumnos:", e);
    await uiAlert("Hubo un error al actualizar los alumnos.");
  }
  
  btn.disabled = false;
  btn.textContent = "🔄 Actualizar";
});

$("btn-create-task").addEventListener("click", async () => {
  if (!isUserTeacher || !currentDetailClassId) return;

  const title = await uiPrompt("Título de la Tarea (ej: Reto Base de Datos):");
  if (!title) return;

  const pointsStr = await uiPrompt("¿Cuántos puntos en una sola partida deben conseguir para tener el 10/10 en esta tarea?", "20");
  if (!pointsStr) return;
  const targetPoints = parseInt(pointsStr, 10) || 20;

  try {
    const btn = $("btn-create-task");
    btn.disabled = true;
    btn.textContent = "Creando...";

    let classroomCourseWorkId = null;

    if (currentDetailClassData.classroomCourseId) {
      const confirmGoogle = await uiConfirm("¿Quieres publicar esta tarea directamente en el Tablón de tu Google Classroom para que les llegue un aviso a los alumnos?");
      if (confirmGoogle) {
        if (!getTeacherToken()) {
          await uiAlert("Se abrirá Google para renovar tu acceso a Classroom.");
          await loginTeacher();
        }
        if (getTeacherToken()) {
          const cw = await createClassroomAssignment(currentDetailClassData.classroomCourseId, currentDetailClassId, title, targetPoints);
          classroomCourseWorkId = cw.id;
          await uiAlert("¡Tarea publicada con éxito en Google Classroom!");
        }
      }
    }

    if (!classroomCourseWorkId) {
      // Si no va a Classroom, la guardamos manual
      await addDoc(collection(db, "classes", currentDetailClassId, "assignments"), {
        title: title,
        targetPoints: targetPoints,
        createdAt: serverTimestamp()
      });
      await uiAlert("Tarea guardada en MOON.");
    }

    btn.disabled = false;
    btn.textContent = "➕ Nueva Tarea";
    loadClassTasks(currentDetailClassId, currentDetailClassData);
  } catch(e) {
    console.error("Error creating task:", e);
    await uiAlert("Hubo un error al crear la tarea. Revisa la consola o los permisos.");
    $("btn-create-task").disabled = false;
    $("btn-create-task").textContent = "➕ Nueva Tarea";
  }
});

async function loadClassTasks(classId, classData) {
  const container = $("detail-tasks-list");
  container.innerHTML = "<p style='color:rgba(255,255,255,0.5);'>Cargando tareas...</p>";

  try {
    const q = query(collection(db, "classes", classId, "assignments"));
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = "<p style='color:rgba(255,255,255,0.5);'>No has creado ninguna tarea aún.</p>";
      return;
    }

    let html = "";
    snap.forEach(docSnap => {
      const t = docSnap.data();
      const cwBadge = t.classroomCourseWorkId ? `<span style="font-size:0.7rem; background:var(--accent-purple); padding:3px 6px; border-radius:4px; margin-left:10px; color:white;">Classroom Sync</span>` : "";
      
      const syncBtn = isUserTeacher && t.classroomCourseWorkId 
         ? `<button class="btn btn-outline" style="padding:6px 12px; font-size:0.85rem; width:100%; border-color:var(--accent-cyan); color:var(--accent-cyan);" onclick="window.triggerSyncNotes(${t.targetPoints}, '${t.classroomCourseWorkId}')">📊 Volcar Notas a Classroom</button>`
         : ``;

      html += `
        <div class="task-row" style="flex-direction:column; align-items:flex-start; gap:12px; background:rgba(0,229,255,0.02);">
          <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
            <strong style="color:white; font-size:1.1rem;">${t.title} ${cwBadge}</strong>
            <span class="student-score" style="font-size:1rem; border:1px solid var(--accent-cyan);">Objetivo: ${t.targetPoints} pts</span>
          </div>
          ${syncBtn}
        </div>
      `;
    });
    container.innerHTML = html;
  } catch(e) {
    console.error(e);
    container.innerHTML = "<p style='color:var(--accent-red);'>Error cargando tareas.</p>";
  }
}

// ═══════════════════════════════════════════════════════════
// INTEGRACIÓN CON GOOGLE CLASSROOM (PANEL DOCENTE)
// ═══════════════════════════════════════════════════════════

import { 
  auth, db, GoogleAuthProvider, signInWithPopup, doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, updateDoc, arrayUnion, orderBy, limit
} from "./firebase-config.js";

// Scopes requeridos para gestionar Classroom
const CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails'
];

let cachedClassroomToken = null;
let currentTeacher = null;

// ──────────────────────────────────────────────────────────
// AUTENTICACIÓN DOCENTE
// ──────────────────────────────────────────────────────────
export async function loginTeacher() {
  const provider = new GoogleAuthProvider();
  CLASSROOM_SCOPES.forEach(scope => provider.addScope(scope));
  
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedClassroomToken = credential.accessToken;
    currentTeacher = result.user;
    
    // Marcar como profesor en la BD
    await setDoc(doc(db, "users", currentTeacher.uid), { isTeacher: true }, { merge: true });
    
    return true;
  } catch (error) {
    console.error("Error en login de profesor:", error);
    alert("Error al acceder como docente. Verifica los permisos de Classroom.");
    return false;
  }
}

export function getTeacherToken() {
  return cachedClassroomToken;
}

// ──────────────────────────────────────────────────────────
// FUNCIONES DE CLASSROOM API (REST)
// ──────────────────────────────────────────────────────────

// Obtener los cursos activos del profesor
export async function fetchClassroomCourses() {
  if (!cachedClassroomToken) throw new Error("No hay token de Classroom.");
  
  const response = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE', {
    headers: { 'Authorization': `Bearer ${cachedClassroomToken}` }
  });
  
  if (!response.ok) throw new Error("Error obteniendo cursos.");
  const data = await response.json();
  return data.courses || [];
}

// Importar los alumnos de un curso y enlazarlos con usuarios de MOON
export async function importClassroomStudents(courseId, classDocId) {
  const response = await fetch(`https://classroom.googleapis.com/v1/courses/${courseId}/students`, {
    headers: { 'Authorization': `Bearer ${cachedClassroomToken}` }
  });

  if (!response.ok) throw new Error("Error obteniendo alumnos del curso.");
  const data = await response.json();
  const students = data.students || [];

  let matchedCount = 0;
  let members = [];
  let registeredUids = [];
  
  // Buscar a cada alumno en Firestore por su email
  for (const student of students) {
    const email = student.profile?.emailAddress;
    if (!email) continue;

    try {
      const q = query(collection(db, "users"), where("email", "==", email));
      const snap = await getDocs(q);
      
      if (!snap.empty) {
        const userId = snap.docs[0].id;
        members.push(userId);
        registeredUids.push(userId);
        matchedCount++;
      } else {
        // Alumno aún no se ha registrado en MOON. Guardamos su email como pendiente.
        members.push({ email: email, name: student.profile.name.fullName, pending: true });
      }
    } catch (err) {
      console.error("Error buscando alumno:", err);
    }
  }

  // Guardar en la clase
  const updateData = {
    members: members,
    updatedAt: new Date()
  };
  
  // Asegurarnos de que los alumnos vinculados entren también en el array "students" 
  // para que su pantalla de "Mis Clases" pueda encontrarlos.
  if (registeredUids.length > 0) {
    updateData.students = arrayUnion(...registeredUids);
  }

  await updateDoc(doc(db, "classes", classDocId), updateData);

  return matchedCount;
}

// Crear una tarea en Classroom
export async function createClassroomAssignment(courseId, classDocId, title, targetPoints) {
  const siteUrl = window.location.origin + window.location.pathname; // URL actual del juego
  
  // Generar rúbrica escalonada
  let rubric = "📊 RÚBRICA DE EVALUACIÓN:\n";
  for (let grade = 10; grade >= 5; grade--) {
    const requiredPts = Math.ceil(targetPoints * (grade / 10));
    rubric += `• Nota ${grade}: ${requiredPts} puntos\n`;
  }
  rubric += `• Nota inferior a 5: Menos de ${Math.ceil(targetPoints * 0.5)} puntos\n`;

  const courseworkBody = {
    title: `MOON Challenge: ${title}`,
    description: `🚀 ¡Nuevo Reto MOON!\n\n` +
        `Tu puntuación final dependerá de tu Récord Máximo en el juego.\n\n` +
        `${rubric}\n` +
        `👉 Entra aquí para jugar y registrar tu récord: ${siteUrl}`,
    workType: 'ASSIGNMENT',
    state: 'PUBLISHED',
    maxPoints: 10
  };

  const response = await fetch(`https://classroom.googleapis.com/v1/courses/${courseId}/courseWork`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cachedClassroomToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(courseworkBody)
  });

  if (!response.ok) throw new Error("Error creando tarea en Classroom.");
  const coursework = await response.json();

  // Guardar en Firestore
  await addDoc(collection(db, "classes", classDocId, "assignments"), {
    classroomCourseWorkId: coursework.id,
    title: title,
    targetPoints: parseInt(targetPoints),
    createdAt: new Date()
  });

  return coursework;
}

// Volcar Notas (Sincronizar)
export async function syncClassroomGrades(courseId, classDocId, task) {
  const target = task.targetPoints || 10;
  const courseWorkId = task.classroomCourseWorkId;

  // 1. Obtener miembros de la clase
  const classDoc = await getDoc(doc(db, "classes", classDocId));
  if (!classDoc.exists()) return 0;
  const members = classDoc.data().members || [];

  // 2. Obtener lista de alumnos de Classroom para saber su userId de Google
  const rosterRes = await fetch(`https://classroom.googleapis.com/v1/courses/${courseId}/students`, {
    headers: { 'Authorization': `Bearer ${cachedClassroomToken}` }
  });
  
  if (rosterRes.status === 401) {
    throw new Error("401_UNAUTHORIZED");
  }
  
  const rosterData = await rosterRes.json();
  const roster = rosterData.students || [];

  // Mapa Email -> GoogleUserId
  const emailToGoogleId = {};
  roster.forEach(s => {
    if (s.profile?.emailAddress) {
      emailToGoogleId[s.profile.emailAddress.toLowerCase()] = s.userId;
    }
  });

  let syncCount = 0;

  // 3. Evaluar cada alumno registrado
  for (const member of members) {
    if (member.pending) continue; // No registrado en MOON
    
    // Obtener stats de MOON
    const userSnap = await getDoc(doc(db, "users", member));
    if (!userSnap.exists()) continue;
    const userData = userSnap.data();
    const email = userData.email?.toLowerCase();
    
    if (!email || !emailToGoogleId[email]) continue;
    
    const googleUserId = emailToGoogleId[email];
    let highScore = userData.highScore || 0;
    
    try {
      const qGames = query(collection(db, "users", member, "games"), orderBy("score", "desc"), limit(1));
      const snapGames = await getDocs(qGames);
      if (!snapGames.empty) {
        const bestScore = snapGames.docs[0].data().score || 0;
        if (bestScore > highScore) {
          highScore = bestScore;
        }
      }
    } catch(e) { console.error("Error fetching true high score for sync:", e); }
    
    // Rúbrica: (highScore / target) * 10
    let grade = (highScore / target) * 10;
    if (grade > 10) grade = 10;
    grade = Math.round(grade * 10) / 10; // 1 decimal

    try {
      // Obtener la "Entrega" (Submission) de este alumno en esta tarea
      const subRes = await fetch(`https://classroom.googleapis.com/v1/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions?userId=${googleUserId}`, {
        headers: { 'Authorization': `Bearer ${cachedClassroomToken}` }
      });
      const subData = await subRes.json();
      
      if (subData.studentSubmissions?.length > 0) {
        const subId = subData.studentSubmissions[0].id;
        
        // Poner la nota
        const patchRes = await fetch(`https://classroom.googleapis.com/v1/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${subId}?updateMask=draftGrade,assignedGrade`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${cachedClassroomToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ draftGrade: grade, assignedGrade: grade })
        });
        
        if (patchRes.ok) syncCount++;
      }
    } catch (err) {
      console.error(`Error volcando nota de ${email}:`, err);
    }
  }

  return syncCount;
}

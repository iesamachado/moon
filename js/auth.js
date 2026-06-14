// js/auth.js
import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, doc, getDoc, setDoc } from "./firebase-config.js";
import { loginTeacher } from "./classroom.js";

export let currentUser = null;
export let isTeacher = false;

// Utilidades UI
const $ = id => document.getElementById(id);

export const generateAvatar = (uid) => `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}&backgroundColor=00e5ff,transparent`;
export const anonymizeName = (fullName) => {
  if (!fullName) return "Alumno Anónimo";
  const parts = fullName.trim().split(" ");
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const initials = parts.slice(1).map(p => p.charAt(0).toUpperCase()).join("");
  return `${first} ${initials}`;
};

export function loginGoogle() {
  signInWithPopup(auth, googleProvider)
    .then(result => { console.log("Login OK", result.user.email); })
    .catch(error => { console.error("Error Login:", error); });
}

export function loginGoogleTeacher() {
  loginTeacher().then(success => {
    if(success) console.log("Login Docente OK");
  });
}

export function logoutFirebase() {
  signOut(auth).catch(error => console.error("Error al cerrar sesión:", error));
}

// Inicializar botones genéricos si existen en la página
export function initAuthUI() {
  const btnLogin = $("btn-login");
  const btnLoginTeacher = $("btn-login-teacher");
  const btnLogoutMenu = $("btn-logout-menu");
  
  if (btnLogin) btnLogin.addEventListener("click", loginGoogle);
  if (btnLoginTeacher) btnLoginTeacher.addEventListener("click", loginGoogleTeacher);
  if (btnLogoutMenu) btnLogoutMenu.addEventListener("click", logoutFirebase);
}

// Configurar el listener global
export function setupAuthListener(onUserLoad) {
  onAuthStateChanged(auth, async user => {
    currentUser = user;
    if (user) {
      const docSnap = await getDoc(doc(db, "users", user.uid));
      isTeacher = false;
      if (docSnap.exists()) {
        isTeacher = docSnap.data().isTeacher === true;
      }

      if (!isTeacher) {
        // Save student profile
        const anonName = anonymizeName(user.displayName);
        const avatarUrl = generateAvatar(user.uid);
        await setDoc(doc(db, "users", user.uid), {
          email: user.email,
          displayNameAnonymized: anonName,
          avatarUrl: avatarUrl
        }, { merge: true }).catch(err => console.error("Error", err));
      }

      if (onUserLoad) onUserLoad(user, isTeacher);
    } else {
      isTeacher = false;
      if (onUserLoad) onUserLoad(null, false);
      // Si no hay usuario y no estamos en index.html, forzar salida
      if (!window.location.pathname.endsWith("index.html") && window.location.pathname !== "/") {
         window.location.href = "index.html";
      }
    }
  });
}

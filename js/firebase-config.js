// firebase-config.js
// ═══════════════════════════════════════════════════════════
// CONFIGURACIÓN DE FIREBASE
// ═══════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, getDoc, setDoc, updateDoc, increment, query, orderBy, limit, getDocs, where, arrayUnion, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// ⚠️ ATENCIÓN: DEBES PEGAR AQUÍ LA CONFIGURACIÓN DE TU PROYECTO FIREBASE ⚠️
// La encontrarás en la consola de Firebase > Configuración del Proyecto > General
const firebaseConfig = {
  apiKey: "AIzaSyDiNxu8t2z43LA55_QLsdbo_xXMAY6RmDc",
  authDomain: "moon-3af5c.firebaseapp.com",
  projectId: "moon-3af5c",
  storageBucket: "moon-3af5c.firebasestorage.app",
  messagingSenderId: "767538709498",
  appId: "1:767538709498:web:60ce97ee935bcf80df9a43"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  addDoc, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  increment,
  query,
  orderBy,
  limit,
  getDocs,
  where,
  arrayUnion,
  serverTimestamp,
  GoogleAuthProvider
};

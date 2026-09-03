import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getDatabase } from "firebase/database";

// Config leída de .env.local (no versionado, ver .gitignore) — este apiKey
// de Firebase es el "web API key" público (identifica el proyecto, no es un
// secreto: la seguridad real la dan las Reglas de la base de datos), pero
// igual se saca del código fuente para no tenerlo hardcodeado en el repo.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// getAuth()/getDatabase() tiran una excepción SÍNCRONA si el apiKey falta o
// es inválido (ej. Netlify sin las variables VITE_FIREBASE_* configuradas en
// su dashboard — .env.local nunca se sube al repo a propósito). Ese throw
// pasaba sin capturar durante la carga del módulo, y como main.js importa
// firebase.js de forma estática antes de todo lo demás, cortaba la
// ejecución de TODO el bundle — ni el selector "¿De quién recibiste este
// mensaje?" llegaba a engancharse, la página quedaba completamente trabada
// sin ningún error visible para el invitado. Con el try/catch, si Firebase
// falla en inicializar el resto del sitio (countdown, selector de lado,
// video de intro) sigue andando igual; sólo lo que de verdad necesita
// Firebase (RSVP, muro, login admin) deja de funcionar hasta que se
// resuelva la config — degradado, no roto del todo.
let auth = null;
let db = null;
let googleProvider = null;

try {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app); // Usando Realtime Database
  googleProvider = new GoogleAuthProvider();
} catch (err) {
  console.error(
    '[firebase] No se pudo inicializar — revisá que las variables VITE_FIREBASE_* estén configuradas ' +
    '(Netlify: Site configuration → Environment variables). El sitio sigue funcionando, pero RSVP, ' +
    'el muro de mensajes y el login de admin van a estar caídos hasta que se arregle.',
    err,
  );
}

export { auth, db, googleProvider };

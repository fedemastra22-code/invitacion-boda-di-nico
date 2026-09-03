import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from './firebase.js';

const ALLOWED_EMAILS = [
  'nicomastras@gmail.com',
  'dianagasull2@gmail.com',
  'fedemastra22@gmail.com',
  'jorgemastrascusa@gmail.com'
];

export function initAdminLogin() {
  const adminBtn = document.getElementById('adminLoginBtn');
  if (!adminBtn) return;

  adminBtn.addEventListener('click', async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      // Permitimos el acceso solo si el email está en la lista de autorizados
      if (ALLOWED_EMAILS.includes(user.email)) {
        window.location.href = '/admin.html';
      } else {
        alert('Acceso denegado: El correo no está autorizado para ver el dashboard.');
        await auth.signOut();
      }
    } catch (error) {
      console.error('Error durante el login:', error);
      // Se pidió mostrar el código específico (antes decía siempre "Hubo un
      // error al iniciar sesión" para cualquier causa — popup bloqueado,
      // dominio no autorizado en Firebase, red caída, etc. — sin forma de
      // saber cuál sin abrir la consola del navegador).
      const mensajes = {
        'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permití popups para este sitio e intentá de nuevo.',
        'auth/popup-closed-by-user': 'Se cerró la ventana de Google antes de terminar. Intentá de nuevo.',
        'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication → Settings → Authorized domains). Avisale al admin del sitio.',
        'auth/network-request-failed': 'Falla de red al conectar con Google. Revisá tu conexión e intentá de nuevo.',
      };
      alert(mensajes[error.code] || `Hubo un error al iniciar sesión (${error.code || error.message}).`);
    }
  });
}

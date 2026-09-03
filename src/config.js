// Único lugar para tocar datos del evento.
export const WEDDING = {
  names: 'Di & Nico',
  // 17 oct 2026, 17:30 hs Argentina (UTC-3)
  date: new Date(Date.UTC(2026, 9, 17, 20, 30, 0)),
  endDate: new Date(Date.UTC(2026, 9, 18, 2, 0, 0)),
  place: 'Quinta Doña Elvira, Mendoza',
}

// URL de la Web App de Google Apps Script (Paso 1 del README).
export const RSVP_ENDPOINT = import.meta.env.VITE_RSVP_ENDPOINT ?? ''

// Recorte de la música ambiental (ver README > Multimedia).
export const AMBIENT_CLIP = { start: 192.5, seconds: 20 }

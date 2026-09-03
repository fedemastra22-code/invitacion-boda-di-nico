import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { configureGenkit } from '@genkit-ai/core';
import { generate } from '@genkit-ai/ai';
import { googleAI, gemini15Flash } from '@genkit-ai/googleai';

// Inicializar Firebase Admin
admin.initializeApp();
const db = admin.database();

// Inicializar Genkit
// Para que esto funcione, en Firebase Functions hay que configurar la variable de entorno
// GEMINI_API_KEY.
configureGenkit({
  plugins: [googleAI()],
  logLevel: 'info',
  enableTracingAndMetrics: true,
});

export const procesarRsvp = onCall(async (request) => {
  const data = request.data;
  
  if (!data || !data.nombre) {
    throw new HttpsError('invalid-argument', 'El nombre es obligatorio.');
  }

  try {
    const rawName = data.nombre || '';
    const rawSong = data.cancion || data.mensaje || '';

    // Solo llamamos a la IA si hay texto válido
    let nombre = rawName;
    let apellido = '';
    let cancionNormalizada = rawSong;

    const prompt = `
Analiza la siguiente información de un formulario de invitados a una boda:
Nombre ingresado: "${rawName}"
Canción ingresada: "${rawSong}"

1. Extrae el nombre y apellido. Si hay varias personas (ej: "Juan y Maria Perez"), pon "Juan y Maria" en nombre y "Perez" en apellido. Capitaliza correctamente. Si no tiene apellido evidente, deja el apellido vacío.
2. Si la canción ingresada es válida, deduce el título original y el artista para normalizarla (ej: "bad bunny ny" -> "Nueva York - Bad Bunny"). Si está vacía, es un saludo, o no tiene sentido musical, devuélvela vacía "". Esto se usará para un ranking de canciones.

Devuelve ÚNICAMENTE un objeto JSON con esta estructura exacta, sin texto adicional ni formato markdown:
{
  "nombre": "Nombre de pila",
  "apellido": "Apellido",
  "cancionNormalizada": "Título - Artista"
}
`;

    // Procesar con Genkit y Gemini 1.5 Flash (rápido y barato)
    const llmResponse = await generate({
      model: gemini15Flash,
      prompt: prompt,
    });

    const textoRespuesta = llmResponse.text();
    
    try {
      // Limpiar backticks si el LLM los devolvió
      const cleanJson = textoRespuesta.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      
      if (parsed.nombre) nombre = parsed.nombre;
      if (parsed.apellido !== undefined) apellido = parsed.apellido;
      if (parsed.cancionNormalizada !== undefined) cancionNormalizada = parsed.cancionNormalizada;
    } catch (parseError) {
      console.error('Error parseando JSON de Gemini:', textoRespuesta, parseError);
      // Fallback: usar heurística básica si la IA falla
      const partes = rawName.trim().split(/\s+/);
      nombre = partes[0] || '';
      apellido = partes.slice(1).join(' ') || '';
    }

    // Preparar el payload final para Realtime Database
    const rsvpPayload = {
      ...data,
      nombre: nombre,
      apellido: apellido,
      cancionOriginal: rawSong,
      cancion: cancionNormalizada,
      fechaCarga: admin.database.ServerValue.TIMESTAMP,
    };

    // Guardar en la base de datos
    const newRef = db.ref('rsvps').push();
    await newRef.set(rsvpPayload);

    return { 
      success: true, 
      id: newRef.key, 
      nombreProcesado: nombre, 
      apellidoProcesado: apellido 
    };

  } catch (error) {
    console.error('Error en procesarRsvp:', error);
    throw new HttpsError('internal', 'Error procesando la solicitud con IA.');
  }
});

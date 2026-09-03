/**
 * Backend — Boda Di & Nico.
 * Guarda confirmaciones (RSVP) y los mensajes del muro en dos hojas.
 *
 * Pegar en Extensiones > Apps Script de la planilla "Confirmaciones Boda".
 * Implementar > Nueva implementación > Aplicación web
 *   Ejecutar como: Yo   |   Quién tiene acceso: Cualquier persona
 *
 * Si ya lo tenías implementado, después de pegar esto hay que crear una
 * NUEVA versión de la implementación para que los cambios salgan a la web.
 */

var HOJA_RSVP = 'Confirmaciones';
var HOJA_MURO = 'Mensajes';

var HEADERS_RSVP = ['Fecha', 'Nombre', 'Asistencia', 'Acompañantes', 'Restricciones', 'Mensaje'];
// Visible: poner FALSE a mano para bajar un mensaje del muro sin borrarlo.
var HEADERS_MURO = ['Fecha', 'Nombre', 'Mensaje', 'Visible'];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      if (data.tipo === 'mensaje') guardarMensaje(data);
      else guardarRsvp(data);
    } finally {
      lock.releaseLock();
    }
    return json({ status: 'ok' });
  } catch (err) {
    return json({ status: 'error', message: String(err.message || err) });
  }
}

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.tipo === 'mensajes') {
      return json({ status: 'ok', mensajes: leerMensajes() });
    }
    return json({ status: 'ok', message: 'Endpoint activo' });
  } catch (err) {
    return json({ status: 'error', message: String(err.message || err) });
  }
}

function guardarRsvp(data) {
  if (!data.nombre || !String(data.nombre).trim()) throw new Error('Falta el nombre');
  hoja(HOJA_RSVP, HEADERS_RSVP).appendRow([
    new Date(),
    String(data.nombre).slice(0, 200),
    String(data.asistencia || '').slice(0, 20),
    Number(data.acompanantes) || 0,
    String(data.restricciones || '').slice(0, 500),
    String(data.mensaje || '').slice(0, 1000)
  ]);
}

function guardarMensaje(data) {
  if (!data.nombre || !String(data.nombre).trim()) throw new Error('Falta el nombre');
  if (!data.mensaje || !String(data.mensaje).trim()) throw new Error('Falta el mensaje');
  hoja(HOJA_MURO, HEADERS_MURO).appendRow([
    new Date(),
    String(data.nombre).slice(0, 80),
    String(data.mensaje).slice(0, 400),
    true
  ]);
}

function leerMensajes() {
  var sheet = hoja(HOJA_MURO, HEADERS_MURO);
  var filas = sheet.getLastRow() - 1;
  if (filas < 1) return [];

  var datos = sheet.getRange(2, 1, filas, HEADERS_MURO.length).getValues();
  var out = [];
  for (var i = datos.length - 1; i >= 0; i--) {       // más nuevos primero
    if (datos[i][3] === false) continue;              // ocultos a mano
    out.push({ nombre: datos[i][1], mensaje: datos[i][2] });
    if (out.length >= 60) break;
  }
  return out;
}

function hoja(nombre, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(nombre);
  if (!sheet) {
    sheet = ss.insertSheet(nombre);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

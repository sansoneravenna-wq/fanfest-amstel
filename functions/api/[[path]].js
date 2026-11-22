// GENERADO por armar-api.sh a partir de worker/worker.js. No editar a mano.
// API del Fan Fest Amstel · Cloudflare + D1 · registro de pulseras
// Este código es la única fuente. Se publica solo, junto con el sitio, como función de Cloudflare Pages
// (functions/api/[[path]].js se genera a partir de este archivo con armar-api.sh). También sirve como
// Worker independiente.
// Vinculaciones: D1 como "DB". En Pages no hace falta clave (el sitio y la API están en la misma dirección);
// como Worker independiente hay que definir el secreto "API_KEY".
// Opcional: el secreto CLAVE_ELIMINAR (contraseña para eliminar registros o borrar todo; por defecto amstel2026).
//
// Regla única, decidida acá: cada documento retira UNA sola pulsera (la pulsera trae las tirillas de
// consumo, que se cortan a mano en la barra). La base lo garantiza con UNIQUE (pais, documento): dos
// puestos a la vez nunca pueden entregarle dos pulseras al mismo documento.
// La versión anterior (venta de cervezas, etiqueta con QR, lector de barra y pase del fan) quedó guardada
// en la rama "version-completa-venta-qr" del repositorio.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Key',
  'Access-Control-Max-Age': '86400',
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const norm = (t) => String(t == null ? '' : t).toUpperCase().replace(/[^A-Z0-9]/g, '');
const texto = (t, largo = 40) => { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, largo); return t || null; };
const docOk = (doc, pais) => doc.length >= 5 && doc.length <= 20 && !!pais;

let listo = false;
async function preparar(db) {
  if (listo) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS pulseras (
    id INTEGER PRIMARY KEY AUTOINCREMENT, pais TEXT NOT NULL, documento TEXT NOT NULL, nombre TEXT, equipo TEXT,
    creado INTEGER NOT NULL, creado_por TEXT, UNIQUE (pais, documento))`).run();
  listo = true;
}
const buscar = (db, pais, doc) => db.prepare('SELECT * FROM pulseras WHERE pais = ? AND documento = ?').bind(pais, doc).first();

// Busca un documento sin registrar nada: dice si ya retiró su pulsera.
// "parecido": el mismo número ya retiró como documento de otro país (para que el puesto lo verifique).
async function consultar(db, b) {
  const doc = norm(b.documento), pais = norm(b.pais).slice(0, 3);
  if (!docOk(doc, pais)) return { estado: 'documento_invalido' };
  const p = await buscar(db, pais, doc);
  if (p) return { estado: 'ok', existe: true, pulsera: p };
  const otro = await db.prepare('SELECT * FROM pulseras WHERE documento = ? AND pais <> ? LIMIT 1').bind(doc, pais).first();
  return { estado: 'ok', existe: false, parecido: otro || null };
}

// Registra la entrega de la pulsera. Si el documento ya la retiró, no registra nada y devuelve la anterior.
async function entregar(db, b) {
  const doc = norm(b.documento), pais = norm(b.pais).slice(0, 3), equipo = texto(b.equipo);
  if (!docOk(doc, pais)) return { estado: 'documento_invalido' };
  if (!equipo) return { estado: 'falta_equipo' };
  const p = await db.prepare(
    'INSERT INTO pulseras (pais, documento, nombre, equipo, creado, creado_por) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (pais, documento) DO NOTHING RETURNING *')
    .bind(pais, doc, texto(b.nombre, 80), equipo, Date.now(), texto(b.puesto)).first();
  if (p) return { estado: 'ok', pulsera: p };
  return { estado: 'ya_entregada', pulsera: await buscar(db, pais, doc) };
}

async function editar(db, b) {
  const id = Number(b.id) || 0, doc = norm(b.documento), pais = norm(b.pais).slice(0, 3), equipo = texto(b.equipo);
  if (!docOk(doc, pais)) return { estado: 'documento_invalido' };
  if (!equipo) return { estado: 'falta_equipo' };
  const otro = await db.prepare('SELECT id FROM pulseras WHERE pais = ? AND documento = ? AND id <> ?').bind(pais, doc, id).first();
  if (otro) return { estado: 'duplicado' };
  const p = await db.prepare('UPDATE pulseras SET pais = ?, documento = ?, nombre = ?, equipo = ? WHERE id = ? RETURNING *')
    .bind(pais, doc, texto(b.nombre, 80), equipo, id).first();
  return p ? { estado: 'ok', pulsera: p } : { estado: 'inexistente' };
}

// Elimina el registro (corrige un error del puesto): ese documento puede volver a retirar. Pide la contraseña.
async function eliminar(db, b, clave) {
  if (String(b.clave || '') !== clave) return { estado: 'clave_incorrecta' };
  const p = await db.prepare('DELETE FROM pulseras WHERE id = ? RETURNING id').bind(Number(b.id) || 0).first();
  return { estado: p ? 'ok' : 'inexistente' };
}

async function resumen(db) {
  const todos = async (sql) => (await db.prepare(sql).all()).results;
  const t = await db.prepare('SELECT COUNT(*) AS personas FROM pulseras').first();
  return {
    personas: t.personas,
    por_equipo: await todos(`SELECT COALESCE(equipo, 'Sin equipo') AS equipo, COUNT(*) AS personas FROM pulseras GROUP BY 1 ORDER BY 2 DESC`),
    por_puesto: await todos(`SELECT COALESCE(creado_por, 'Sin nombre') AS puesto, COUNT(*) AS personas FROM pulseras GROUP BY 1 ORDER BY 2 DESC`),
    por_pais: await todos(`SELECT pais, COUNT(*) AS personas FROM pulseras GROUP BY 1 ORDER BY 2 DESC`),
    por_hora: await todos(`SELECT (creado / 3600000) * 3600000 AS hora, COUNT(*) AS personas FROM pulseras GROUP BY 1 ORDER BY 1`),
  };
}

// Lista de pulseras entregadas, de la más reciente a la más vieja. Busca por documento o por nombre.
async function pulseras(db, url) {
  const crudo = texto(url.searchParams.get('q'), 60) || '', q = norm(crudo);
  const limite = Math.min(Math.max(Number(url.searchParams.get('limite')) || 100, 1), 100000);
  return (await db.prepare(
    `SELECT * FROM pulseras
     WHERE (?1 = '' AND ?2 = '') OR (?1 <> '' AND documento LIKE '%' || ?1 || '%') OR (?2 <> '' AND nombre LIKE '%' || ?2 || '%')
     ORDER BY creado DESC, id DESC LIMIT ?3`).bind(q, crudo, limite).all()).results;
}

const api = {
  async fetch(request, env, ctx, opc) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const abierto = !!(opc && opc.abierto);   // publicado dentro de Pages sin API_KEY: mismo origen que el sitio
    if (!abierto && (!env.API_KEY || request.headers.get('X-Key') !== env.API_KEY)) return json({ error: 'unauthorized' }, 401);
    const url = new URL(request.url);
    let ruta = url.pathname.replace(/\/+$/, '') || '/';
    if (opc && opc.prefijo && ruta.indexOf(opc.prefijo) === 0) ruta = ruta.slice(opc.prefijo.length) || '/';
    if (!env.DB) return json({ ok: false, error: 'falta_db' }, 503);   // falta vincular la base D1 como "DB"
    const claveEliminar = env.CLAVE_ELIMINAR || 'amstel2026';
    try {
      await preparar(env.DB);
      if (request.method === 'GET') {
        if (ruta === '/estado') return json({ ok: true, version: 3, now: Date.now() });
        if (ruta === '/resumen') return json(await resumen(env.DB));
        if (ruta === '/pulseras') return json(await pulseras(env.DB, url));
      }
      if (request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        if (ruta === '/consultar') return json(await consultar(env.DB, b));
        if (ruta === '/entregar') return json(await entregar(env.DB, b));
        if (ruta === '/editar') return json(await editar(env.DB, b));
        if (ruta === '/eliminar') return json(await eliminar(env.DB, b, claveEliminar));
        if (ruta === '/vaciar') {
          if (String(b.clave || '') !== claveEliminar) return json({ estado: 'clave_incorrecta' });
          if (b.confirmacion !== 'BORRAR') return json({ estado: 'sin_confirmar' });
          await env.DB.prepare('DELETE FROM pulseras').run();
          return json({ estado: 'ok' });
        }
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

// Cloudflare Pages publica esto en /api/* cada vez que se actualiza el sitio.
export async function onRequest(context) {
  return api.fetch(context.request, context.env, context, { abierto: !context.env.API_KEY, prefijo: '/api' });
}

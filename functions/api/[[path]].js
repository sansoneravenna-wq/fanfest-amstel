// GENERADO por armar-api.sh a partir de worker/worker.js. No editar a mano.
// API del Fan Fest Amstel · Cloudflare + D1 · registro de pulseras
// Este código es la única fuente. Se publica solo, junto con el sitio, como función de Cloudflare Pages
// (functions/api/[[path]].js se genera a partir de este archivo con armar-api.sh). También sirve como
// Worker independiente.
// Vinculaciones: D1 como "DB". En Pages no hace falta clave (el sitio y la API están en la misma dirección);
// como Worker independiente hay que definir el secreto "API_KEY".
// Opcional: el secreto CLAVE_ELIMINAR (contraseña para eliminar registros o borrar todo; por defecto amstel2026).
// Opcional: el secreto USUARIOS para cambiar los accesos, con este formato:
//   [{"usuario":"Administrador","clave":"...","admin":true},{"usuario":"Puesto 1","clave":"..."}]
//
// Roles: los puestos solo pueden buscar un documento, registrar la entrega y ver la lista de entregadas.
// El administrador además ve el reporte completo, descarga el Excel, edita, elimina y puede borrar todo.
// Accesos: hay que iniciar sesión con usuario y clave para leer o registrar. Este archivo es público, así
// que acá NO están las claves: de cada una se guarda solo una huella (PBKDF2 + SHA-256) que no permite
// reconstruirla. La sesión es la llave derivada de la clave; el servidor la comprueba contra la huella.
//
// Regla única, decidida acá: cada documento retira UNA sola pulsera (la pulsera trae las tirillas de
// consumo, que se cortan a mano en la barra). La base lo garantiza con UNIQUE (pais, documento): dos
// puestos a la vez nunca pueden entregarle dos pulseras al mismo documento.
// La versión anterior (venta de cervezas, etiqueta con QR, lector de barra y pase del fan) quedó guardada
// en la rama "version-completa-venta-qr" del repositorio.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Key, X-Sesion',
  'Access-Control-Max-Age': '86400',
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const norm = (t) => String(t == null ? '' : t).toUpperCase().replace(/[^A-Z0-9]/g, '');
const texto = (t, largo = 40) => { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, largo); return t || null; };
const docOk = (doc, pais) => doc.length >= 5 && doc.length <= 20 && !!pais;

// ---------- accesos
const USUARIOS = [
  { usuario: 'Administrador', huella: 'b0f86f3549cb501ec1c96d61a743ab9d15a4e0a506dca9a02a6d824169a6ce32', admin: true },
  { usuario: 'Puesto 1', huella: '7840cd2dd81bbf1b0f4a3b9493a550a27aab8fd60e16a49325d07c74e3f77bc9' },
  { usuario: 'Puesto 2', huella: 'ce1d8dc403deca4dcc30a29013dbff6ee50a864596196517478581750c1174a4' },
  { usuario: 'Puesto 3', huella: '0748ae495e6f650270ddead3ce794ea8c3adf4c7abd912852d014b4d7da75569' },
  { usuario: 'Puesto 4', huella: 'ce1493b4c024a0d833d1b458f5f2c6ba531396850252303aa5ba1cfd34a2df63' },
  { usuario: 'Puesto 5', huella: '35f07b624c0991a7700825a49c95656e3c4c04d308974ffbe7b4bb8c3a048dc1' },
];
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
const cod = new TextEncoder();
async function llaveDe(usuario, clave) {      // lenta a propósito (frena el probar claves al azar), pero dentro del tiempo de cómputo de Cloudflare
  const k = await crypto.subtle.importKey('raw', cod.encode(String(clave)), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: cod.encode('fanfest-amstel|' + usuario), iterations: 5000 }, k, 256));
}
const huellaDe = async (llave) => hex(await crypto.subtle.digest('SHA-256', Uint8Array.from(String(llave).match(/../g) || [], (h) => parseInt(h, 16))));
let propios = null;                           // accesos del secreto USUARIOS, ya convertidos a huellas
async function usuarios(env) {
  if (!env.USUARIOS) return USUARIOS;
  if (!propios) {
    const lista = JSON.parse(env.USUARIOS), fuera = [];
    for (const u of lista) fuera.push({ usuario: String(u.usuario), admin: !!u.admin, huella: await huellaDe(await llaveDe(String(u.usuario), u.clave)) });
    propios = fuera;
  }
  return propios;
}
async function entrar(env, b) {
  const u = (await usuarios(env)).find((x) => x.usuario === String(b.usuario || ''));
  if (!u || !b.clave) return { estado: 'clave_incorrecta' };
  // se prueba tal cual, y también en minúsculas y con el guion puesto (por si la escriben "ABCD1234")
  const tal = String(b.clave).trim(), min = tal.toLowerCase().replace(/\s+/g, '');
  const pruebas = [...new Set([/^[a-z0-9]{8}$/.test(min) ? min.slice(0, 4) + '-' + min.slice(4) : min, tal])];
  for (const c of pruebas) {
    const llave = await llaveDe(u.usuario, c);
    if ((await huellaDe(llave)) === u.huella) return { estado: 'ok', usuario: u.usuario, admin: !!u.admin, sesion: llave };
  }
  return { estado: 'clave_incorrecta' };
}
// Devuelve el usuario de la sesión ({ usuario, admin }), o null si no es válida.
async function sesionDe(env, request) {
  const [nombre, llave] = decodeURIComponent(request.headers.get('X-Sesion') || '').split('|');
  if (!nombre || !/^[0-9a-f]{64}$/.test(llave || '')) return null;
  const u = (await usuarios(env)).find((x) => x.usuario === nombre);
  return u && (await huellaDe(llave)) === u.huella ? u : null;
}

// ---------- datos
// Pensado para gastar poco en Cloudflare con miles de registros por día: cada consulta lee pocas filas.
// - Buscar un documento usa índices (por país + documento, y por documento solo).
// - Los totales del reporte se llevan en la tabla "totales" (una fila por hora, equipo, puesto y país), que se
//   actualiza en el mismo paso que cada entrega: el reporte y el contador no recorren la tabla de pulseras.
let listo = false;
async function preparar(db) {
  if (listo) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS pulseras (
      id INTEGER PRIMARY KEY AUTOINCREMENT, pais TEXT NOT NULL, documento TEXT NOT NULL, nombre TEXT, apellido TEXT, equipo TEXT,
      creado INTEGER NOT NULL, creado_por TEXT, UNIQUE (pais, documento))`),
    db.prepare('CREATE INDEX IF NOT EXISTS pulseras_documento ON pulseras (documento)'),
    db.prepare('CREATE TABLE IF NOT EXISTS totales (clave TEXT PRIMARY KEY, n INTEGER NOT NULL) WITHOUT ROWID'),
  ]);
  // bases creadas antes de que existiera el apellido: se agrega la columna (si ya está, el error se ignora)
  try { await db.prepare('ALTER TABLE pulseras ADD COLUMN apellido TEXT').run(); } catch (e) {}
  // bases con pulseras cargadas antes de que existieran los totales: se calculan una vez
  const hay = await db.prepare('SELECT (SELECT COUNT(*) FROM totales) AS t, (SELECT id FROM pulseras LIMIT 1) AS p').first();
  if (hay && !hay.t && hay.p) await recalcular(db);
  listo = true;
}
const buscar = (db, pais, doc) => db.prepare('SELECT * FROM pulseras WHERE pais = ? AND documento = ?').bind(pais, doc).first();
// claves de "totales" a las que aporta una pulsera
const claves = (p) => ['h|' + Math.floor(p.creado / 3600000), 'e|' + (p.equipo || 'Sin equipo'), 'p|' + (p.creado_por || 'Sin nombre'), 'c|' + p.pais];
const sumar = (db, clave, d) => db.prepare('INSERT INTO totales (clave, n) VALUES (?1, ?2) ON CONFLICT (clave) DO UPDATE SET n = n + ?2').bind(clave, d);
// Rehace los totales contando la tabla completa (por si alguna vez quedaran desfasados).
async function recalcular(db) {
  const de = (expr) => db.prepare(`INSERT INTO totales (clave, n) SELECT ${expr}, COUNT(*) FROM pulseras GROUP BY 1`);
  await db.batch([db.prepare('DELETE FROM totales'), de(`'h|' || (creado / 3600000)`), de(`'e|' || COALESCE(equipo, 'Sin equipo')`),
    de(`'p|' || COALESCE(creado_por, 'Sin nombre')`), de(`'c|' || pais`)]);
  return { estado: 'ok' };
}

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
// La entrega y sus totales van en un solo paso: los totales solo suman si la pulsera de este pedido quedó guardada.
async function entregar(db, b) {
  const doc = norm(b.documento), pais = norm(b.pais).slice(0, 3), equipo = texto(b.equipo);
  if (!docOk(doc, pais)) return { estado: 'documento_invalido' };
  if (!equipo) return { estado: 'falta_equipo' };
  const nueva = { pais, documento: doc, equipo, creado: Date.now(), creado_por: texto(b.puesto) };
  const r = await db.batch([
    db.prepare('INSERT INTO pulseras (pais, documento, nombre, apellido, equipo, creado, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (pais, documento) DO NOTHING RETURNING *')
      .bind(pais, doc, texto(b.nombre, 60), texto(b.apellido, 60), equipo, nueva.creado, nueva.creado_por),
    ...claves(nueva).map((c) => db.prepare(
      `INSERT INTO totales (clave, n) SELECT ?1, 1 WHERE EXISTS (SELECT 1 FROM pulseras WHERE pais = ?2 AND documento = ?3 AND creado = ?4 AND creado_por IS ?5)
       ON CONFLICT (clave) DO UPDATE SET n = n + 1`).bind(c, pais, doc, nueva.creado, nueva.creado_por)),
  ]);
  const p = r[0].results && r[0].results[0];
  if (p) return { estado: 'ok', pulsera: p };
  return { estado: 'ya_entregada', pulsera: await buscar(db, pais, doc) };
}

async function editar(db, b) {
  const id = Number(b.id) || 0, doc = norm(b.documento), pais = norm(b.pais).slice(0, 3), equipo = texto(b.equipo);
  if (!docOk(doc, pais)) return { estado: 'documento_invalido' };
  if (!equipo) return { estado: 'falta_equipo' };
  const otro = await db.prepare('SELECT id FROM pulseras WHERE pais = ? AND documento = ? AND id <> ?').bind(pais, doc, id).first();
  if (otro) return { estado: 'duplicado' };
  const antes = await db.prepare('SELECT * FROM pulseras WHERE id = ?').bind(id).first();
  if (!antes) return { estado: 'inexistente' };
  const a = claves(antes), n = claves({ ...antes, pais, equipo }), ajustes = [];
  a.forEach((c, i) => { if (c !== n[i]) ajustes.push(sumar(db, c, -1), sumar(db, n[i], 1)); });
  const r = await db.batch([db.prepare('UPDATE pulseras SET pais = ?, documento = ?, nombre = ?, apellido = ?, equipo = ? WHERE id = ? RETURNING *')
    .bind(pais, doc, texto(b.nombre, 60), texto(b.apellido, 60), equipo, id), ...ajustes]);
  return { estado: 'ok', pulsera: r[0].results[0] };
}

// Elimina el registro (corrige un error del puesto): ese documento puede volver a retirar. Pide la contraseña.
async function eliminar(db, b, clave) {
  if (String(b.clave || '') !== clave) return { estado: 'clave_incorrecta' };
  const p = await db.prepare('SELECT * FROM pulseras WHERE id = ?').bind(Number(b.id) || 0).first();
  if (!p) return { estado: 'inexistente' };
  await db.batch([db.prepare('DELETE FROM pulseras WHERE id = ?').bind(p.id), ...claves(p).map((c) => sumar(db, c, -1))]);
  return { estado: 'ok' };
}

// Totales para el contador (puestos) y el reporte (administrador). Lee solo la tabla "totales".
async function resumen(db, admin) {
  const filas = (await db.prepare('SELECT clave, n FROM totales WHERE n > 0').all()).results;
  const de = (tipo, nombre, fn) => filas.filter((f) => f.clave.slice(0, 2) === tipo + '|')
    .map((f) => ({ [nombre]: fn ? fn(f.clave.slice(2)) : f.clave.slice(2), personas: f.n }));
  const por_hora = de('h', 'hora', (h) => Number(h) * 3600000).sort((x, y) => x.hora - y.hora);
  const personas = por_hora.reduce((s, h) => s + h.personas, 0);
  if (!admin) return { personas, por_hora };      // los puestos solo ven el contador
  const orden = (l) => l.sort((x, y) => y.personas - x.personas);
  return { personas, por_equipo: orden(de('e', 'equipo')), por_puesto: orden(de('p', 'puesto')), por_pais: orden(de('c', 'pais')), por_hora };
}

// Lista de pulseras entregadas, de la más reciente a la más vieja. Busca por documento o por nombre.
// Sin búsqueda lee solo las últimas (por id); con búsqueda recorre la tabla, por eso el sitio no la repite sola.
async function pulseras(db, url, admin) {
  const crudo = texto(url.searchParams.get('q'), 60) || '', q = norm(crudo);
  const limite = Math.min(Math.max(Number(url.searchParams.get('limite')) || 100, 1), admin ? 100000 : 100);   // la descarga completa es del administrador
  return (await db.prepare(
    `SELECT * FROM pulseras
     WHERE (?1 = '' AND ?2 = '') OR (?1 <> '' AND documento LIKE '%' || ?1 || '%') OR (?2 <> '' AND (COALESCE(nombre, '') || ' ' || COALESCE(apellido, '')) LIKE '%' || ?2 || '%')
     ORDER BY id DESC LIMIT ?3`).bind(q, crudo, limite).all()).results;
}

const api = {
  async fetch(request, env, ctx, opc) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const abierto = !!(opc && opc.abierto);   // publicado dentro de Pages sin API_KEY: mismo origen que el sitio
    if (!abierto && (!env.API_KEY || request.headers.get('X-Key') !== env.API_KEY)) return json({ error: 'unauthorized' }, 401);
    const url = new URL(request.url);
    let ruta = url.pathname.replace(/\/+$/, '') || '/';
    if (opc && opc.prefijo && ruta.indexOf(opc.prefijo) === 0) ruta = ruta.slice(opc.prefijo.length) || '/';
    const claveEliminar = env.CLAVE_ELIMINAR || 'amstel2026';
    try {
      // sin sesión: el estado (qué usuarios hay y si la base está vinculada) y el inicio de sesión
      if (request.method === 'GET' && ruta === '/estado')
        return json({ ok: true, version: 4, db: !!env.DB, usuarios: (await usuarios(env)).map((u) => u.usuario), now: Date.now() });
      if (request.method === 'POST' && ruta === '/entrar') return json(await entrar(env, await request.json().catch(() => ({}))));
      const u = await sesionDe(env, request);
      if (!u) return json({ error: 'sesion' }, 401);
      const quien = u.usuario, admin = !!u.admin;
      if (!env.DB) return json({ ok: false, error: 'falta_db' }, 503);   // falta vincular la base D1 como "DB"
      await preparar(env.DB);
      if (request.method === 'GET') {
        if (ruta === '/resumen') return json(await resumen(env.DB, admin));
        if (ruta === '/pulseras') return json(await pulseras(env.DB, url, admin));
      }
      if (request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        b.puesto = quien;                       // cada registro queda a nombre del usuario de la sesión
        if (ruta === '/consultar') return json(await consultar(env.DB, b));
        if (ruta === '/entregar') return json(await entregar(env.DB, b));
        if (!admin && (ruta === '/editar' || ruta === '/eliminar' || ruta === '/vaciar' || ruta === '/recalcular')) return json({ error: 'solo_admin' }, 403);
        if (ruta === '/editar') return json(await editar(env.DB, b));
        if (ruta === '/recalcular') return json(await recalcular(env.DB));
        if (ruta === '/eliminar') return json(await eliminar(env.DB, b, claveEliminar));
        if (ruta === '/vaciar') {
          if (String(b.clave || '') !== claveEliminar) return json({ estado: 'clave_incorrecta' });
          if (b.confirmacion !== 'BORRAR') return json({ estado: 'sin_confirmar' });
          await env.DB.batch([env.DB.prepare('DELETE FROM pulseras'), env.DB.prepare('DELETE FROM totales')]);
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

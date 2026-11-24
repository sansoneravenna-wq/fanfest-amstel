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
// Regla única, decidida acá: cada documento retira UNA pulsera POR DÍA de evento (la pulsera trae las
// tirillas de consumo, que se cortan a mano en la barra). Al día siguiente puede retirar otra.
// La base lo garantiza con UNIQUE (pais, documento, dia): dos puestos a la vez nunca pueden entregarle
// dos pulseras el mismo día al mismo documento.
// Los días del evento están en DIAS. El puesto elige en el sitio de qué día es la pulsera que entrega;
// viene marcado el día en curso (hora de Uruguay, con cambio a las 06:00 y no a medianoche, para que la
// madrugada siga contando para la jornada que empezó la tarde anterior). Solo se aceptan días de DIAS.
// Opcional: la variable DIAS para cambiarlos, separados por coma: 2026-11-25,2026-11-26,2026-11-27
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
// jornada (AAAA-MM-DD) a la que pertenece un momento: hora de Uruguay (UTC-3), con corte a las 06:00
const diaDe = (t) => new Date(t - (3 + 6) * 3600000).toISOString().slice(0, 10);
const DIAS = ['2026-11-25', '2026-11-26', '2026-11-27'];
const diasDe = (env) => { const l = String(env.DIAS || '').split(',').map((x) => x.trim()).filter((x) => /^\d{4}-\d\d-\d\d$/.test(x)).sort(); return l.length ? l : DIAS; };
// día que viene marcado: el de hoy si es del evento; antes del evento el primero, y después el último
const diaActivo = (dias, t) => { const h = diaDe(t); return dias.includes(h) ? h : (dias.find((d) => d > h) || dias[dias.length - 1]); };
// día pedido por el puesto, si es uno del evento; si no, el que viene marcado
const diaPedido = (dias, b) => (dias.includes(b.dia) ? b.dia : diaActivo(dias, Date.now()));

let listo = false;
async function preparar(db) {
  if (listo) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS pulseras_dia (
      id INTEGER PRIMARY KEY AUTOINCREMENT, pais TEXT NOT NULL, documento TEXT NOT NULL, dia TEXT NOT NULL, nombre TEXT, apellido TEXT, equipo TEXT,
      creado INTEGER NOT NULL, creado_por TEXT, marca TEXT, UNIQUE (pais, documento, dia))`),
    db.prepare('CREATE INDEX IF NOT EXISTS pulseras_dia_documento ON pulseras_dia (documento, dia)'),
    db.prepare('CREATE TABLE IF NOT EXISTS totales_dia (clave TEXT PRIMARY KEY, n INTEGER NOT NULL) WITHOUT ROWID'),
  ]);
  listo = true;
}
// todas las pulseras de un documento (una por día como mucho), de la más reciente a la más vieja
const deDoc = async (db, pais, doc) => (await db.prepare('SELECT * FROM pulseras_dia WHERE pais = ? AND documento = ? ORDER BY dia DESC').bind(pais, doc).all()).results;
// claves de "totales" a las que aporta una pulsera
const claves = (p) => ['d|' + p.dia, 'h|' + p.dia + '|' + Math.floor(p.creado / 3600000), 'e|' + p.dia + '|' + (p.equipo || 'Sin equipo'),
  'p|' + p.dia + '|' + (p.creado_por || 'Sin nombre'), 'c|' + p.dia + '|' + p.pais];
const sumar = (db, clave, d) => db.prepare('INSERT INTO totales_dia (clave, n) VALUES (?1, ?2) ON CONFLICT (clave) DO UPDATE SET n = n + ?2').bind(clave, d);
// Rehace los totales contando la tabla completa (por si alguna vez quedaran desfasados).
async function recalcular(db) {
  const de = (expr) => db.prepare(`INSERT INTO totales_dia (clave, n) SELECT ${expr}, COUNT(*) FROM pulseras_dia GROUP BY 1`);
  await db.batch([db.prepare('DELETE FROM totales_dia'), de(`'d|' || dia`), de(`'h|' || dia || '|' || (creado / 3600000)`), de(`'e|' || dia || '|' || COALESCE(equipo, 'Sin equipo')`),
    de(`'p|' || dia || '|' || COALESCE(creado_por, 'Sin nombre')`), de(`'c|' || dia || '|' || pais`)]);
  return { estado: 'ok' };
}

// Busca un documento sin registrar nada: dice si ya retiró su pulsera del día elegido.
// "anteriores": las que retiró otros días (solo informativo, no impiden retirar la de este día).
// "parecido": el mismo número ya retiró ese día como documento de otro país (para que el puesto lo verifique).
async function consultar(db, b, dias) {
  const doc = norm(b.documento), pais = norm(b.pais).slice(0, 3), hoy = diaPedido(dias, b);
  if (!docOk(doc, pais)) return { estado: 'documento_invalido' };
  const todas = await deDoc(db, pais, doc), p = todas.find((x) => x.dia === hoy), anteriores = todas.filter((x) => x.dia !== hoy);
  if (p) return { estado: 'ok', existe: true, pulsera: p, anteriores, dia: hoy };
  const otro = await db.prepare('SELECT * FROM pulseras_dia WHERE documento = ? AND dia = ? AND pais <> ? LIMIT 1').bind(doc, hoy, pais).first();
  return { estado: 'ok', existe: false, anteriores, parecido: otro || null, dia: hoy };
}

// Registra la entrega de la pulsera del día elegido. Si el documento ya retiró la de ese día, no registra nada y devuelve esa.
// La entrega y sus totales van en un solo paso: los totales solo suman si la pulsera de ESTE pedido quedó guardada
// (se reconoce por una marca al azar, única de cada pedido).
async function entregar(db, b, dias) {
  const doc = norm(b.documento), pais = norm(b.pais).slice(0, 3), equipo = texto(b.equipo);
  if (!docOk(doc, pais)) return { estado: 'documento_invalido' };
  if (!equipo) return { estado: 'falta_equipo' };
  const ahora = Date.now(), marca = crypto.randomUUID(), nueva = { pais, documento: doc, dia: diaPedido(dias, b), equipo, creado: ahora, creado_por: texto(b.puesto) };
  const r = await db.batch([
    db.prepare('INSERT INTO pulseras_dia (pais, documento, dia, nombre, apellido, equipo, creado, creado_por, marca) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (pais, documento, dia) DO NOTHING RETURNING *')
      .bind(pais, doc, nueva.dia, texto(b.nombre, 60), texto(b.apellido, 60), equipo, nueva.creado, nueva.creado_por, marca),
    ...claves(nueva).map((c) => db.prepare(
      `INSERT INTO totales_dia (clave, n) SELECT ?1, 1 WHERE EXISTS (SELECT 1 FROM pulseras_dia WHERE pais = ?2 AND documento = ?3 AND dia = ?4 AND marca = ?5)
       ON CONFLICT (clave) DO UPDATE SET n = n + 1`).bind(c, pais, doc, nueva.dia, marca)),
  ]);
  const p = r[0].results && r[0].results[0];
  if (p) return { estado: 'ok', pulsera: p };
  return { estado: 'ya_entregada', pulsera: (await deDoc(db, pais, doc)).find((x) => x.dia === nueva.dia) };
}

async function editar(db, b) {
  const id = Number(b.id) || 0, doc = norm(b.documento), pais = norm(b.pais).slice(0, 3), equipo = texto(b.equipo);
  if (!docOk(doc, pais)) return { estado: 'documento_invalido' };
  if (!equipo) return { estado: 'falta_equipo' };
  const antes = await db.prepare('SELECT * FROM pulseras_dia WHERE id = ?').bind(id).first();
  if (!antes) return { estado: 'inexistente' };
  const otro = await db.prepare('SELECT id FROM pulseras_dia WHERE pais = ? AND documento = ? AND dia = ? AND id <> ?').bind(pais, doc, antes.dia, id).first();
  if (otro) return { estado: 'duplicado' };
  const a = claves(antes), n = claves({ ...antes, pais, equipo }), ajustes = [];
  a.forEach((c, i) => { if (c !== n[i]) ajustes.push(sumar(db, c, -1), sumar(db, n[i], 1)); });
  const r = await db.batch([db.prepare('UPDATE pulseras_dia SET pais = ?, documento = ?, nombre = ?, apellido = ?, equipo = ? WHERE id = ? RETURNING *')
    .bind(pais, doc, texto(b.nombre, 60), texto(b.apellido, 60), equipo, id), ...ajustes]);
  return { estado: 'ok', pulsera: r[0].results[0] };
}

// Elimina el registro (corrige un error del puesto): ese documento puede volver a retirar ese día. Pide la contraseña.
async function eliminar(db, b, clave) {
  if (String(b.clave || '') !== clave) return { estado: 'clave_incorrecta' };
  const p = await db.prepare('SELECT * FROM pulseras_dia WHERE id = ?').bind(Number(b.id) || 0).first();
  if (!p) return { estado: 'inexistente' };
  await db.batch([db.prepare('DELETE FROM pulseras_dia WHERE id = ?').bind(p.id), ...claves(p).map((c) => sumar(db, c, -1))]);
  return { estado: 'ok' };
}

// Totales para el contador (puestos) y el reporte (administrador). Lee solo la tabla de totales.
// Equipo, puesto y país vienen separados por día, para que el reporte pueda mostrar cada jornada o todas juntas.
async function resumen(db, admin, dias) {
  const filas = (await db.prepare('SELECT clave, n FROM totales_dia WHERE n > 0').all()).results, hoy = diaDe(Date.now());
  const de = (tipo) => filas.filter((f) => f.clave.slice(0, 2) === tipo + '|').map((f) => ({ k: f.clave.slice(2), personas: f.n }));
  const por_dia = de('d').map((f) => ({ dia: f.k, personas: f.personas })).sort((x, y) => (x.dia < y.dia ? -1 : 1));
  const personas = por_dia.reduce((s, d) => s + d.personas, 0);
  if (!admin) return { personas, hoy, dias, por_dia };      // los puestos solo ven el contador
  const conDia = (tipo, nombre) => de(tipo).map((f) => ({ dia: f.k.slice(0, 10), [nombre]: f.k.slice(11), personas: f.personas }));
  return { personas, hoy, dias, por_dia, por_equipo: conDia('e', 'equipo'), por_puesto: conDia('p', 'puesto'), por_pais: conDia('c', 'pais'),
    por_hora: de('h').map((f) => ({ dia: f.k.slice(0, 10), hora: Number(f.k.slice(11)) * 3600000, personas: f.personas })).sort((x, y) => x.hora - y.hora) };
}

// Lista de pulseras entregadas, de la más reciente a la más vieja. Busca por documento o por nombre.
// Sin búsqueda lee solo las últimas (por id); con búsqueda recorre la tabla, por eso el sitio no la repite sola.
async function pulseras(db, url, admin) {
  const crudo = texto(url.searchParams.get('q'), 60) || '', q = norm(crudo);
  const dia = /^\d{4}-\d\d-\d\d$/.test(url.searchParams.get('dia') || '') ? url.searchParams.get('dia') : '';     // opcional: solo una jornada
  const limite = Math.min(Math.max(Number(url.searchParams.get('limite')) || 100, 1), admin ? 100000 : 100);   // la descarga completa es del administrador
  return (await db.prepare(
    `SELECT * FROM pulseras_dia
     WHERE (?4 = '' OR dia = ?4)
       AND ((?1 = '' AND ?2 = '') OR (?1 <> '' AND documento LIKE '%' || ?1 || '%') OR (?2 <> '' AND (COALESCE(nombre, '') || ' ' || COALESCE(apellido, '')) LIKE '%' || ?2 || '%'))
     ORDER BY id DESC LIMIT ?3`).bind(q, crudo, limite, dia).all()).results;
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
        return json({ ok: true, version: 6, db: !!env.DB, dias: diasDe(env), hoy: diaDe(Date.now()), usuarios: (await usuarios(env)).map((u) => u.usuario), now: Date.now() });
      if (request.method === 'POST' && ruta === '/entrar') return json(await entrar(env, await request.json().catch(() => ({}))));
      const u = await sesionDe(env, request);
      if (!u) return json({ error: 'sesion' }, 401);
      const quien = u.usuario, admin = !!u.admin;
      if (!env.DB) return json({ ok: false, error: 'falta_db' }, 503);   // falta vincular la base D1 como "DB"
      await preparar(env.DB);
      if (request.method === 'GET') {
        if (ruta === '/resumen') return json(await resumen(env.DB, admin, diasDe(env)));
        if (ruta === '/pulseras') return json(await pulseras(env.DB, url, admin));
      }
      if (request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        b.puesto = quien;                       // cada registro queda a nombre del usuario de la sesión
        if (ruta === '/consultar') return json(await consultar(env.DB, b, diasDe(env)));
        if (ruta === '/entregar') return json(await entregar(env.DB, b, diasDe(env)));
        if (!admin && (ruta === '/editar' || ruta === '/eliminar' || ruta === '/vaciar' || ruta === '/recalcular')) return json({ error: 'solo_admin' }, 403);
        if (ruta === '/editar') return json(await editar(env.DB, b));
        if (ruta === '/recalcular') return json(await recalcular(env.DB));
        if (ruta === '/eliminar') return json(await eliminar(env.DB, b, claveEliminar));
        if (ruta === '/vaciar') {
          if (String(b.clave || '') !== claveEliminar) return json({ estado: 'clave_incorrecta' });
          if (b.confirmacion !== 'BORRAR') return json({ estado: 'sin_confirmar' });
          await env.DB.batch([env.DB.prepare('DELETE FROM pulseras_dia'), env.DB.prepare('DELETE FROM totales_dia')]);
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

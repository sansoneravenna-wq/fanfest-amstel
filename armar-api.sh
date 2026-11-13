#!/bin/sh
# Genera la función de Cloudflare Pages a partir de worker/worker.js. Correr antes de subir cambios de la API.
set -e
cd "$(dirname "$0")"
mkdir -p functions/api
{
  echo "// GENERADO por armar-api.sh a partir de worker/worker.js. No editar a mano."
  sed 's/^export default {$/const api = {/' worker/worker.js
  cat <<'FIN'

// Cloudflare Pages publica esto en /api/* cada vez que se actualiza el sitio.
export async function onRequest(context) {
  return api.fetch(context.request, context.env, context, { abierto: !context.env.API_KEY, prefijo: '/api' });
}
FIN
} > 'functions/api/[[path]].js'
grep -q '^const api = {$' 'functions/api/[[path]].js'

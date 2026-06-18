// Cliente Dropbox para el servidor: refresh token -> access token,
// y descarga/subida de archivos JSON. Usado para persistir distribuidores.json.

const APP_KEY = process.env.DROPBOX_APP_KEY || 'tikuukq06m5jafo';

let _access = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (_access.token && _access.expiresAt > Date.now() + 60000) return _access.token;
  const refresh = process.env.DROPBOX_REFRESH_TOKEN;
  if (!refresh) throw new Error('DROPBOX_REFRESH_TOKEN no configurado');
  const body = new URLSearchParams({
    refresh_token: refresh,
    grant_type: 'refresh_token',
    client_id: APP_KEY
  });
  // Si la app de Dropbox usa secreto, se incluye (opcional).
  if (process.env.DROPBOX_APP_SECRET) {
    body.set('client_secret', process.env.DROPBOX_APP_SECRET);
  }
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Dropbox refresh falló: ' + res.status + ' — ' + t.slice(0, 160));
  }
  const data = await res.json();
  _access = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 14400) * 1000
  };
  return _access.token;
}

// Descarga un archivo. Devuelve { exists, content } (content = string o null).
export async function downloadJson(path) {
  const token = await getAccessToken();
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Dropbox-API-Arg': JSON.stringify({ path })
    }
  });
  if (res.status === 409) return { exists: false, content: null }; // not_found
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Dropbox download falló: ' + res.status + ' — ' + t.slice(0, 160));
  }
  return { exists: true, content: await res.text() };
}

// Sube (sobrescribe) un archivo de texto.
export async function uploadJson(path, contentStr) {
  const token = await getAccessToken();
  const arg = { path, mode: 'overwrite', autorename: false, mute: true };
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Dropbox-API-Arg': JSON.stringify(arg),
      'Content-Type': 'application/octet-stream'
    },
    body: contentStr
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Dropbox upload falló: ' + res.status + ' — ' + t.slice(0, 160));
  }
  return true;
}

export function dropboxConfigured() {
  return !!process.env.DROPBOX_REFRESH_TOKEN;
}

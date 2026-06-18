# AEVOR · Portal de Distribuidores

Portal web con login por distribuidor. Cada distribuidor entra con su usuario y contraseña y ve la lista de precios **calculada con su nivel (tier)**, puede armar un presupuesto marcando productos y cantidades, y generar un PDF. Los precios se leen del JSON que el catálogo sube a Dropbox.

Incluye un **panel de administración** (`/admin.html`) protegido con contraseña para dar de alta, editar y dar de baja distribuidores desde el navegador. Los distribuidores se guardan en `distribuidores.json` en tu Dropbox (persistente, sin tocar Render).

## Dos páginas

- `/` — Portal del distribuidor (login con su usuario/contraseña).
- `/admin.html` — Panel de administración (login con la contraseña de admin). Solo tú.

## Cómo funciona

- **Precios**: el servidor lee `precios_distribuidor.json` desde un enlace compartido de Dropbox (el mismo que generas con el botón "Subir a Dropbox" del catálogo). Cache de 5 min.
- **Tier en servidor**: el JSON contiene el PVP de cada producto; el servidor aplica el descuento del nivel del distribuidor logueado (`dist = pvp − pvp·pct/100`), igual que el catálogo. Cada distribuidor ve solo su precio.
- **Login**: usuario + contraseña. Las contraseñas se guardan como hash bcrypt (nunca en texto plano). La sesión es un token JWT que caduca a las 12 h.

## Variables de entorno (en Render)

| Variable | Qué es | Ejemplo |
|---|---|---|
| `JWT_SECRET` | Secreto para firmar las sesiones. Usa una cadena larga y aleatoria. | `9f3c…` (40+ caracteres) |
| `PRICE_FILE` | **(Recomendado)** Ruta del JSON de precios dentro de tu Dropbox. El servidor lo lee con tu token, sin enlace compartido. | `/precios_distribuidor.json` |
| `PRICE_FEED_URL` | Alternativa a `PRICE_FILE`: enlace compartido de Dropbox al JSON. Úsalo solo si no quieres usar `PRICE_FILE`. | `https://www.dropbox.com/scl/fi/.../precios_distribuidor.json?...` |
| `ADMIN_PASSWORD` | Contraseña del panel de administración. Solo tú la conoces. | una contraseña fuerte |
| `DROPBOX_REFRESH_TOKEN` | Refresh token de tu Dropbox (el mismo de la app del catálogo). Permite al servidor leer/escribir `distribuidores.json`. | `sl.B...` |
| `DISTRIBUTORS` | (Opcional) Semilla inicial de distribuidores. Solo se usa la primera vez si aún no existe `distribuidores.json`. Déjalo en `[]` y usa el panel. | `[]` |
| `DIST_FILE` | (Opcional) Ruta del archivo en Dropbox. Por defecto `/distribuidores.json`. | `/distribuidores.json` |
| `DROPBOX_APP_KEY` | (Opcional) App key de Dropbox. Por defecto la del catálogo. | `tikuukq06m5jafo` |
| `FEED_TTL_MS` | (Opcional) ms de cache del feed de precios. Por defecto 300000 (5 min). | `300000` |
| `TOKEN_TTL` | (Opcional) duración de las sesiones. Por defecto `12h`. | `12h` |

### Sobre el panel de administración

- Entra en `https://<tu-servicio>.onrender.com/admin.html` con `ADMIN_PASSWORD`.
- Das de alta un distribuidor rellenando usuario, nombre, nivel y contraseña. El servidor cifra la contraseña (bcrypt) y guarda todo en `distribuidores.json` en tu Dropbox.
- Editar cambia nombre/nivel (y opcionalmente la contraseña). Baja elimina el acceso al instante.
- **Necesita `DROPBOX_REFRESH_TOKEN`** para guardar. Sin él, el panel funciona en modo solo lectura (te avisa) y los cambios no persisten.

### El `DISTRIBUTORS` ya no se edita a mano

Antes los distribuidores vivían en la variable `DISTRIBUTORS`. Ahora viven en `distribuidores.json` (Dropbox) y se gestionan desde el panel. La variable `DISTRIBUTORS` solo sirve como semilla: si el archivo de Dropbox no existe todavía, el servidor lo crea con lo que haya en `DISTRIBUTORS` (puede ser `[]`).

## Desplegar en Render

Puedes usar el `render.yaml` incluido (Blueprint) o configurarlo a mano:

1. Sube esta carpeta a un repo de GitHub.
2. En Render: **New → Web Service** y conecta el repo.
3. Configura:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/healthz`
4. En **Advanced → Environment**, añade `JWT_SECRET`, `ADMIN_PASSWORD`, `PRICE_FILE` (= `/precios_distribuidor.json`) y `DROPBOX_REFRESH_TOKEN` (y deja `DISTRIBUTORS` en `[]`).
5. **Create Web Service**. Cuando termine el build, el portal estará en `https://<tu-servicio>.onrender.com` y el panel en `/admin.html`.
6. Entra al panel y da de alta tus distribuidores.

Cada vez que cambies precios: actualízalos en el catálogo y pulsa "Subir a Dropbox". El portal los reflejará en cuanto caduque la cache (máx. 5 min), sin tocar Render.

## Probar en local

```bash
npm install
JWT_SECRET=dev_secret \
PRICE_FEED_URL="https://www.dropbox.com/scl/.../precios_distribuidor.json?dl=1" \
DISTRIBUTORS='[{"user":"demo","name":"Demo","tier":"A","hash":"<hash>"}]' \
npm start
# abre http://localhost:3000
```

## Notas de seguridad

- `JWT_SECRET` debe ser largo y secreto. Si lo cambias, todas las sesiones activas se invalidan (los distribuidores tendrán que volver a entrar).
- El enlace de Dropbox debe ser de **solo lectura**. Aun así, el portal nunca expone ese enlace al navegador del distribuidor: el servidor es quien lee el feed.
- Para dar de baja a un distribuidor, quítalo del array `DISTRIBUTORS` y guarda. Pierde el acceso de inmediato (en el siguiente intento de carga).

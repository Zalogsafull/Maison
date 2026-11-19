# Maison · Control de pagos BPS y DGI

App web instalable (Android y iPhone) para llevar los pagos de BPS y DGI de Maison:

- Saldo de la cuenta en dólares y de los pesos recibidos.
- Pagos en pesos discriminados por organismo y concepto. Si un pago sale de la cuenta en dólares, se pide la cotización de esa operación y queda guardada con el pago.
- Gráfico por mes, totales por concepto y cotización promedio.
- Los datos viven en un archivo JSON en el Google Drive del dueño (`Maison - Pagos BPS y DGI.json`), **no en este repositorio**.
- Compartir desde **⚙ Ajustes**: comparte el archivo de Drive con un mail ("Solo ver" o "Puede editar") y Google le envía la invitación.

## Configuración (una sola vez)

1. **GitHub Pages**: *Settings → Pages → Deploy from a branch → `main` / root*. La app queda en `https://zalogsafull.github.io/Maison/`.
2. **Google Cloud** (se puede usar el mismo proyecto de mis-gastos):
   - *APIs & Services → Library*: habilitar **Google Drive API** y **Google Picker API**.
   - *Credentials → OAuth client ID* (Aplicación web): en *Authorized JavaScript origins* tiene que estar `https://zalogsafull.github.io`.
   - *Credentials → Create credentials → API key*: restringirla a *Websites* `https://zalogsafull.github.io/*` y a la API *Google Picker API*.
   - *OAuth consent screen*: scope `.../auth/drive.file`. Si la app está en modo *Testing*, agregar como *Test users* el mail del dueño y de cada persona con la que se comparte.
   - El **Project number** está en el inicio del proyecto (*Dashboard / Project info*).
3. Completar `config.js` con `CLIENT_ID`, `API_KEY` y `APP_ID` (Project number).

## Primer uso

- **Dueño**: entrar con Google → *Crear nuevo a partir de un JSON* y elegir el archivo de datos exportado (o *Crear archivo nuevo* para empezar vacío).
- **Persona invitada**: abrir el link de la invitación, entrar con la cuenta de Google invitada y tocar *Abrir archivo compartido conmigo* (se elige una sola vez).
- **Instalar**: Android/Chrome → menú ⋮ → *Instalar app*. iPhone/Safari → Compartir → *Agregar a inicio*.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Pantallas y estilos |
| `app.js` | Lógica, Drive, Picker y compartir |
| `config.js` | Claves de Google (públicas, restringidas por dominio) |
| `sw.js` | Service worker (app sin conexión). Subir `VERSION` al publicar cambios |
| `manifest.webmanifest`, `img/` | Ícono y datos de instalación |

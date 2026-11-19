# Maison · Control de pagos BPS y DGI

App web instalable (Android y iPhone) para llevar los pagos de BPS y DGI de Maison:

- Saldo de la cuenta en dólares y de los pesos recibidos.
- Pagos en pesos discriminados por organismo y concepto. Si un pago sale de la cuenta en dólares, se pide la cotización de esa operación y queda guardada con el pago.
- Gráfico por mes, totales por concepto y cotización promedio.
- Los datos viven en un archivo JSON en el Google Drive del dueño (`Maison - Pagos BPS y DGI.json`), **no en este repositorio**.
- Compartir desde **⚙ Ajustes**: comparte el archivo de Drive con un mail ("Solo ver" o "Puede editar") y Google le envía la invitación.

## Cómo funciona (igual que Mis gastos)

- Los cambios se guardan **primero en el teléfono** (anda sin conexión) y se suben solos a `maison-pagos.json` en el Drive del dueño. Si el permiso de Google venció, el indicador de arriba dice **↻ Conectar Drive**: un toque y sincroniza.
- Si hay cambios en dos lugares, se juntan movimiento por movimiento y gana el cambio más nuevo (los borrados también se sincronizan).
- Usa el mismo proyecto de Google Cloud que Mis gastos (`config.js`): permiso `drive.file`, así la app solo ve su propio archivo.

## Primer uso

- **Dueño**: *Entrar con Google* → *Crear nuevo a partir de un JSON* y elegir el archivo de datos exportado (o *Crear archivo nuevo* para empezar vacío).
- **Compartir**: ⚙ Ajustes → nombre, mail y permiso → *Compartir y enviar invitación*. Google le manda un mail con el link `…/Maison/#unirse=…`.
- **Persona invitada**: abre el link, entra con la cuenta invitada y toca *Aceptar invitación* (elige el archivo una sola vez). Con permiso "Solo ver" no puede cambiar nada.
- **Instalar**: Android/Chrome → menú ⋮ → *Instalar app*. iPhone/Safari → Compartir → *Agregar a inicio*.

## Si algo no anda con Google

- En Google Cloud (proyecto de Mis gastos) tienen que estar habilitadas **Google Drive API** y **Google Picker API**, y el origen `https://zalogsafull.github.io` en el OAuth client.
- Si la pantalla de consentimiento está en modo *Testing*, agregar como *Test users* los mails de las personas con las que se comparte.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Pantallas y estilos |
| `app.js` | Lógica, Drive, Picker y compartir |
| `config.js` | Claves de Google (públicas, restringidas por dominio) |
| `sw.js` | Service worker (app sin conexión). Subir `VERSION` al publicar cambios |
| `manifest.webmanifest`, `img/` | Ícono y datos de instalación |

/* Configuración de Google (son datos públicos por diseño: el Client ID y la API key
   quedan visibles en cualquier app web; protegelos restringiéndolos a tu dominio
   en Google Cloud Console). */
window.MAISON_CONFIG = {
  // Mismo proyecto de Google Cloud que Mis gastos (mis-gastos-514003)
  CLIENT_ID: '499878544628-pn1o30cvka3roletog6e2mio5atpo5io.apps.googleusercontent.com',
  // API key con "Google Picker API" habilitada, restringida a https://zalogsafull.github.io/*
  API_KEY: 'AIzaSyDmbVg5wQ1Oh6h5MwaYwHPR43QANjiF4Pk',
  // Número del proyecto de Google Cloud (Project number, solo dígitos)
  APP_ID: '499878544628',
  // Dirección pública de la app
  APP_URL: 'https://zalogsafull.github.io/Maison/'
};

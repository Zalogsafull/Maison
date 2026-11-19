/* Configuración de Google (son datos públicos por diseño: el Client ID y la API key
   quedan visibles en cualquier app web; protegelos restringiéndolos a tu dominio
   en Google Cloud Console). */
window.MAISON_CONFIG = {
  // OAuth 2.0 Client ID (tipo "Aplicación web"). Puede ser el mismo de mis-gastos.
  CLIENT_ID: 'PEGAR_CLIENT_ID.apps.googleusercontent.com',
  // API key con "Google Picker API" habilitada, restringida a https://zalogsafull.github.io/*
  API_KEY: 'PEGAR_API_KEY',
  // Número del proyecto de Google Cloud (Project number, solo dígitos)
  APP_ID: 'PEGAR_PROJECT_NUMBER',
  // Dirección pública de la app
  APP_URL: 'https://zalogsafull.github.io/Maison/'
};

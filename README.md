# La Liga · Pronòstics 26/27

Dashboard de la porra: https://sitoflexi.github.io/la-liga-pronostics/

## Puntuación
- Resultado exacto: **5 pts** (verde)
- Signo acertado (1X2) sin resultado exacto: **2 pts** (amarillo)
- Nada: **0 pts** (rojo)
- Comodín: un partido por jugador y jornada, sus puntos se **doblan**.

Los puntos se calculan solos a partir de `data.json` (resultados, pronósticos y comodines).

## Admin
`/admin.html` con la contraseña de admin. Desde ahí se añaden jornadas, resultados,
pronósticos, comodines y el bote. Al guardar se hace un commit de `data.json` y la web
se actualiza en 1–2 minutos.

La contraseña descifra un token de GitHub (fine-grained, solo este repo, Contents read/write)
guardado cifrado en `key.json` (PBKDF2 600k + AES-GCM). Cuando el token caduque, se crea
uno nuevo y se vuelve a configurar desde el mismo panel.

`scripts/import_sheet.py` es el import inicial desde la hoja de Google (pestaña 26/27 JORNADES).

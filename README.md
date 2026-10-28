# EMERTEAM Monitoreo Ambiental

Web de monitoreo ambiental para organizadores de eventos deportivos: armado, carrera y desarme.
Desarrollo nuevo e independiente de EMERTEAM METEO (emerteam-meteo.netlify.app), que no se modifica.

## Estructura
- `docs/` Especificación, referencias y fuentes
- `web/` Aplicación web (organizador, administración, comando, carga en terreno)
- `pipeline/` Procesamiento de modelos (GitHub Actions): descarga, puntos por evento, WBGT, niveles
- `supabase/` Base de datos, autenticación y funciones (SMN, rayos, correos)

## Referencias
- Especificación: https://claude.ai/code/artifact/f89fa0d0-8e59-410c-886b-db22bb37e03b
- Maqueta de diseño: https://claude.ai/artifact/CchsJvnJAus7L5PBdmppcc
- Referencias y fuentes: `docs/referencias-y-fuentes.md`

## Acceso
Diego Pizzini (propietario) y Agustín Astorga (colaborador).

## Publicación

- Web: Netlify publica automáticamente cada actualización de `main` (configuración en `netlify.toml`). Cada publicación en producción consume créditos, así que los cambios se trabajan en ramas y se pasan a `main` por tandas.
- Funciones de Supabase y migraciones: se publican aparte; no dependen de Netlify.

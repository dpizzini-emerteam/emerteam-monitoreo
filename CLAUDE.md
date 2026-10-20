# Reglas del repositorio

- Producto: EMERTEAM Monitoreo Ambiental. No tocar EMERTEAM METEO, SUITE ni COMMAND.
- Base de datos: Supabase `emerteam-historico-carreras` (ref timwhyxdrputxywsolck), compartida con EMERTEAM SUITE.
  - Solo tablas con prefijo `mon_` en public; funciones de permiso en el esquema `mon_priv`.
  - RLS activo en toda tabla nueva desde su creación.
  - No modificar tablas, políticas, triggers ni plantillas de correo existentes de SUITE. No crear triggers en auth.users.
  - Excepción aprobada por Diego (20/10/2026): las políticas de SUITE exigen `suite_priv.es_equipo()` (lista `suite_priv.equipo`), porque la autenticación es compartida con los organizadores de Monitoreo. Ver supabase/suite/.
- Escala WBGT oficial: World Athletics (2020). Ningún otro umbral se rotula como World Athletics.
- Cada recomendación cita su fuente y su tipo (norma/legislación, guía internacional, consenso científico, especificación de fabricante, criterio interno EMERTEAM).
- Costo mensual cero: no usar Open-Meteo gratuito (uso no comercial). Fuentes como conectores configurables.
- Nombre del evento antes que cualquier código en archivos, correos y listados.
- Identidad visual: negro #111111, naranja #FF6A1A, gris #1A1A1A, gris técnico #7C7C7C; niveles verde #2FA34C, amarillo #C79000, naranja #FF6A1A, rojo #FF3B30. Barlow Condensed en títulos, pestañas y rótulos (mayúscula); texto corrido, formularios y datos en Atkinson Hyperlegible Next para distinguir I, l y 1 (aprobado por Diego 20/10/2026).
- Nunca publicar la service role key ni ninguna credencial en el código.

# Procesamiento de modelos

Corre en GitHub Actions cada 2 horas (`.github/workflows/pronosticos.yml`).

1. Consulta los eventos en monitoreo a la función `mon-ingesta` (autenticación OIDC de GitHub, sin secretos).
2. Por cada fuente con corrida nueva (GFS horario hasta 120 h; ECMWF IFS cada 3 h hasta 144 h), extrae el punto de grilla más cercano a cada evento y calcula el WBGT estimado (Liljegren, vía thermofeel).
3. Recalcula los niveles por fase con la serie de consenso (ECMWF prioritario, GFS de respaldo) y la confianza por dispersión entre modelos.

Ejecución manual: Actions › Pronósticos y niveles › Run workflow (opción "forzar" para reprocesar).

## Pronóstico probabilístico por umbral (ensambles)

`python -m mon.probabilistico` (workflow «Ensambles», 08:47 y 20:47 UTC). Usa ECMWF ENS open data (50 miembros perturbados, CC BY 4.0) y NOAA GEFS 0,25° (control + 30), corridas 00 y 12 UTC, pasos de 3 h hasta +144 h. Descarga por rangos de bytes solo los pasos y parámetros que cubren las ventanas de los eventos activos (cada campo global sirve para todos los eventos), extrae el punto de tierra de cada evento, interpola a paso horario (radiación por coseno cenital), aplica la corrección de sesgo del determinístico de la misma fuente y calcula el WBGT de cada miembro por Liljegren (thermofeel, Apache 2.0; el viento de 10 m se lleva a 2 m dentro de thermofeel).

Guarda cada emisión sin sobrescribir en `mon_ens_prob` (probabilidad de alcanzar cada nivel con el máximo de la ventana: carrera, último cuarto por modalidad, armado, desarme; mezcla 50 % por modelo) y `mon_ens_horas` (P10, mediana, P90 horarios). Medición inicial (3 eventos): unos 10 GB y 5 minutos por emisión.

`python -m mon.ensambles` explora los índices (parámetros por miembro, peso de los campos, tiempos) sin escribir en la base.

Verificación: `mon_priv.mon_ens_verificar()` (pg_cron, 09:17 UTC) registra en `mon_ens_verif` si cada umbral de WBGT y ráfaga se alcanzó en las ventanas cerradas, con las mediciones en campo. Las vistas `mon_ens_brier` y `mon_ens_confiabilidad` dan el puntaje de Brier y la confiabilidad por variable, ventana y anticipación. Tormenta y lluvia no se verifican: no hay observación equivalente guardada.

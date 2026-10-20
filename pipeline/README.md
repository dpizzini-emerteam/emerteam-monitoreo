# Procesamiento de modelos

Corre en GitHub Actions cada 2 horas (`.github/workflows/pronosticos.yml`).

1. Consulta los eventos en monitoreo a la función `mon-ingesta` (autenticación OIDC de GitHub, sin secretos).
2. Por cada fuente con corrida nueva (GFS horario hasta 120 h; ECMWF IFS cada 3 h hasta 144 h), extrae el punto de grilla más cercano a cada evento y calcula el WBGT estimado (Liljegren, vía thermofeel).
3. Recalcula los niveles por fase con la serie de consenso (ECMWF prioritario, GFS de respaldo) y la confianza por dispersión entre modelos.

Ejecución manual: Actions › Pronósticos y niveles › Run workflow (opción "forzar" para reprocesar).

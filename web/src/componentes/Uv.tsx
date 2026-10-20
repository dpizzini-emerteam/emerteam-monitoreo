import { Icono } from "./Icono";
import { categoriaUv, UV_CATEGORIAS } from "../serie";

/** Humedad relativa con su ícono */
export function Humedad({ texto, size = 20 }: { texto: string; size?: number }) {
  return (
    <span className="humedad" title="Humedad relativa">
      <Icono tipo="humedad" size={size} />{texto}
    </span>
  );
}

/** Escala de 5 tramos (OMS) con los tramos alcanzados pintados */
export function EscalaUv({ uv }: { uv: number }) {
  const i = UV_CATEGORIAS.indexOf(categoriaUv(uv));
  return (
    <span className="uv-escala" aria-hidden>
      {UV_CATEGORIAS.map((c, k) => <i key={c.nombre} style={k <= i ? { background: c.oms } : undefined} />)}
    </span>
  );
}

/** Índice UV con ícono de sol, valor, categoría y escala (no usa los colores del semáforo operativo) */
export function UvDato({ uv, compacto = false }: { uv: number | null | undefined; compacto?: boolean }) {
  const c = uv != null ? categoriaUv(uv) : null;
  return (
    <span className={`uv-dato${compacto ? " compacto" : ""}`} title={c ? `Índice UV con cielo despejado: ${c.nombre}` : "Índice UV sin dato"}>
      <Icono tipo="uv" size={compacto ? 20 : 30} />
      <span>
        <span className="v">{uv != null ? Math.round(uv) : "—"}</span>
        {!compacto && <span className="e">UV{c ? ` · ${c.nombre}` : ""}</span>}
        {uv != null && uv >= 0.5 && <EscalaUv uv={uv} />}
      </span>
    </span>
  );
}

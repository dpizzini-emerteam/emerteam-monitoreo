import { Icono } from "./Icono";
import { categoriaUv } from "../serie";

/** Etiqueta del índice UV con el color de su categoría OMS */
export function UvChip({ uv, compacto = false }: { uv: number | null | undefined; compacto?: boolean }) {
  if (uv == null) return <span className="chico">UV —</span>;
  const c = categoriaUv(uv);
  return (
    <span className="uv-chip" style={{ background: c.fondo, color: c.texto }} title={`Índice UV con cielo despejado: ${c.nombre}`}>
      UV {Math.round(uv)}{compacto ? "" : ` · ${c.nombre}`}
    </span>
  );
}

/** Humedad relativa con su ícono */
export function Humedad({ texto, size = 20 }: { texto: string; size?: number }) {
  return (
    <span className="humedad" title="Humedad relativa">
      <Icono tipo="humedad" size={size} />{texto}
    </span>
  );
}

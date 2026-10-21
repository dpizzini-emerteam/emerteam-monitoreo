export type TipoIcono =
  | "sol" | "solnube" | "nube" | "lluvia" | "tormenta" | "viento" | "termometro"
  | "gota" | "rayo" | "luna" | "estructura" | "corredor" | "humedad" | "uv" | "alerta";

export function Icono({ tipo, size = 40 }: { tipo: TipoIcono; size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={{ flex: "0 0 auto", color: "var(--tinta)" }}>
      <defs>
        <radialGradient id="ic-sol" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#FFE07A" /><stop offset="55%" stopColor="#FFB31A" /><stop offset="100%" stopColor="#F28C00" />
        </radialGradient>
        <linearGradient id="ic-nube" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" /><stop offset="100%" stopColor="#C9CED6" />
        </linearGradient>
        <linearGradient id="ic-nube-gris" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E3E6EA" /><stop offset="100%" stopColor="#9EA4AD" />
        </linearGradient>
        <linearGradient id="ic-nube-osc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9AA1AB" /><stop offset="100%" stopColor="#5E6570" />
        </linearGradient>
        <linearGradient id="ic-gota" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5AB0FF" /><stop offset="100%" stopColor="#1E6FD9" />
        </linearGradient>
        <linearGradient id="ic-rayo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE45C" /><stop offset="100%" stopColor="#FFB000" />
        </linearGradient>
        <filter id="ic-sombra" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.4" floodColor="#000" floodOpacity="0.22" />
        </filter>
      </defs>
      {tipo === "sol" && <path d={SOL(32, 32, 19)} fill="url(#ic-sol)" filter="url(#ic-sombra)" />}
      {tipo === "solnube" && (
        <>
          <path d={SOL(25, 24, 15)} fill="url(#ic-sol)" filter="url(#ic-sombra)" />
          <path d={NUBE} transform="translate(8 14) scale(0.8)" fill="url(#ic-nube)" filter="url(#ic-sombra)" />
        </>
      )}
      {tipo === "nube" && (
        <>
          <path d={NUBE} transform="translate(-4 -2) scale(0.78)" fill="url(#ic-nube-gris)" />
          <path d={NUBE} transform="translate(6 10) scale(0.85)" fill="url(#ic-nube-gris)" filter="url(#ic-sombra)" />
        </>
      )}
      {tipo === "luna" && (
        <>
          <path d="M38 10a22 22 0 1 0 16 33A18 18 0 1 1 38 10z" fill="#D9DDE3" filter="url(#ic-sombra)" />
          <path d={NUBE} transform="translate(14 22) scale(0.62)" fill="url(#ic-nube-gris)" opacity="0.9" />
        </>
      )}
      {tipo === "lluvia" && (
        <>
          <path d={NUBE} transform="translate(3 -2) scale(0.9)" fill="url(#ic-nube-gris)" filter="url(#ic-sombra)" />
          {[[22, 46], [34, 50], [46, 46]].map(([x, y]) => <path key={x} d={GOTA(x, y)} fill="url(#ic-gota)" />)}
        </>
      )}
      {tipo === "tormenta" && (
        <>
          <path d={NUBE} transform="translate(3 -3) scale(0.9)" fill="url(#ic-nube-osc)" filter="url(#ic-sombra)" />
          <path d="M35 33L24 49h8l-4 13 14-18h-8l5-11z" fill="url(#ic-rayo)" stroke="#C77F00" strokeWidth="1.2" strokeLinejoin="round" filter="url(#ic-sombra)" />
          <path d={GOTA(17, 46)} fill="url(#ic-gota)" />
          <path d={GOTA(48, 46)} fill="url(#ic-gota)" />
        </>
      )}
      {tipo === "viento" && (
        <g fill="none" stroke="#4B5563" strokeWidth="4.5" strokeLinecap="round">
          <path d="M6 24h32a7 7 0 1 0-7-7M6 34h42a7 7 0 1 1-7 7M6 44h22" />
        </g>
      )}
      {tipo === "termometro" && (
        <>
          <rect x="26" y="6" width="12" height="38" rx="6" fill="#FFFFFF" stroke="currentColor" strokeWidth="3" />
          <rect x="30" y="20" width="4" height="26" fill="#FF3B30" />
          <circle cx="32" cy="48" r="10" fill="#FF3B30" stroke="currentColor" strokeWidth="3" />
        </>
      )}
      {tipo === "gota" && (
        <>
          <path d="M32 8s-15 19-15 30a15 15 0 0 0 30 0C47 27 32 8 32 8z" fill="#2F80ED" />
          <path d="M25 40a7 7 0 0 0 7 7" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {tipo === "humedad" && (
        <>
          {/* Humedad relativa: gota contorneada con signo de porcentaje (distinta de la gota llena de lluvia) */}
          <path d="M32 5s-17 21-17 34a17 17 0 0 0 34 0C49 26 32 5 32 5z" fill="#E6F4F1" stroke="#1F8A80" strokeWidth="4" strokeLinejoin="round" />
          <circle cx="25.5" cy="34" r="4" fill="none" stroke="#1F8A80" strokeWidth="3.4" />
          <circle cx="38.5" cy="47" r="4" fill="none" stroke="#1F8A80" strokeWidth="3.4" />
          <path d="M40 31L24 50" stroke="#1F8A80" strokeWidth="3.6" strokeLinecap="round" />
        </>
      )}
      {tipo === "uv" && (
        <>
          {/* Índice UV: sol con rayos separados (distinto del sol de condición del cielo) */}
          <g stroke="#F28C00" strokeWidth="4.5" strokeLinecap="round">
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4;
              return <path key={i} d={`M${(32 + 21 * Math.cos(a)).toFixed(1)} ${(32 + 21 * Math.sin(a)).toFixed(1)}L${(32 + 28 * Math.cos(a)).toFixed(1)} ${(32 + 28 * Math.sin(a)).toFixed(1)}`} />;
            })}
          </g>
          <circle cx="32" cy="32" r="15" fill="url(#ic-sol)" />
        </>
      )}
      {tipo === "rayo" && <path d="M38 4L14 36h14l-6 24 28-34H35l7-22z" fill="#FFC20E" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />}
      {tipo === "luna" && <path d="M40 10a22 22 0 1 0 14 34A18 18 0 1 1 40 10z" fill="#9AA0A8" />}
      {tipo === "alerta" && (
        <>
          {/* Triángulo de advertencia (señal de peligro general) */}
          <path d="M32 6L60 56H4z" fill="#FFC20E" stroke="#111" strokeWidth="4" strokeLinejoin="round" filter="url(#ic-sombra)" />
          <path d="M32 23v17" stroke="#111" strokeWidth="6" strokeLinecap="round" />
          <circle cx="32" cy="48" r="3.6" fill="#111" />
        </>
      )}
      {tipo === "estructura" && (
        <>
          <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round">
            <path d="M10 58V14h44v44M10 24h44M10 14l10 10 10-10 10 10 10-10" />
          </g>
          <rect x="18" y="30" width="28" height="10" rx="2" fill="#FF6A1A" />
        </>
      )}
      {tipo === "corredor" && (
        <>
          <circle cx="38" cy="10" r="6" fill="currentColor" />
          <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 26l10-6 10 6 6 10M32 20l-4 18 10 8 2 14M28 38l-8 10-10 2" />
          </g>
        </>
      )}
    </svg>
  );
}

/** Sol con borde ondulado (centro y radio) */
function SOL(cx: number, cy: number, r: number): string {
  const n = 12, pts: string[] = [];
  for (let k = 0; k <= n * 2; k++) {
    const a = (Math.PI * k) / n;
    const rr = k % 2 ? r * 0.9 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(" L")}Z`;
}
/** Nube de tres lóbulos con base plana, en una caja de ~64×44 */
const NUBE = "M16 46a12 12 0 0 1-1-24 16 16 0 0 1 30-5 12 12 0 0 1 14 11 9 9 0 0 1-2 18z";
function GOTA(x: number, y: number): string {
  return `M${x} ${y - 7}c-3 5-5 8-5 10.5a5 5 0 0 0 10 0c0-2.5-2-5.5-5-10.5z`;
}

/** Ícono del tiempo a partir de una fila de pronóstico */
export function iconoTiempo(p: { precip: number | null; cape: number | null; nubosidad: number | null; radiacion: number | null }, noche = false): TipoIcono {
  const pr = p.precip ?? 0;
  if (pr >= 1 && (p.cape ?? 0) >= 1000) return "tormenta";
  if (pr >= 0.5) return "lluvia";
  const nub = p.nubosidad ?? 0;
  if (nub >= 75) return "nube";
  if (noche) return "luna";
  if (nub >= 30) return "solnube";
  return "sol";
}

/** Condición del cielo en palabras, para acompañar al ícono */
export const CONDICION: Partial<Record<TipoIcono, string>> = {
  sol: "Despejado", luna: "Despejado", solnube: "Parcialmente nublado", nube: "Nublado", lluvia: "Lluvia", tormenta: "Tormenta",
};

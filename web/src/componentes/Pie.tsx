export function Pie() {
  return (
    <footer className="pie no-imprimir">
      <div className="contenedor">
        <div className="firma">
          <img src="/logo-emerteam.png" alt="EMERTEAM · Sports Risks & Emergency Management" />
          <div>
            <span style={{ fontSize: 13, lineHeight: "13.3px", letterSpacing: "0.08em", textTransform: "uppercase", color: "#9A9A9A", fontWeight: 500 }}>
              Dirección técnica
            </span>
            <span style={{ fontSize: 13, lineHeight: "13.3px", color: "#CFCFCF" }}>
              Diego A. Pizzini · Licenciado en Protección Civil y Emergencias
            </span>
          </div>
        </div>
        <div className="linea">
          <span>Recomendaciones profesionales. La decisión final corresponde al organizador.</span>
          <span>www.emerteam.com.ar</span>
        </div>
      </div>
    </footer>
  );
}

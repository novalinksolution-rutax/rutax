import type { Metadata } from "next";
import { FormularioAltaEmpresa } from "./formulario-alta-empresa";

export const metadata: Metadata = {
  title: "Crea tu cuenta de courier",
};

/** Pantalla A — Alta de la empresa (RF-006). Landing pública / auto-servicio. */
export default function PaginaRegistro() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <FormularioAltaEmpresa />
    </div>
  );
}

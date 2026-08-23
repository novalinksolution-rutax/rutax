import type { Metadata } from "next";
import { FormularioAltaEmpresa } from "./formulario-alta-empresa";
import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";

export const metadata: Metadata = {
  title: "Crea tu cuenta de courier",
};

/** Pantalla A — Alta de la empresa (RF-006). Landing pública / auto-servicio. */
export default function PaginaRegistro() {
  return (
    <PantallaSinSesion marca={{ tipo: "rutax" }}>
      <FormularioAltaEmpresa />
    </PantallaSinSesion>
  );
}

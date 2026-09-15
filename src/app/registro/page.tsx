import type { Metadata } from "next";
import { FormularioAltaEmpresa } from "./formulario-alta-empresa";
import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";

export const metadata: Metadata = {
  title: "Crea tu cuenta de courier",
};

interface PaginaRegistroProps {
  searchParams: Promise<{ error?: string }>;
}

/** Pantalla A — Alta de la empresa (RF-006). Landing pública / auto-servicio. */
export default async function PaginaRegistro({ searchParams }: PaginaRegistroProps) {
  const { error } = await searchParams;
  return (
    <PantallaSinSesion marca={{ tipo: "rutax" }}>
      <FormularioAltaEmpresa errorInicial={error} />
    </PantallaSinSesion>
  );
}

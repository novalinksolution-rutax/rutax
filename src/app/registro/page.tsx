import type { Metadata } from "next";
import { FormularioRegistro } from "./formulario-registro";
import { MarcoPuerta } from "@/app/login/marco-puerta";

export const metadata: Metadata = {
  title: "Crea tu cuenta",
};

interface PaginaRegistroProps {
  searchParams: Promise<{ error?: string }>;
}

/** Registro v2, paso 1: identificarse. La empresa se pide en `/registro/empresa`. */
export default async function PaginaRegistro({ searchParams }: PaginaRegistroProps) {
  const { error } = await searchParams;
  return (
    <MarcoPuerta>
      <FormularioRegistro errorInicial={error} />
    </MarcoPuerta>
  );
}

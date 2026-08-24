import { PanelNoEncontrada } from "@/components/ui/panel-no-encontrada";

/** 404 dentro del backstage. */
export default function NoEncontradaAdmin() {
  return (
    <PanelNoEncontrada
      titulo="No encontramos esa página"
      cuerpo="El enlace puede estar mal, o el registro que buscabas ya no existe."
      salida={{ href: "/admin", texto: "Ir al backstage" }}
    />
  );
}

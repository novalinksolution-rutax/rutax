import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import type { PerfilComercial } from "@/lib/ui/perfil-comercial";
import { puedeGestionarPerfilEmpresa } from "@/modules/identidad/capacidades";
import { PantallaConfiguracion } from "../_componentes/pantalla-configuracion";
import { FormularioPerfilComercial } from "./formulario-perfil-comercial";

export const metadata: Metadata = { title: "Tu empresa" };
export const dynamic = "force-dynamic";

export default async function PaginaTuEmpresa() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  // Lectura con la sesión: la RLS (internos del tenant) es la autorización.
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("identidad")
    .from("courier_perfil_comercial")
    .select("envios_dia_rango, conductores_rango, fuentes_pedidos, fuente_otra")
    .eq("tenant_id", sesion.usuario.tenantId)
    .maybeSingle();

  const inicial: PerfilComercial | null = data
    ? {
        enviosDiaRango: data.envios_dia_rango as string,
        conductoresRango: data.conductores_rango as string,
        fuentesPedidos: (data.fuentes_pedidos as string[]) ?? [],
        fuenteOtra: (data.fuente_otra as string | null) ?? null,
      }
    : null;

  return (
    <PantallaConfiguracion titulo="Tu empresa">
      {error ? (
        <p role="alert" className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg">
          No se pudieron cargar las respuestas. Recarga la página.
        </p>
      ) : (
        <FormularioPerfilComercial
          // Al cambiar lo guardado, el formulario se remonta con los valores nuevos.
          key={JSON.stringify(inicial)}
          inicial={inicial}
          puedeEditar={puedeGestionarPerfilEmpresa(sesion.usuario)}
        />
      )}
    </PantallaConfiguracion>
  );
}

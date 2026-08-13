/**
 * Bodegas del seller — Portal, solo lectura (Flujo, alcance "retiro en bodega").
 *
 * Cero botones de acción: las bodegas las carga y edita el courier. El seller
 * solo verifica que la dirección y el contacto sean correctos.
 *
 * A propósito NUNCA se muestra `geo_estado`: el seller no puede corregir la
 * dirección desde aquí, así que un aviso de "no ubicada" solo generaría una
 * llamada al courier sin que el seller pueda hacer nada al respecto.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Phone, Warehouse } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Bodegas",
};

interface BodegaSeller {
  id: string;
  nombre: string;
  direccion: string;
  comuna: string;
  instruccionesAcceso: string | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  esPrincipal: boolean;
  activa: boolean;
}

export default async function PaginaBodegasSeller() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) redirect("/portal");

  const sellerId = sesion.usuario.sellerId;
  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  let bodegas: BodegaSeller[] = [];
  let errorCarga = false;

  try {
    const { data, error } = await supabase
      .schema("identidad")
      .from("seller_bodegas")
      .select(
        "id, nombre, direccion, comuna, instrucciones_acceso, contacto_nombre, contacto_telefono, es_principal, activa",
      )
      .eq("seller_id", sellerId)
      .eq("tenant_id", tenantId)
      .order("activa", { ascending: false })
      .order("es_principal", { ascending: false })
      .order("nombre", { ascending: true });

    if (error) throw error;

    bodegas = (data ?? []).map((f: Record<string, unknown>) => ({
      id: f.id as string,
      nombre: f.nombre as string,
      direccion: f.direccion as string,
      comuna: f.comuna as string,
      instruccionesAcceso: (f.instrucciones_acceso as string | null) ?? null,
      contactoNombre: (f.contacto_nombre as string | null) ?? null,
      contactoTelefono: (f.contacto_telefono as string | null) ?? null,
      esPrincipal: f.es_principal as boolean,
      activa: f.activa as boolean,
    }));
  } catch {
    errorCarga = true;
  }

  const activas = bodegas.filter((b) => b.activa);
  const inactivas = bodegas.filter((b) => !b.activa);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Bodegas</h1>
        <p className="mt-1 text-sm text-muted-foreground">Dónde retira tu courier los pedidos para despacharlos.</p>
      </div>

      {errorCarga && (
        <div role="alert" className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground">
          No se pudo cargar la lista de bodegas. Intenta recargar la página.
        </div>
      )}

      {!errorCarga && bodegas.length === 0 && (
        <EmptyState
          icon={Warehouse}
          tono="arranque"
          titulo="Tu courier todavía no registró ninguna bodega"
          descripcion="Cuando lo haga, vas a ver aquí desde dónde retira tus pedidos."
        />
      )}

      {!errorCarga && bodegas.length > 0 && (
        <div className="space-y-4">
          {activas.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {activas.map((b) => (
                <TarjetaBodegaSoloLectura key={b.id} bodega={b} />
              ))}
            </div>
          )}
          {inactivas.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Inactivas ({inactivas.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {inactivas.map((b) => (
                  <TarjetaBodegaSoloLectura key={b.id} bodega={b} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TarjetaBodegaSoloLectura({ bodega }: { bodega: BodegaSeller }) {
  const tieneContacto = !!(bodega.contactoNombre || bodega.contactoTelefono);

  return (
    <Card className={cn(!bodega.activa && "opacity-60")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Warehouse className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium text-foreground">{bodega.nombre}</p>
          </div>
          {bodega.esPrincipal && <Badge>Principal</Badge>}
        </div>

        <p className="text-sm text-muted-foreground">
          {bodega.direccion}, {bodega.comuna}
        </p>

        {tieneContacto && (
          <div className="flex items-start gap-2 text-sm">
            <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-xs text-muted-foreground">A quién llamar</p>
              <p className="text-foreground">
                {bodega.contactoNombre}
                {bodega.contactoNombre && bodega.contactoTelefono && " · "}
                {bodega.contactoTelefono && (
                  <a href={`tel:${bodega.contactoTelefono}`} className="text-primary hover:underline">
                    {bodega.contactoTelefono}
                  </a>
                )}
              </p>
            </div>
          </div>
        )}

        {bodega.instruccionesAcceso && (
          <p className="text-xs text-muted-foreground">{bodega.instruccionesAcceso}</p>
        )}
      </CardContent>
    </Card>
  );
}

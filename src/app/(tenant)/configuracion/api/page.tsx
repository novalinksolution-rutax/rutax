import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PantallaConfiguracion,
  SinPermisoConfiguracion,
} from "../_componentes/pantalla-configuracion";
import { PanelApiKeys, type ApiKeyRow } from "./panel-api-keys";
import {
  PanelWebhooks,
  type WebhookEndpointRow,
  type AvisoWebhookRow,
} from "./panel-webhooks";

export const metadata: Metadata = {
  title: "API e Integraciones",
};

export default async function PaginaApiIntegraciones() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeGestionarTarifas(sesion.usuario)) {
    return (
      <SinPermisoConfiguracion frase="Las claves de API y los webhooks solo los pueden ver y cambiar el dueño de la cuenta o administración." />
    );
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  const [{ data: keysData }, { data: endpointsData }, { data: avisosData }] = await Promise.all([
    supabase
      .schema("integraciones")
      .from("api_keys")
      .select("id, nombre, prefijo, permisos, estado, ultima_llamada_en, creada_en")
      .eq("tenant_id", tenantId)
      .order("creada_en", { ascending: false }),
    supabase
      .schema("integraciones")
      .from("webhook_endpoints")
      .select("id, url, eventos, activo, reintentos_max, creado_en")
      .eq("tenant_id", tenantId)
      .order("creado_en", { ascending: false }),
    // 🔴 El registro de últimos avisos, que no se mostraba en ninguna parte.
    // La tabla existe desde que existen los webhooks: quien integra no tenía
    // forma de saber si el problema era suyo o nuestro, y preguntaba.
    supabase
      .schema("integraciones")
      .from("webhook_outbox")
      .select("id, endpoint_id, evento_tipo, estado, intento_num, creado_en, enviado_en")
      .eq("tenant_id", tenantId)
      .order("creado_en", { ascending: false })
      .limit(20),
  ]);

  const apiKeys: ApiKeyRow[] = (keysData ?? []).map((k: Record<string, unknown>) => ({
    id: k.id as string,
    nombre: k.nombre as string,
    prefijo: k.prefijo as string,
    permisos: (k.permisos as string[]) ?? [],
    estado: k.estado as "activa" | "revocada",
    ultimaLlamadaEn: (k.ultima_llamada_en as string | null) ?? null,
    creadaEn: k.creada_en as string,
  }));

  const endpoints: WebhookEndpointRow[] = (endpointsData ?? []).map((e: Record<string, unknown>) => ({
    id: e.id as string,
    url: e.url as string,
    eventos: (e.eventos as string[]) ?? [],
    activo: e.activo as boolean,
    reintentoMax: (e.reintentos_max as number) ?? 3,
    creadoEn: e.creado_en as string,
  }));

  const avisos: AvisoWebhookRow[] = (avisosData ?? []).map((a: Record<string, unknown>) => ({
    id: a.id as string,
    endpointId: a.endpoint_id as string,
    eventoTipo: a.evento_tipo as string,
    estado: a.estado as AvisoWebhookRow["estado"],
    intentos: (a.intento_num as number) ?? 0,
    creadoEn: a.creado_en as string,
    enviadoEn: (a.enviado_en as string | null) ?? null,
  }));

  return (
    /* El nombre se homologa con el de la navegación y el del tablero:
       «Integraciones». La ruta sigue siendo `/configuracion/api` —cambiarla
       rompería enlaces guardados— pero el título ya no es un tercer nombre. */
    <PantallaConfiguracion
      titulo="Integraciones"
      bajada="Las credenciales y los avisos con que conectas tus propios sistemas a Rutax."
      ancho="tabla"
    >

      <Tabs defaultValue="api-keys">
        <TabsList>
          <TabsTrigger value="api-keys">
            API Keys
            {apiKeys.filter((k) => k.estado === "activa").length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                {apiKeys.filter((k) => k.estado === "activa").length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="webhooks">
            Webhooks
            {endpoints.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                {endpoints.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="api-keys" className="mt-6">
          <PanelApiKeys apiKeys={apiKeys} />
        </TabsContent>

        <TabsContent value="webhooks" className="mt-6">
          <PanelWebhooks endpoints={endpoints} avisos={avisos} />
        </TabsContent>
      </Tabs>
    </PantallaConfiguracion>
  );
}

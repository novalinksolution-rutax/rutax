import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarTarifas } from "@/modules/identidad/capacidades";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelApiKeys, type ApiKeyRow } from "./panel-api-keys";
import { PanelWebhooks, type WebhookEndpointRow } from "./panel-webhooks";

export const metadata: Metadata = {
  title: "API e Integraciones",
};

export default async function PaginaApiIntegraciones() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeGestionarTarifas(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Sin permiso para ver esta sección</p>
          <p className="text-sm text-muted-foreground">
            La gestión de API keys y webhooks es exclusiva del dueño o administración.
          </p>
        </div>
      </div>
    );
  }

  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  const [{ data: keysData }, { data: endpointsData }] = await Promise.all([
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">API e Integraciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestiona las credenciales y notificaciones para conectar sistemas externos a Rutax.
        </p>
      </div>

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
          <PanelWebhooks endpoints={endpoints} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

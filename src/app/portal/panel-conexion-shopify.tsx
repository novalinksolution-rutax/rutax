"use client";

/**
 * Panel de tiendas Shopify del seller, hermano de `panel-conexion-ml.tsx`.
 *
 * La diferencia de fondo con el de ML no es visual: allá el seller aprieta un
 * botón y Mercado Libre se encarga del resto. Acá tiene que ir a su propio admin
 * de Shopify, crear una app, marcar cuatro permisos y volver con un token. Ese
 * es el paso donde este flujo se rompe en la vida real, así que la pantalla
 * dedica más espacio a explicarlo que a mostrar el estado — y cuando falta un
 * permiso, lo nombra en vez de decir "faltan permisos".
 */

import { useState } from "react";
import { CheckCircle2, Loader2, Plus, RefreshCw, Store, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatearTiempoRelativo } from "@/lib/formato-cl";
import { SCOPES_REQUERIDOS } from "@/modules/integraciones/shopify/tipos";
import {
  conectarTiendaShopify,
  reconectarTiendaShopify,
  type ConexionShopifySeller,
} from "./acciones-shopify";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { tonoSaludConexion } from "@/components/ui/tarjeta-salud-conexion";
import { TEXTO_SALUD_CONEXION } from "@/lib/ui/traduccion-estados";

// ⚠️ Acá vivían DOS mapas propios para los mismos cuatro estados que ya tenían
// nombre en `traduccion-estados.ts` y otra redacción todavía en el panel de ML.
// Tres vocabularios para cuatro estados, y el seller **ve dos de ellos en la
// misma pantalla**: su cuenta de ML «necesita atención» y su tienda Shopify
// está «con problemas» — dos nombres para lo mismo, uno al lado del otro.
// Ahora los dos paneles usan `TarjetaSaludConexion`.

export function PanelConexionesShopify({
  conexionesIniciales,
}: {
  conexionesIniciales: ConexionShopifySeller[];
}) {
  const [abierto, setAbierto] = useState<null | { modo: "alta" } | { modo: "reconexion"; conexion: ConexionShopifySeller }>(
    null,
  );

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Store className="size-4 text-muted-foreground" aria-hidden />
              Mis tiendas Shopify
            </h2>
            <p className="text-sm text-muted-foreground">
              Conecta tu tienda y tus pedidos entrarán solos, sin que tengas que copiar direcciones.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAbierto({ modo: "alta" })}>
            <Plus data-icon="inline-start" aria-hidden />
            Conectar tienda
          </Button>
        </div>

        {conexionesIniciales.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Todavía no tienes ninguna tienda conectada.
          </p>
        ) : (
          <ul className="space-y-2">
            {conexionesIniciales.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-sm font-medium text-foreground">
                    {c.alias ?? c.nombreTienda ?? c.shopDomain}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.shopDomain}
                    {c.ultimaSyncExitosaEn
                      ? ` · al día ${formatearTiempoRelativo(c.ultimaSyncExitosaEn)}`
                      : " · sin sincronizar todavía"}
                  </p>
                  {c.filtroEtiqueta ? (
                    <p className="truncate text-xs text-muted-foreground">
                      Solo pedidos con la etiqueta <span className="font-medium">{c.filtroEtiqueta}</span>
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <DistintivoEstado
                    tono={tonoSaludConexion(c.estadoSalud)}
                    etiqueta={TEXTO_SALUD_CONEXION[c.estadoSalud]}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAbierto({ modo: "reconexion", conexion: c })}
                  >
                    <RefreshCw data-icon="inline-start" aria-hidden />
                    Reconectar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {abierto ? (
        <DialogoTienda
          estado={abierto}
          onCerrar={() => setAbierto(null)}
        />
      ) : null}
    </Card>
  );
}

function DialogoTienda({
  estado,
  onCerrar,
}: {
  estado: { modo: "alta" } | { modo: "reconexion"; conexion: ConexionShopifySeller };
  onCerrar: () => void;
}) {
  const esAlta = estado.modo === "alta";
  const [shopDomain, setShopDomain] = useState(esAlta ? "" : estado.conexion.shopDomain);
  const [token, setToken] = useState("");
  const [etiqueta, setEtiqueta] = useState(esAlta ? "" : (estado.conexion.filtroEtiqueta ?? ""));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopesFaltantes, setScopesFaltantes] = useState<string[]>([]);

  async function enviar() {
    setEnviando(true);
    setError(null);
    setScopesFaltantes([]);

    const resultado = esAlta
      ? await conectarTiendaShopify({
          shopDomain,
          accessToken: token,
          filtroEtiqueta: etiqueta.trim() || null,
        })
      : await reconectarTiendaShopify({ conexionId: estado.conexion.id, accessToken: token });

    setEnviando(false);
    if (resultado.ok) {
      onCerrar();
      return;
    }
    setError(resultado.mensaje);
    setScopesFaltantes(resultado.scopesFaltantes ?? []);
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{esAlta ? "Conectar tu tienda Shopify" : "Reponer el token de acceso"}</DialogTitle>
          <DialogDescription>
            {esAlta
              ? "Necesitamos que crees una app privada en tu tienda y nos pegues su token. Toma unos cinco minutos."
              : "Pega el token nuevo. La tienda y su historial de sincronización se mantienen."}
          </DialogDescription>
        </DialogHeader>

        {esAlta ? (
          <ol className="list-decimal space-y-1.5 rounded-md bg-muted/50 px-5 py-3 text-sm text-muted-foreground">
            <li>
              En el admin de tu tienda, entra a <span className="font-medium text-foreground">Configuración → Apps y canales de venta → Desarrollar apps</span>.
            </li>
            <li>
              Crea una app —ponle el nombre que quieras, por ejemplo <span className="font-medium text-foreground">Rutax</span>— y abre la pestaña de configuración de la Admin API.
            </li>
            <li>
              Marca estos cuatro permisos:
              <ul className="mt-1 space-y-0.5">
                {SCOPES_REQUERIDOS.map((s) => (
                  <li key={s}>
                    <code className="rounded bg-background px-1 py-0.5 text-xs text-foreground">{s}</code>
                  </li>
                ))}
              </ul>
            </li>
            <li>
              Instala la app y copia el <span className="font-medium text-foreground">Admin API access token</span>. Shopify te lo muestra una sola vez.
            </li>
          </ol>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="shopify-dominio">Dominio de tu tienda</Label>
            <Input
              id="shopify-dominio"
              value={shopDomain}
              disabled={!esAlta || enviando}
              onChange={(e) => setShopDomain(e.target.value)}
              placeholder="mi-tienda.myshopify.com"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shopify-token">Admin API access token</Label>
            <Input
              id="shopify-token"
              // `password` para que no quede a la vista de quien pase por detrás
              // ni lo capture un gestor de contraseñas como si fuera un usuario.
              type="password"
              value={token}
              disabled={enviando}
              onChange={(e) => setToken(e.target.value)}
              placeholder="shpat_…"
              autoComplete="off"
            />
          </div>

          {esAlta ? (
            <div className="space-y-1.5">
              <Label htmlFor="shopify-etiqueta">
                Etiqueta para filtrar <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="shopify-etiqueta"
                value={etiqueta}
                disabled={enviando}
                onChange={(e) => setEtiqueta(e.target.value)}
                placeholder="rutax"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Si la dejas vacía, tomamos todos tus pedidos sin despachar que estén dentro de la zona de reparto.
                Si pones una etiqueta, solo tomamos los pedidos que la lleven en Shopify.
              </p>
            </div>
          ) : null}
        </div>

        {error ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertDescription className="space-y-1.5">
              <p>{error}</p>
              {scopesFaltantes.length > 0 ? (
                <ul className="space-y-0.5">
                  {scopesFaltantes.map((s) => (
                    <li key={s}>
                      <code className="rounded bg-background px-1 py-0.5 text-xs">{s}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={enviando || token.trim().length === 0 || shopDomain.trim().length === 0}>
            {enviando ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />
                Comprobando…
              </>
            ) : (
              <>
                <CheckCircle2 data-icon="inline-start" aria-hidden />
                {esAlta ? "Conectar" : "Reconectar"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

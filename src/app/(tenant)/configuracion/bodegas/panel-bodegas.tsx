"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SellerFiltro } from "@/lib/datos-tenant/sellers";
import type { BodegaFila } from "./actions";
import { SeccionBodegasSellers } from "./seccion-bodegas-sellers";
import { SeccionMisBodegas } from "./seccion-mis-bodegas";

interface Props {
  sellers: SellerFiltro[];
  bodegasCourierIniciales: BodegaFila[];
  errorCourierInicial?: string | null;
  /**
   * Monto general del courier por visita — solo lo consume la pestaña de
   * sellers (courier_bodegas no tiene override). `null` si no está configurado.
   */
  montoVisitaDefaultClp: number | null;
}

export function PanelBodegas({
  sellers,
  bodegasCourierIniciales,
  errorCourierInicial = null,
  montoVisitaDefaultClp,
}: Props) {
  return (
    <Tabs defaultValue="sellers">
      <TabsList>
        <TabsTrigger value="sellers">Bodegas de sellers</TabsTrigger>
        <TabsTrigger value="courier">Mis bodegas</TabsTrigger>
      </TabsList>
      <TabsContent value="sellers" className="mt-4">
        <SeccionBodegasSellers sellers={sellers} montoVisitaDefaultClp={montoVisitaDefaultClp} />
      </TabsContent>
      <TabsContent value="courier" className="mt-4">
        <SeccionMisBodegas bodegasIniciales={bodegasCourierIniciales} errorInicial={errorCourierInicial} />
      </TabsContent>
    </Tabs>
  );
}

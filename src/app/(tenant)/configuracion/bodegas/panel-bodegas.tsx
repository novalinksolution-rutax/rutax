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
}

export function PanelBodegas({ sellers, bodegasCourierIniciales, errorCourierInicial = null }: Props) {
  return (
    <Tabs defaultValue="sellers">
      <TabsList>
        <TabsTrigger value="sellers">Bodegas de sellers</TabsTrigger>
        <TabsTrigger value="courier">Mis bodegas</TabsTrigger>
      </TabsList>
      <TabsContent value="sellers" className="mt-4">
        <SeccionBodegasSellers sellers={sellers} />
      </TabsContent>
      <TabsContent value="courier" className="mt-4">
        <SeccionMisBodegas bodegasIniciales={bodegasCourierIniciales} errorInicial={errorCourierInicial} />
      </TabsContent>
    </Tabs>
  );
}

import Link from "next/link";

import { formatearFechaCivilLarga } from "@/lib/formato-cl";
import { BotonImprimir } from "./boton-imprimir";

/**
 * El molde de los dos respaldos imprimibles: el del seller y el del conductor.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 ESTO NO ES UN DOCUMENTO TRIBUTARIO, Y LO DICE EN LA CARA
 * -----------------------------------------------------------------------------
 * Mientras el DTE no esté encendido, este papel es lo único que el seller va a
 * recibir — y un documento con emisor, RUT, receptor, detalle y total **se lee
 * como una factura** aunque nadie lo llame así. Que lo parezca sin serlo es un
 * problema con el SII, no un detalle de redacción: nadie puede usarlo para
 * respaldar crédito fiscal, y quien lo reciba tiene que enterarse **antes** de
 * archivarlo, no cuando su contador se lo pregunte.
 *
 * Por eso el aviso va arriba, en el cuerpo del documento y no al pie: al pie es
 * donde se ponen las cosas que se espera que nadie lea.
 *
 * ⚠️ **Cuando el DTE se encienda, este aviso NO se borra de un plumazo.** El
 * documento sigue siendo el respaldo del detalle; lo que cambia es que ADEMÁS
 * existirá la factura. Retirar el aviso sin que exista el DTE convertiría esto
 * exactamente en lo que se está evitando.
 *
 * -----------------------------------------------------------------------------
 * EL RANGO VA EN EL PAPEL
 * -----------------------------------------------------------------------------
 * Un total sin su período es una cifra que no se puede volver a calcular. Quien
 * reciba la hoja tiene que poder reproducirla.
 */

export interface Parte {
  /** Cómo se llama: razón social del courier, del seller, nombre del conductor. */
  nombre: string;
  rut: string;
}

export function HojaDocumento({
  titulo,
  emisor,
  receptor,
  etiquetaReceptor,
  desde,
  hasta,
  volverA,
  children,
}: {
  titulo: string;
  emisor: Parte;
  receptor: Parte;
  /** «Seller» o «Conductor» — quién es la contraparte de este papel. */
  etiquetaReceptor: string;
  desde: string;
  hasta: string;
  volverA: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={volverA}
          className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          ‹ Volver a la reportería
        </Link>
        <BotonImprimir />
      </div>

      <div className="rounded-lg border bg-card p-8 print:rounded-none print:border-0 print:p-0">
        <header className="border-b pb-5">
          <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Del {formatearFechaCivilLarga(desde)} al {formatearFechaCivilLarga(hasta)}
          </p>
        </header>

        {/* 🔴 Arriba y en el cuerpo. Al pie es donde se ponen las cosas que se
            espera que nadie lea. */}
        <p className="mt-5 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <strong>Este documento no es una factura ni una boleta.</strong> Es el detalle de
          respaldo del período. No sirve para respaldar crédito fiscal ni reemplaza al documento
          tributario correspondiente.
        </p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Emite
            </p>
            <p className="mt-1 font-medium">{emisor.nombre}</p>
            <p className="text-sm text-muted-foreground">RUT {emisor.rut}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {etiquetaReceptor}
            </p>
            <p className="mt-1 font-medium">{receptor.nombre}</p>
            <p className="text-sm text-muted-foreground">RUT {receptor.rut}</p>
          </div>
        </div>

        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

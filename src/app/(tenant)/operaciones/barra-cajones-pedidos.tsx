"use client";

/**
 * La barra de cajones de Pedidos.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ HAY UN PUENTE Y NO SE USA `BarraCajones` DIRECTO
 * -----------------------------------------------------------------------------
 * `page.tsx` es un Server Component y construye sus destinos como cadenas —los
 * filtros viven en la URL, que es lo que permite compartir una vista y volver
 * atrás con el botón del navegador. `BarraCajones` es de cliente y avisa por
 * callback.
 *
 * Este archivo es la costura: recibe los `href` ya armados en el servidor y los
 * navega. **La URL sigue siendo la fuente de verdad del filtro**, que es lo que
 * no había que perder al cambiar de componente.
 *
 * -----------------------------------------------------------------------------
 * LA ARITMÉTICA DE LA BARRA, QUE NO ES OBVIA
 * -----------------------------------------------------------------------------
 * Los cajones **no suman el total, y eso es correcto**:
 *
 * · **cinco cajones suman** — sin asignar, asignado, en ruta, entregado, con
 *   problemas;
 * · **«por revisar» CRUZA los cinco**: un pedido con la dirección por revisar
 *   está además en alguno de ellos, así que sus filas **ya están contadas**.
 *   Meterlo en la suma daría un número mayor que el total;
 * · **«cancelado» queda FUERA**: no está pendiente, no va en ruta y no se
 *   entregó. Va tras el separador, en tono fuera de juego.
 *
 * La barra declara «284 de 291» y muestra la diferencia en vez de explicarla en
 * una nota al pie. ⚠️ **La interfaz no puede mentir sobre esto**: que la suma no
 * dé el total hay que decirlo, no esconderlo.
 *
 * -----------------------------------------------------------------------------
 * 🔴 Y LA REGLA DURA: LOS CONTADORES NO SE PONEN EN CERO
 * -----------------------------------------------------------------------------
 * Si la consulta de cifras falla, la salida fácil es dibujar la barra con ceros.
 * **A las 15:50 eso hace que alguien deje de asignar**: un «Sin asignar 0» se
 * lee como trabajo terminado, no como consulta fallida, y nadie va a sospechar
 * de una cifra que se ve normal.
 *
 * Así que ante una lectura fallida la barra **conserva el último valor que sí
 * leyó y dice de qué hora es**. Y si no llegó a leer ninguno —primera carga—,
 * muestra rayas: «no sé» dicho con todas las letras.
 *
 * ⚠️ **La memoria vive en el módulo, no en un estado de React**, y no es un
 * atajo: el segmento tiene `loading.tsx`, así que cada refresco suspende la
 * página y **desmonta este componente**. Un `useState` se perdería justo en el
 * momento en que hace falta. El módulo no se re-evalúa mientras la pestaña viva.
 *
 * ⚠️ Y se guarda **con la firma del filtro**. Sin eso, filtrar por otro seller
 * tras una caída pintaría las cifras del filtro anterior — que es peor que las
 * rayas, porque parecen ciertas.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { BarraCajones } from "@/components/ui/barra-cajones";
import { formatearHora } from "@/lib/formato-cl";

interface Cajon {
  clave: string;
  etiqueta: string;
  /** `null` = no se pudo leer. Distinto de 0, que afirma que no hay ninguno. */
  conteo: number | null;
}

interface Cifras {
  cajones: Cajon[];
  transversal?: Cajon;
  excluido?: Cajon;
  total: number | null;
  leidoEn: string;
}

/** Lo último que se leyó bien, por firma de filtro. Sobrevive al Suspense. */
const ultimasCifras = new Map<string, Cifras>();

export function BarraCajonesPedidos({
  cajones,
  transversal,
  excluido,
  activo,
  total,
  /** Destino de cada cajón, y el de «todos» bajo la clave vacía. Vienen del servidor. */
  destinos,
  /** `false` cuando la consulta de cifras falló: entonces no se cree ni un número. */
  hayCifras = true,
  /** Identifica el filtro con el que se leyeron estas cifras. */
  firmaFiltro,
}: {
  cajones: Cajon[];
  transversal?: Cajon;
  excluido?: Cajon;
  activo: string | null;
  total: number | null;
  destinos: Record<string, string>;
  hayCifras?: boolean;
  firmaFiltro: string;
}) {
  const router = useRouter();

  // Se recuerda DESPUÉS de pintar, nunca durante el render: en el render de una
  // lectura fallida hace falta leer lo anterior, no escribirlo.
  useEffect(() => {
    if (!hayCifras) return;
    ultimasCifras.set(firmaFiltro, {
      cajones,
      transversal,
      excluido,
      total,
      leidoEn: new Date().toISOString(),
    });
  }, [hayCifras, firmaFiltro, cajones, transversal, excluido, total]);

  const recordadas = hayCifras ? null : (ultimasCifras.get(firmaFiltro) ?? null);
  const enUso = hayCifras
    ? { cajones, transversal, excluido, total, leidoEn: null as string | null }
    : recordadas;

  return (
    <div className="flex flex-col gap-1.5">
      {/* 🔴 **Sin cifras recordadas van rayas, NUNCA ceros.** Un cajón que dice
          «Asignados 0» es una afirmación —y falsa—; «Asignados —» dice lo único
          que sabemos, que es que no lo sabemos. Los cajones siguen siendo
          navegables: el filtro funciona aunque la cifra no se haya podido leer. */}
      <BarraCajones
        cajones={enUso?.cajones ?? cajones.map((c) => ({ ...c, conteo: null }))}
        transversal={enUso?.transversal ?? (transversal && { ...transversal, conteo: null })}
        excluido={enUso?.excluido ?? (excluido && { ...excluido, conteo: null })}
        activo={activo}
        total={enUso?.total ?? null}
        onSeleccionar={(clave) => {
          const destino = destinos[clave ?? ""];
          if (destino) router.push(destino);
        }}
      />

      {!hayCifras && (
        <p className="text-xs text-fault-fg" role="status">
          {enUso?.leidoEn
            ? `No pudimos actualizar las cifras. Éstas son las de las ${formatearHora(enUso.leidoEn)}.`
            : "No pudimos leer las cifras. No son cero: no las pudimos leer."}
        </p>
      )}
    </div>
  );
}

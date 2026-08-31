"use client";

/**
 * Los cuatro campos del bloque Emisor que el SII exige y `tenants` no tenía.
 * =============================================================================
 *
 * Va DENTRO del paso de facturación electrónica y encima del formulario del
 * proveedor, no en un paso aparte: un certificado cargado sin estos cuatro
 * campos no emite igual, así que separarlos dejaría un paso que se puede marcar
 * listo estando incompleto.
 *
 * ⚠️ La actividad económica **no se deduce del giro**. El Acteco es un código de
 * 6 dígitos que el courier tiene en su inicio de actividades; adivinarlo desde
 * un texto libre sería inventar un dato tributario. La ayuda del campo dice
 * dónde encontrarlo en vez de ofrecer un desplegable que sería siempre
 * incompleto.
 *
 * ⚠️ La comuna se elige con el `Select` de shadcn y estado local, como en
 * `configuracion/bodegas/panel-bodega.tsx`: Radix solo emite el campo al
 * `FormData` si es controlado y lleva `name`.
 *
 * -----------------------------------------------------------------------------
 * LA DIRECCIÓN SE BUSCA, NO SE TECLEA
 * -----------------------------------------------------------------------------
 * Es el mismo `CampoDireccion` del alta same-day y de las bodegas (encargo del
 * usuario). Acá no hace falta la coordenada —una dirección tributaria no rutea
 * nada— pero sí lo otro que trae elegir de la lista: la dirección **normalizada
 * por el proveedor y su comuna**. Y eso importa más de lo que parece, porque la
 * comuna es un campo APARTE que va en el mismo documento: tecleando las dos a
 * mano se puede emitir una factura que diga «Av. Providencia 1234» y, debajo,
 * «Maipú». Eligiendo, las dos salen del mismo sitio.
 *
 * ⚠️ **La comuna del buscador puede no estar en el catálogo de la RM.** El
 * reparto es Santiago-only, pero el domicilio TRIBUTARIO del courier puede estar
 * en cualquier parte de Chile. Cuando pasa, la comuna elegida se agrega como
 * opción en vez de descartarse: sin eso el paso quedaba sin poder completarse
 * —el buscador devolvía una comuna que la lista no ofrecía— y ese callejón no se
 * ve hasta que aparece el primer courier de regiones.
 */

import { useState } from "react";

import { CampoDireccion } from "@/components/ui/campo-direccion";
import {
  actionResolverDireccion,
  actionSugerirDirecciones,
} from "@/app/(tenant)/operaciones/nuevo/actions";
import { comunaDelCatalogo } from "@/app/(tenant)/operaciones/nuevo/reglas-alta";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { enmascararRut, limpiarMascaraRut } from "@/lib/formato-cl";
import { esRutValido } from "@/modules/identidad/rut";

import {
  SeccionConfiguracion,
  type ResultadoGuardado,
} from "@/app/(tenant)/configuracion/_componentes/seccion-configuracion";
import { accionGuardarDatosEmisor } from "../acciones-datos-courier";

export interface DatosEmisorIniciales {
  nombreFantasia: string | null;
  razonSocial: string | null;
  rut: string | null;
  giro: string | null;
  direccion: string | null;
  comuna: string | null;
  actividadEconomica: string | null;
}

/** El mismo mensaje que produce el backend, como en `/registro`: el dueño no
 *  debería ver un texto distinto según dónde escriba su RUT. */
const MENSAJE_RUT_INVALIDO = "El dígito verificador no corresponde a este RUT.";
const MENSAJE_RUT_FORMATO = "Ingresa el RUT con el formato 12.345.678-9.";

export function FormularioDatosEmisor({ iniciales }: { iniciales: DatosEmisorIniciales }) {
  const [comuna, setComuna] = useState(iniciales.comuna ?? "");
  const [direccion, setDireccion] = useState(iniciales.direccion ?? "");
  const [direccionElegida, setDireccionElegida] = useState(false);
  // El alta por correo deja el nombre como «Courier de <correo>» (provisional):
  // no se precarga en el campo para no invitar a dejarlo así; si el dueño ya lo
  // fijó antes, sí se muestra. Se distingue por el prefijo.
  const fantasiaProvisional = (iniciales.nombreFantasia ?? "").startsWith("Courier de ");
  const [rut, setRut] = useState(iniciales.rut ?? "");
  const [errorRut, setErrorRut] = useState<string | null>(null);

  function validarRutAlPerderFoco() {
    const limpio = limpiarMascaraRut(rut);
    if (!limpio) return;
    if (!/^[0-9]{1,8}-[0-9kK]$/.test(limpio)) {
      setErrorRut(MENSAJE_RUT_FORMATO);
      return;
    }
    if (!esRutValido(limpio)) setErrorRut(MENSAJE_RUT_INVALIDO);
  }

  // El catálogo de la RM más, si hace falta, la comuna que trajo el buscador o
  // la que ya estaba guardada. Un `Set` para no duplicar la que ya esté.
  const comunasOfrecidas = [...new Set([...COMUNAS_RM, ...(comuna ? [comuna] : [])])];

  async function guardar(datos: FormData): Promise<ResultadoGuardado> {
    const resultado = await accionGuardarDatosEmisor(datos);
    if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };
    return { ok: true, acuse: resultado.acuse };
  }

  return (
    <SeccionConfiguracion
      titulo="Los datos de tu empresa en la factura"
      descripcion="Van impresos en cada documento que emitas y el SII los exige. Complétalos: hasta que estén, no puedes operar."
      etiquetaAccion="Guardar los datos"
      onGuardar={guardar}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="emisor-fantasia">Nombre de tu empresa</Label>
          <Input
            id="emisor-fantasia"
            name="nombre_fantasia"
            required
            maxLength={120}
            defaultValue={fantasiaProvisional ? "" : (iniciales.nombreFantasia ?? "")}
            placeholder="Ej: Despachos del Centro"
          />
          <p className="text-xs text-fg-muted">Es como se llama tu courier en Rutax y en el seguimiento.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="emisor-razon">Razón social</Label>
          <Input
            id="emisor-razon"
            name="razon_social"
            required
            maxLength={160}
            defaultValue={iniciales.razonSocial ?? ""}
            placeholder="Ej: Despachos del Centro SpA"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="emisor-rut">RUT de la empresa</Label>
          {/* El campo visible NO lleva `name`: se envía el RUT ya limpio por un
              hidden, para que el server reciba `NNNNNNNN-DV` sin puntos. */}
          <Input
            id="emisor-rut"
            inputMode="text"
            autoComplete="off"
            required
            placeholder="76.543.210-9"
            value={rut}
            onChange={(e) => {
              setRut(enmascararRut(e.target.value));
              setErrorRut(null);
            }}
            onBlur={validarRutAlPerderFoco}
            aria-invalid={errorRut ? true : undefined}
            aria-describedby={errorRut ? "emisor-rut-error" : undefined}
          />
          <input type="hidden" name="rut" value={limpiarMascaraRut(rut)} />
          {errorRut ? (
            <p id="emisor-rut-error" className="text-xs text-destructive">
              {errorRut}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="emisor-giro">Giro</Label>
          <Input
            id="emisor-giro"
            name="giro"
            required
            maxLength={80}
            defaultValue={iniciales.giro ?? ""}
            placeholder="Ej: Transporte de carga por carretera"
          />
          <p className="text-xs text-fg-muted">Máximo 80 caracteres: es el tope del SII.</p>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="emisor-direccion">Dirección de tu casa matriz</Label>
          <CampoDireccion
            id="emisor-direccion"
            name="direccion"
            required
            placeholder="Empieza a escribir y elígela de la lista"
            valor={direccion}
            elegida={direccionElegida}
            onCambio={(v) => {
              setDireccion(v);
              // Al reescribir a mano se suelta la marca: mantenerla afirmaría
              // que esta dirección la validó el proveedor, y no es cierto.
              if (direccionElegida) setDireccionElegida(false);
            }}
            onElegir={(d) => {
              setDireccion(d.direccion);
              setDireccionElegida(true);
              // La comuna del catálogo si la reconoce; si no, la del proveedor
              // tal cual — ver la nota de cabecera sobre couriers de regiones.
              const elegida = comunaDelCatalogo(d.comuna) ?? d.comuna;
              if (elegida) setComuna(elegida);
            }}
            buscar={actionSugerirDirecciones}
            resolver={actionResolverDireccion}
            // La ayuda va por la prop del componente y no como un `<p>` aparte:
            // él la enlaza con `aria-describedby` al campo.
            ayuda="Elígela de la lista y completamos la comuna sola. Si no aparece, escríbela igual."
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="emisor-comuna">Comuna de tu casa matriz</Label>
          {/* Es la comuna TRIBUTARIA, no una de reparto: no tiene relación con
              las zonas ni con `zona_comunas`. */}
          <Select name="comuna" required value={comuna} onValueChange={setComuna}>
            <SelectTrigger id="emisor-comuna" className="h-9 w-full">
              <SelectValue placeholder="Selecciona una comuna" />
            </SelectTrigger>
            <SelectContent>
              {comunasOfrecidas.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="emisor-actividad">Actividad económica</Label>
          <Input
            id="emisor-actividad"
            name="actividad_economica"
            required
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            defaultValue={iniciales.actividadEconomica ?? ""}
            placeholder="492300"
            className="rx-num"
          />
          <p className="text-xs text-fg-muted">
            Los 6 dígitos del código del SII. Están en tu inicio de actividades.
          </p>
        </div>
      </div>
    </SeccionConfiguracion>
  );
}

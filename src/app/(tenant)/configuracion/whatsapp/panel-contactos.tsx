"use client";

/**
 * Panel de contactos de WhatsApp.
 * =============================================================================
 * Lista los destinatarios del courier y deja darlos de alta, otorgar o revocar
 * su consentimiento, y eliminarlos.
 *
 * -----------------------------------------------------------------------------
 * LA DECISIÓN DE DISEÑO QUE MANDA: EL CONSENTIMIENTO NO ES UNA CASILLA MÁS
 * -----------------------------------------------------------------------------
 * Es la única parte de esta pantalla con consecuencias fuera de Rutax. Por eso:
 *
 *  · La casilla del formulario NO dice «activar avisos», dice que el courier
 *    AFIRMA tener el permiso de esa persona. Es una declaración, no un ajuste.
 *  · Sin marcarla, el contacto se guarda igual pero en `pendiente`, y a un
 *    contacto pendiente no se le escribe nunca. Dar de alta no es consentir.
 *  · Otorgarlo después exige una confirmación explícita (`BotonConfirmado`),
 *    igual que las acciones de dinero — porque queda en la bitácora con nombre
 *    y apellido de quien lo afirmó.
 *
 * Revocar, en cambio, es de un clic y sin fricción: hacer difícil el «no» es
 * exactamente al revés de como debe ser.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { BotonConfirmado } from "@/components/ui/boton-confirmado";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatearFecha } from "@/lib/formato-cl";
import {
  accionCrearContacto,
  accionCambiarConsentimiento,
  accionEliminarContacto,
  type ContactoFila,
  type BodegaOpcion,
  type RolContacto,
  type EstadoConsentimiento,
} from "./actions";

interface SellerOpcion {
  id: string;
  nombre: string;
}

const ROTULO_ROL: Record<RolContacto, string> = {
  seller: "Seller",
  bodega: "Bodega",
  courier: "Tu equipo",
};

/** Qué recibe cada rol. Es lo que el courier necesita para elegir bien. */
const QUE_RECIBE: Record<RolContacto, string> = {
  seller: "Recibe el aviso cuando se retiran pedidos de sus bodegas.",
  bodega: "Recibe los avisos de esa bodega en particular.",
  courier: "Contacto de tu propio equipo, para avisos internos.",
};

function BadgeConsentimiento({ estado }: { estado: EstadoConsentimiento }) {
  if (estado === "otorgado") {
    return <BadgeEstado variante="success" texto="Consentimiento otorgado" />;
  }
  if (estado === "revocado") {
    // No es un error del courier: es alguien que dijo que no. Neutro, no rojo.
    return <BadgeEstado variante="neutral" texto="Dado de baja" />;
  }
  return <BadgeEstado variante="warning" texto="Sin consentimiento" />;
}

// -----------------------------------------------------------------------------
// Formulario de alta
// -----------------------------------------------------------------------------

function FormularioNuevo({
  sellers,
  bodegas,
  onCreado,
}: {
  sellers: SellerOpcion[];
  bodegas: BodegaOpcion[];
  onCreado: () => void;
}) {
  const [rol, setRol] = useState<RolContacto>("seller");
  const [sellerId, setSellerId] = useState<string>("");
  const [bodegaId, setBodegaId] = useState<string>("");
  const [telefono, setTelefono] = useState("");
  const [etiqueta, setEtiqueta] = useState("");
  const [declara, setDeclara] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    iniciar(async () => {
      const resultado = await accionCrearContacto({
        rol,
        sellerId: rol === "seller" ? sellerId : null,
        bodegaId: rol === "bodega" ? bodegaId : null,
        telefono,
        etiqueta,
        declaraConsentimiento: declara,
      });
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setTelefono("");
      setEtiqueta("");
      setDeclara(false);
      onCreado();
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="rol">¿A quién pertenece?</Label>
          <Select value={rol} onValueChange={(v) => setRol(v as RolContacto)}>
            <SelectTrigger id="rol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="seller">Un seller</SelectItem>
              <SelectItem value="bodega">Una bodega</SelectItem>
              <SelectItem value="courier">Tu equipo</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-fg-muted">{QUE_RECIBE[rol]}</p>
        </div>

        {rol === "seller" && (
          <div className="space-y-2">
            <Label htmlFor="seller">Seller</Label>
            <Select value={sellerId} onValueChange={setSellerId}>
              <SelectTrigger id="seller">
                <SelectValue placeholder="Elige un seller" />
              </SelectTrigger>
              <SelectContent>
                {sellers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {rol === "bodega" && (
          <div className="space-y-2">
            <Label htmlFor="bodega">Bodega</Label>
            <Select value={bodegaId} onValueChange={setBodegaId}>
              <SelectTrigger id="bodega">
                <SelectValue placeholder="Elige una bodega" />
              </SelectTrigger>
              <SelectContent>
                {bodegas.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.nombre} · {b.sellerNombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="telefono">Teléfono</Label>
          <Input
            id="telefono"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="+56 9 1234 5678"
            autoComplete="off"
            required
          />
          <p className="text-sm text-fg-muted">
            Da lo mismo cómo lo escribas: se guarda en el formato que exige WhatsApp.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="etiqueta">Nombre de referencia (opcional)</Label>
          <Input
            id="etiqueta"
            value={etiqueta}
            onChange={(e) => setEtiqueta(e.target.value)}
            placeholder="Jefe de bodega"
            autoComplete="off"
          />
          <p className="text-sm text-fg-muted">Para que lo reconozcas en esta lista. No viaja en el mensaje.</p>
        </div>
      </div>

      {/*
        La declaración. Va destacada y separada del resto de los campos a
        propósito: es lo único de este formulario con consecuencias fuera de
        Rutax, y no puede leerse como una casilla de configuración más.
      */}
      <div className="flex items-start gap-3 rounded-md border border-border bg-bg-subtle p-3">
        <Checkbox
          id="declara"
          checked={declara}
          onCheckedChange={(v) => setDeclara(v === true)}
          className="mt-0.5"
        />
        <Label htmlFor="declara" className="cursor-pointer text-sm font-normal leading-relaxed">
          <span className="font-medium">Declaro que este contacto aceptó recibir mensajes de WhatsApp.</span>{" "}
          Sin esto el contacto se guarda igual, pero no se le escribe. Queda registrado quién lo
          declaró y cuándo.
        </Label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Agregar contacto"}
        </Button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Fila
// -----------------------------------------------------------------------------

function FilaContacto({ contacto, onCambio }: { contacto: ContactoFila; onCambio: () => void }) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cambiarConsentimiento(otorgar: boolean) {
    setError(null);
    iniciar(async () => {
      const r = await accionCambiarConsentimiento(contacto.id, otorgar);
      if (!r.ok) setError(r.mensaje);
      else onCambio();
    });
  }

  function eliminar() {
    setError(null);
    iniciar(async () => {
      const r = await accionEliminarContacto(contacto.id);
      if (!r.ok) setError(r.mensaje);
      else onCambio();
    });
  }

  return (
    <li className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-fg">{contacto.perteneceA}</span>
          <BadgeEstado variante="neutral" texto={ROTULO_ROL[contacto.rol]} conPunto={false} />
          <BadgeConsentimiento estado={contacto.optInEstado} />
        </div>
        <p className="text-sm text-fg-muted">
          <span className="font-mono">{contacto.telefonoEnmascarado}</span>
          {contacto.etiqueta ? ` · ${contacto.etiqueta}` : ""}
          {contacto.optInEstado === "otorgado" && contacto.optInEn
            ? ` · consintió el ${formatearFecha(contacto.optInEn)}`
            : ""}
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {contacto.optInEstado === "otorgado" ? (
          // Revocar es de un clic: poner fricción en el «no» es al revés de
          // como debe ser.
          <Button
            variant="outline"
            size="sm"
            onClick={() => cambiarConsentimiento(false)}
            disabled={pendiente}
          >
            Dar de baja
          </Button>
        ) : (
          <BotonConfirmado
            size="sm"
            titulo="Vas a activar los avisos de WhatsApp a este contacto"
            consecuencia={
              <>
                Rutax va a escribirle a <strong>{contacto.perteneceA}</strong> desde el número
                oficial. Solo confirma si esa persona aceptó recibir estos mensajes: queda
                registrado a tu nombre.
              </>
            }
            textoConfirmar="Sí, tengo su consentimiento"
            cargando={pendiente}
            onConfirmar={() => cambiarConsentimiento(true)}
            etiqueta="Activar avisos"
          />
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={eliminar}
          disabled={pendiente}
          aria-label={`Eliminar el contacto de ${contacto.perteneceA}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );
}

// -----------------------------------------------------------------------------
// Panel
// -----------------------------------------------------------------------------

export function PanelContactosWhatsApp({
  contactosIniciales,
  errorInicial,
  bodegas,
  sellers,
}: {
  contactosIniciales: ContactoFila[];
  errorInicial: string | null;
  bodegas: BodegaOpcion[];
  sellers: SellerOpcion[];
}) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      {errorInicial && <p className="text-sm text-danger">{errorInicial}</p>}

      <FormularioNuevo sellers={sellers} bodegas={bodegas} onCreado={() => router.refresh()} />

      {contactosIniciales.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          titulo="Todavía no hay contactos"
          descripcion="Sin un contacto con consentimiento, los avisos de WhatsApp no salen: el sistema no tiene a quién escribirle y no da ningún error."
        />
      ) : (
        <ul className="rounded-lg border border-border bg-card px-4">
          {contactosIniciales.map((c) => (
            <FilaContacto key={c.id} contacto={c} onCambio={() => router.refresh()} />
          ))}
        </ul>
      )}
    </div>
  );
}

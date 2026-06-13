"use client";

/**
 * Pantalla G — Tarifas iniciales: panel de cliente.
 *
 * "Lo simple primero, lo específico después" (§1.2):
 *   1. Tarifa por defecto del tenant — un formulario simple, siempre visible,
 *      es lo único obligatorio para que este paso cuente como "completo".
 *   2. Tarifas específicas — sección colapsada por defecto ("Agregar tarifa
 *      específica por seller o zona"), con los selectores de seller/zona que
 *      no se muestran de entrada para no intimidar al dueño que solo necesita
 *      arrancar.
 *   3. Listado de tarifas vigentes — una tabla con todo, incluida la tarifa
 *      por defecto ("Todos los sellers · Tarifa por defecto").
 *
 * Montos en CLP: formato de miles, sin decimales — "$ 2.500", nunca "$2500.00"
 * (criterio de localización repetido en CLAUDE.md y en esta pantalla).
 */

import { useMemo, useState, useTransition, type FormEvent } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Receipt,
  ShieldAlert,
  RefreshCw,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EstadoError, EstadoVacio } from "@/components/onboarding/estado-pantalla";
import { formatearClp, formatearFecha } from "@/lib/formato-cl";
import {
  crearTarifa,
  desactivarTarifa,
  type EstadoTarifas,
  type TarifaListado,
  type TipoEntrega,
} from "./actions";

const ETIQUETAS_TIPO_ENTREGA: Record<TipoEntrega, string> = {
  flex: "Flex",
  same_day: "Same-day",
};

function hoyEnSantiago(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }); // YYYY-MM-DD
}

/** Acepta solo dígitos y los devuelve como número — el input se formatea para mostrar miles. */
function soloDigitos(valor: string): string {
  return valor.replace(/[^\d]/g, "");
}

interface Props {
  estadoInicial: EstadoTarifas | null;
  errorInicial: string | null;
}

export function PanelTarifas({ estadoInicial, errorInicial }: Props) {
  const [estado, setEstado] = useState<EstadoTarifas | null>(estadoInicial);
  const [errorCarga, setErrorCarga] = useState<string | null>(errorInicial);
  const [recargando, setRecargando] = useState(false);

  async function recargar() {
    setRecargando(true);
    try {
      const { obtenerEstadoTarifas } = await import("./actions");
      const resultado = await obtenerEstadoTarifas();
      if (resultado.ok) {
        setEstado(resultado.estado);
        setErrorCarga(null);
      } else {
        setErrorCarga(resultado.mensaje);
      }
    } finally {
      setRecargando(false);
    }
  }

  if (errorCarga && !estado) {
    return <EstadoError descripcion={errorCarga} onReintentar={recargar} reintentando={recargando} />;
  }
  if (!estado) {
    return (
      <EstadoError
        descripcion="No pudimos preparar esta pantalla. Recarga para intentarlo de nuevo."
        onReintentar={recargar}
        reintentando={recargando}
      />
    );
  }

  const tieneDefecto = estado.tarifas.some((t) => t.sellerId === null && t.estado === "activa");

  function agregarTarifa(tarifa: TarifaListado) {
    setEstado((anterior) => (anterior ? { ...anterior, tarifas: [tarifa, ...anterior.tarifas] } : anterior));
  }

  function marcarInactiva(tarifaId: string) {
    setEstado((anterior) =>
      anterior
        ? {
            ...anterior,
            tarifas: anterior.tarifas.map((t) =>
              t.id === tarifaId ? { ...t, estado: "inactiva", vigenteHasta: hoyEnSantiago() } : t,
            ),
          }
        : anterior,
    );
  }

  return (
    <div className="space-y-6">
      <FormularioTarifaPorDefecto tieneDefecto={tieneDefecto} onCreada={agregarTarifa} />
      <SeccionTarifasEspecificas sellers={estado.sellers} onCreada={agregarTarifa} />
      <ListadoTarifas tarifas={estado.tarifas} onDesactivada={marcarInactiva} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// 1. Tarifa por defecto del tenant — obligatoria para "completar" el paso
// -----------------------------------------------------------------------------

function FormularioTarifaPorDefecto({
  tieneDefecto,
  onCreada,
}: {
  tieneDefecto: boolean;
  onCreada: (tarifa: TarifaListado) => void;
}) {
  const [tipoEntrega, setTipoEntrega] = useState<TipoEntrega | "">("");
  const [montoTexto, setMontoTexto] = useState("");
  const [vigenteDesde, setVigenteDesde] = useState(hoyEnSantiago());
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  const montoNumerico = Number(soloDigitos(montoTexto)) || 0;

  function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setExito(null);

    if (!tipoEntrega) {
      setError("Elige el tipo de entrega para esta tarifa.");
      return;
    }
    if (montoNumerico <= 0) {
      setError("Ingresa un monto en pesos chilenos mayor a cero.");
      return;
    }
    if (!vigenteDesde) {
      setError("Indica desde qué fecha rige esta tarifa.");
      return;
    }

    iniciarTransicion(async () => {
      const resultado = await crearTarifa({
        sellerId: null,
        tipoEntrega,
        zona: null,
        montoClp: montoNumerico,
        vigenteDesde,
      });
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      onCreada({
        id: crypto.randomUUID(),
        sellerId: null,
        sellerNombre: null,
        tipoEntrega,
        zona: null,
        montoClp: montoNumerico,
        vigenteDesde,
        vigenteHasta: null,
        estado: "activa",
      });
      setExito(`Tarifa por defecto de ${formatearClp(montoNumerico)} guardada para ${ETIQUETAS_TIPO_ENTREGA[tipoEntrega]}.`);
      setTipoEntrega("");
      setMontoTexto("");
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Receipt className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-base">Tarifa por defecto</CardTitle>
          <CardDescription>
            {tieneDefecto
              ? "Ya tienes una tarifa por defecto activa — puedes agregar otra para un tipo de entrega distinto."
              : "Define un monto base para empezar — podrás ajustar por seller o zona cuando lo necesites."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={manejarEnvio} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tarifa-defecto-tipo">Tipo de entrega</Label>
              <Select value={tipoEntrega} onValueChange={(valor) => { setTipoEntrega(valor as TipoEntrega); setError(null); }}>
                <SelectTrigger id="tarifa-defecto-tipo" className="w-full">
                  <SelectValue placeholder="Selecciona un tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flex">Flex</SelectItem>
                  <SelectItem value="same_day">Same-day</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tarifa-defecto-monto">Monto por entrega (CLP)</Label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
                <Input
                  id="tarifa-defecto-monto"
                  inputMode="numeric"
                  className="pl-6"
                  placeholder="2.500"
                  value={montoTexto ? Number(soloDigitos(montoTexto)).toLocaleString("es-CL") : ""}
                  onChange={(evento) => setMontoTexto(soloDigitos(evento.target.value))}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2 sm:max-w-52">
            <Label htmlFor="tarifa-defecto-desde">Vigente desde</Label>
            <Input
              id="tarifa-defecto-desde"
              type="date"
              value={vigenteDesde}
              onChange={(evento) => setVigenteDesde(evento.target.value)}
            />
          </div>

          {error ? (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {exito ? (
            <Alert className="bg-success-subtle text-success-subtle-foreground">
              <CheckCircle2 className="text-success" />
              <AlertDescription className="text-success-subtle-foreground">{exito}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={pendiente}>
            {pendiente ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : null}
            {pendiente ? "Guardando…" : "Guardar tarifa por defecto"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// 2. Tarifas específicas — sección colapsada por defecto (§1.2)
// -----------------------------------------------------------------------------

function SeccionTarifasEspecificas({
  sellers,
  onCreada,
}: {
  sellers: EstadoTarifas["sellers"];
  onCreada: (tarifa: TarifaListado) => void;
}) {
  const [expandida, setExpandida] = useState(false);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setExpandida((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
        aria-expanded={expandida}
      >
        <div className="space-y-1">
          <p className="font-medium text-foreground">Agregar tarifa específica por seller o zona</p>
          <p className="text-sm text-muted-foreground">
            Opcional — útil cuando necesitas cobrar distinto a un seller en particular o por zona geográfica.
          </p>
        </div>
        {expandida ? (
          <ChevronUp className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {expandida ? (
        <CardContent className="border-t pt-5">
          <FormularioTarifaEspecifica sellers={sellers} onCreada={onCreada} onListo={() => setExpandida(false)} />
        </CardContent>
      ) : null}
    </Card>
  );
}

function FormularioTarifaEspecifica({
  sellers,
  onCreada,
  onListo,
}: {
  sellers: EstadoTarifas["sellers"];
  onCreada: (tarifa: TarifaListado) => void;
  onListo: () => void;
}) {
  const [sellerId, setSellerId] = useState<string>("__todos__");
  const [zona, setZona] = useState("");
  const [tipoEntrega, setTipoEntrega] = useState<TipoEntrega | "">("");
  const [montoTexto, setMontoTexto] = useState("");
  const [vigenteDesde, setVigenteDesde] = useState(hoyEnSantiago());
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  const montoNumerico = Number(soloDigitos(montoTexto)) || 0;

  function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);

    if (!tipoEntrega) {
      setError("Elige el tipo de entrega para esta tarifa.");
      return;
    }
    if (montoNumerico <= 0) {
      setError("Ingresa un monto en pesos chilenos mayor a cero.");
      return;
    }
    if (!vigenteDesde) {
      setError("Indica desde qué fecha rige esta tarifa.");
      return;
    }

    const sellerSeleccionado = sellerId === "__todos__" ? null : sellerId;
    const zonaLimpia = zona.trim() || null;

    if (!sellerSeleccionado && !zonaLimpia) {
      setError("Una tarifa específica necesita un seller, una zona, o ambos — si no, usa la tarifa por defecto.");
      return;
    }

    iniciarTransicion(async () => {
      const resultado = await crearTarifa({
        sellerId: sellerSeleccionado,
        tipoEntrega,
        zona: zonaLimpia,
        montoClp: montoNumerico,
        vigenteDesde,
      });
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      onCreada({
        id: crypto.randomUUID(),
        sellerId: sellerSeleccionado,
        sellerNombre: sellerSeleccionado ? (sellers.find((s) => s.id === sellerSeleccionado)?.nombre ?? null) : null,
        tipoEntrega,
        zona: zonaLimpia,
        montoClp: montoNumerico,
        vigenteDesde,
        vigenteHasta: null,
        estado: "activa",
      });
      setSellerId("__todos__");
      setZona("");
      setTipoEntrega("");
      setMontoTexto("");
      onListo();
    });
  }

  return (
    <form onSubmit={manejarEnvio} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="tarifa-especifica-seller">Seller</Label>
          <Select value={sellerId} onValueChange={setSellerId}>
            <SelectTrigger id="tarifa-especifica-seller" className="w-full">
              <SelectValue placeholder="Todos los sellers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos__">Todos los sellers</SelectItem>
              {sellers.map((seller) => (
                <SelectItem key={seller.id} value={seller.id}>
                  {seller.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sellers.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aún no tienes sellers — puedes igual definir una tarifa por zona.</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="tarifa-especifica-zona">Zona (opcional)</Label>
          <Input
            id="tarifa-especifica-zona"
            value={zona}
            onChange={(evento) => setZona(evento.target.value)}
            placeholder="Ej: Las Condes"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="tarifa-especifica-tipo">Tipo de entrega</Label>
          <Select value={tipoEntrega} onValueChange={(valor) => { setTipoEntrega(valor as TipoEntrega); setError(null); }}>
            <SelectTrigger id="tarifa-especifica-tipo" className="w-full">
              <SelectValue placeholder="Selecciona un tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flex">Flex</SelectItem>
              <SelectItem value="same_day">Same-day</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tarifa-especifica-monto">Monto por entrega (CLP)</Label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
            <Input
              id="tarifa-especifica-monto"
              inputMode="numeric"
              className="pl-6"
              placeholder="3.000"
              value={montoTexto ? Number(soloDigitos(montoTexto)).toLocaleString("es-CL") : ""}
              onChange={(evento) => setMontoTexto(soloDigitos(evento.target.value))}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2 sm:max-w-52">
        <Label htmlFor="tarifa-especifica-desde">Vigente desde</Label>
        <Input
          id="tarifa-especifica-desde"
          type="date"
          value={vigenteDesde}
          onChange={(evento) => setVigenteDesde(evento.target.value)}
        />
      </div>

      {error ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" variant="outline" disabled={pendiente}>
        {pendiente ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : null}
        {pendiente ? "Guardando…" : "Guardar tarifa específica"}
      </Button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// 3. Listado de tarifas vigentes
// -----------------------------------------------------------------------------

function ListadoTarifas({
  tarifas,
  onDesactivada,
}: {
  tarifas: TarifaListado[];
  onDesactivada: (tarifaId: string) => void;
}) {
  const activas = useMemo(() => tarifas.filter((t) => t.estado === "activa"), [tarifas]);
  const inactivas = useMemo(() => tarifas.filter((t) => t.estado === "inactiva"), [tarifas]);

  if (tarifas.length === 0) {
    return (
      <EstadoVacio
        icono={<Receipt className="size-8" aria-hidden="true" />}
        titulo="Aún no tienes tarifas configuradas"
        descripcion="Define un monto base para empezar — podrás ajustar por seller o zona cuando lo necesites."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tarifas vigentes</CardTitle>
        <CardDescription>Cada cambio crea una nueva versión — el histórico se conserva para futuras liquidaciones.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Seller</TableHead>
                <TableHead>Tipo de entrega</TableHead>
                <TableHead>Zona</TableHead>
                <TableHead>Monto</TableHead>
                <TableHead>Vigencia</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...activas, ...inactivas].map((tarifa) => (
                <FilaTarifa key={tarifa.id} tarifa={tarifa} onDesactivada={onDesactivada} />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function FilaTarifa({
  tarifa,
  onDesactivada,
}: {
  tarifa: TarifaListado;
  onDesactivada: (tarifaId: string) => void;
}) {
  const [pendiente, iniciarTransicion] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function manejarDesactivar() {
    setError(null);
    iniciarTransicion(async () => {
      const resultado = await desactivarTarifa(tarifa.id);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      onDesactivada(tarifa.id);
    });
  }

  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">
        {tarifa.sellerId ? (tarifa.sellerNombre ?? "Seller") : "Todos — tarifa por defecto"}
      </TableCell>
      <TableCell className="text-muted-foreground">{ETIQUETAS_TIPO_ENTREGA[tarifa.tipoEntrega]}</TableCell>
      <TableCell className="text-muted-foreground">{tarifa.zona ?? "Todas"}</TableCell>
      <TableCell className="font-medium text-foreground">{formatearClp(tarifa.montoClp)}</TableCell>
      <TableCell className="text-muted-foreground">
        {formatearFecha(tarifa.vigenteDesde)}
        {tarifa.vigenteHasta ? ` – ${formatearFecha(tarifa.vigenteHasta)}` : " – sin término"}
      </TableCell>
      <TableCell>
        {tarifa.estado === "activa" ? (
          <Badge variant="outline" className="border-success-subtle text-success">
            Activa
          </Badge>
        ) : (
          <Badge variant="outline">Inactiva</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        {tarifa.estado === "activa" ? (
          <div className="flex flex-col items-end gap-1">
            <Button variant="ghost" size="sm" onClick={manejarDesactivar} disabled={pendiente}>
              {pendiente ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : null}
              {pendiente ? "Desactivando…" : "Desactivar"}
            </Button>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

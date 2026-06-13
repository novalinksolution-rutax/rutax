"use client";

/**
 * Pantalla F — Folios CAF: panel de cliente.
 *
 * Renderiza UNA de tres variantes según `caso` (resuelto en el servidor a
 * partir del proveedor DTE elegido — §1.2 "se decide en tiempo de ejecución"):
 *   - `sin_proveedor`: pantalla bloqueada con enlace de vuelta a la Pantalla E.
 *   - `gestionado_por_proveedor` (Caso A): solo-lectura/estado, sin captura.
 *   - `carga_manual` (Caso B): formulario de carga + listado con consumo.
 *
 * Mismo patrón de secretos que el certificado digital: "se guardó cifrado, no
 * se muestra el contenido" — el archivo `.xml` jamás vuelve a la pantalla,
 * solo sus metadatos (rango, tipo de documento, estado, consumo).
 */

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  FileText,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EstadoError, EstadoVacio } from "@/components/onboarding/estado-pantalla";
import {
  cargarRangoCaf,
  type EstadoFoliosCaf,
  type FolioCaf,
} from "./actions";
import { TIPOS_DOCUMENTO_DTE, etiquetaTipoDocumento } from "./catalogo";

interface Props {
  estadoInicial: EstadoFoliosCaf | null;
  errorInicial: string | null;
}

export function PanelFoliosCaf({ estadoInicial, errorInicial }: Props) {
  const [estado, setEstado] = useState<EstadoFoliosCaf | null>(estadoInicial);
  const [errorCarga, setErrorCarga] = useState<string | null>(errorInicial);
  const [recargando, setRecargando] = useState(false);

  async function recargar() {
    setRecargando(true);
    try {
      const { obtenerEstadoFoliosCaf } = await import("./actions");
      const resultado = await obtenerEstadoFoliosCaf();
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

  if (estado.caso === "sin_proveedor") {
    return (
      <EstadoVacio
        icono={<ShieldAlert className="size-8" aria-hidden="true" />}
        titulo="Configura primero tu proveedor DTE"
        descripcion="Tus folios dependen de qué proveedor de facturación elijas — algunos los gestionan ellos directo con el SII, otros piden que tú los cargues."
        accion={
          <Button asChild>
            <Link href="/onboarding/dte">Ir a configuración DTE</Link>
          </Button>
        }
      />
    );
  }

  if (estado.caso === "gestionado_por_proveedor") {
    return (
      <Card>
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-subtle text-success-subtle-foreground">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Tu proveedor gestiona tus folios</CardTitle>
              <Badge variant="outline" className="border-success-subtle text-success">
                Sin acción de tu parte
              </Badge>
            </div>
            <CardDescription>
              {estado.nombreProveedor} gestiona tus folios directamente con el SII. No necesitas hacer nada aquí —
              cuando emitas documentos, los folios se solicitan y se descuentan automáticamente.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
  }

  // Caso B — carga manual
  return (
    <div className="space-y-6">
      <FormularioCargaCaf onCargado={(folio) => setEstado((anterior) => anterior && { ...anterior, folios: [...anterior.folios, folio] })} />
      <ListaFolios folios={estado.folios} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Formulario de carga (Caso B) — mismo patrón de interacción que el certificado
// -----------------------------------------------------------------------------

function FormularioCargaCaf({ onCargado }: { onCargado: (folio: FolioCaf) => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [tipoDocumento, setTipoDocumento] = useState<string>("");
  const [folioDesde, setFolioDesde] = useState("");
  const [folioHasta, setFolioHasta] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setExito(null);

    if (!archivo) {
      setError("Selecciona el archivo CAF (.xml) que descargaste del SII.");
      return;
    }
    if (!tipoDocumento) {
      setError("Elige el tipo de documento de la lista.");
      return;
    }
    const desde = Number(folioDesde);
    const hasta = Number(folioHasta);
    if (!folioDesde || !folioHasta || !Number.isFinite(desde) || !Number.isFinite(hasta) || desde <= 0 || hasta <= 0) {
      setError("Ingresa el rango de folios (números mayores a cero).");
      return;
    }
    if (desde > hasta) {
      setError("El folio inicial no puede ser mayor que el folio final — revisa el rango que indicaste.");
      return;
    }

    const formData = new FormData();
    formData.set("archivo", archivo);
    formData.set("tipoDocumento", tipoDocumento);
    formData.set("folioDesde", folioDesde);
    formData.set("folioHasta", folioHasta);

    iniciarTransicion(async () => {
      const resultado = await cargarRangoCaf(formData);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      onCargado({
        id: crypto.randomUUID(),
        tipoDocumento: desde && Number(tipoDocumento),
        folioDesde: desde,
        folioHasta: hasta,
        folioActual: desde,
        estado: "vigente",
      });
      setExito(`Folios ${desde}-${hasta} cargados y cifrados correctamente.`);
      setArchivo(null);
      setTipoDocumento("");
      setFolioDesde("");
      setFolioHasta("");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cargar un nuevo rango de folios</CardTitle>
        <CardDescription>
          El archivo CAF se cifra antes de guardarse — no podrás volver a descargarlo desde aquí, solo ver su rango y
          estado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={manejarEnvio} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="caf-tipo-documento">Tipo de documento</Label>
            <Select value={tipoDocumento} onValueChange={(valor) => { setTipoDocumento(valor); setError(null); }}>
              <SelectTrigger id="caf-tipo-documento" className="w-full">
                <SelectValue placeholder="Selecciona un tipo de documento" />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_DOCUMENTO_DTE.map((tipo) => (
                  <SelectItem key={tipo.codigo} value={String(tipo.codigo)}>
                    {tipo.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="caf-folio-desde">Folio inicial</Label>
              <Input
                id="caf-folio-desde"
                type="number"
                min={1}
                inputMode="numeric"
                value={folioDesde}
                onChange={(evento) => setFolioDesde(evento.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="caf-folio-hasta">Folio final</Label>
              <Input
                id="caf-folio-hasta"
                type="number"
                min={1}
                inputMode="numeric"
                value={folioHasta}
                onChange={(evento) => setFolioHasta(evento.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="caf-archivo">Archivo CAF (.xml)</Label>
            <Input
              id="caf-archivo"
              type="file"
              accept=".xml"
              onChange={(evento) => setArchivo(evento.target.files?.[0] ?? null)}
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
          {pendiente ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              Cifrando y guardando — no cierres esta ventana.
            </p>
          ) : null}

          <Button type="submit" disabled={pendiente}>
            {pendiente ? "Guardando…" : "Cargar folios"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Listado con estado y barra de consumo (§1.2)
// -----------------------------------------------------------------------------

function ListaFolios({ folios }: { folios: FolioCaf[] }) {
  if (folios.length === 0) {
    return (
      <EstadoVacio
        icono={<FileText className="size-8" aria-hidden="true" />}
        titulo="Aún no has cargado folios"
        descripcion="Carga tu primer archivo CAF para poder timbrar documentos tributarios."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Folios cargados</CardTitle>
        <CardDescription>Estado y consumo de cada rango. El contenido del archivo permanece cifrado.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo de documento</TableHead>
                <TableHead>Rango</TableHead>
                <TableHead>Consumo</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {folios.map((folio) => (
                <FilaFolio key={folio.id} folio={folio} />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

const UMBRAL_CONSUMO_ALTO = 0.85; // 85% del rango usado — "por agotarse" (§1.2)

function FilaFolio({ folio }: { folio: FolioCaf }) {
  const total = folio.folioHasta - folio.folioDesde + 1;
  const usados = Math.min(Math.max(folio.folioActual - folio.folioDesde, 0), total);
  const porcentaje = total > 0 ? Math.round((usados / total) * 100) : 0;
  const porAgotarse = folio.estado === "vigente" && usados / total >= UMBRAL_CONSUMO_ALTO;

  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">{etiquetaTipoDocumento(folio.tipoDocumento)}</TableCell>
      <TableCell className="text-muted-foreground">
        {folio.folioDesde.toLocaleString("es-CL")} – {folio.folioHasta.toLocaleString("es-CL")}
      </TableCell>
      <TableCell className="min-w-40">
        <div className="space-y-1">
          <Progress value={porcentaje} className={porAgotarse ? "[&>div]:bg-warning" : undefined} />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>
              {usados.toLocaleString("es-CL")} de {total.toLocaleString("es-CL")} usados ({porcentaje}%)
            </span>
            {porAgotarse ? (
              <span className="inline-flex items-center gap-1 text-warning-subtle-foreground">
                <TriangleAlert className="size-3" aria-hidden="true" /> por agotarse
              </span>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <BadgeEstadoFolio estado={folio.estado} />
      </TableCell>
    </TableRow>
  );
}

function BadgeEstadoFolio({ estado }: { estado: FolioCaf["estado"] }) {
  switch (estado) {
    case "vigente":
      return (
        <Badge variant="outline" className="border-success-subtle text-success">
          <Lock className="size-3" aria-hidden="true" /> Vigente
        </Badge>
      );
    case "agotado":
      return <Badge variant="outline">Agotado</Badge>;
    case "vencido":
      return <Badge variant="destructive">Vencido</Badge>;
    default:
      return <Badge variant="outline">{estado}</Badge>;
  }
}

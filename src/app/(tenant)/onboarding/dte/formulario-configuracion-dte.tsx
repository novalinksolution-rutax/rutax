"use client";

/**
 * Pantalla E — Configuración DTE: formulario de cliente.
 *
 * Estructura en dos secciones (§1.2 del documento UX):
 *   A) Selección de proveedor — selector simple que se "cierra" (modo lectura)
 *      tras guardar; cambiarlo requiere soporte (operación delicada, fuera de
 *      auto-servicio en Fase A).
 *   B) Certificado digital + credenciales — MISMO patrón de interacción para
 *      ambos sub-bloques: estado vacío explicativo → formulario de carga →
 *      tarjeta de solo-lectura tras éxito, con "Reemplazar" como única vía de
 *      cambio (nunca "editar en línea" un secreto).
 *
 * Regla de oro (criterio transversal #1, repetida tres veces en el documento
 * para esta pantalla): el valor cifrado NUNCA vuelve al cliente. Esta pantalla
 * solo conoce y muestra METADATOS — nombre de archivo, fecha de vencimiento,
 * `estado_certificacion` — jamás el contenido del secreto.
 */

import { useState, useTransition, type FormEvent } from "react";
import {
  CheckCircle2,
  FileLock2,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EstadoError } from "@/components/onboarding/estado-pantalla";
import { formatearFecha } from "@/lib/formato-cl";
import {
  cargarCertificadoDigital,
  cargarCredencialesProveedor,
  elegirProveedorDte,
  type EstadoConfiguracionDte,
} from "./actions";
import { PROVEEDORES_DTE, obtenerProveedorDte } from "./catalogo";

// Umbral de "vencimiento próximo" (§1.2: "p. ej. 30 días") — visible aquí
// porque tanto el badge como la alerta lo necesitan para decidir su variante.
const DIAS_UMBRAL_VENCIMIENTO = 30;

interface Props {
  estadoInicial: EstadoConfiguracionDte | null;
  errorInicial: string | null;
}

export function FormularioConfiguracionDte({ estadoInicial, errorInicial }: Props) {
  const [estado, setEstado] = useState<EstadoConfiguracionDte | null>(estadoInicial);
  const [errorCarga, setErrorCarga] = useState<string | null>(errorInicial);
  const [recargando, setRecargando] = useState(false);

  async function recargar() {
    setRecargando(true);
    try {
      const { obtenerEstadoConfiguracionDte } = await import("./actions");
      const resultado = await obtenerEstadoConfiguracionDte();
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
    // No debería ocurrir (el server siempre entrega `estado` o `errorInicial`),
    // pero se modela explícito — fail-safe sin pantalla en blanco.
    return (
      <EstadoError
        descripcion="No pudimos preparar esta pantalla. Recarga para intentarlo de nuevo."
        onReintentar={recargar}
        reintentando={recargando}
      />
    );
  }

  return (
    <div className="space-y-6">
      <SeccionProveedor estado={estado} onActualizar={setEstado} />
      {estado.proveedorDte ? (
        <>
          <SeccionCertificado estado={estado} onActualizar={setEstado} />
          <SeccionCredenciales estado={estado} onActualizar={setEstado} />
        </>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// A) Selección de proveedor — se "cierra" tras guardar (§1.2)
// -----------------------------------------------------------------------------

function SeccionProveedor({
  estado,
  onActualizar,
}: {
  estado: EstadoConfiguracionDte;
  onActualizar: (estado: EstadoConfiguracionDte) => void;
}) {
  const [seleccion, setSeleccion] = useState<string>(estado.proveedorDte ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  // Una vez elegido y guardado, queda en modo lectura (§1.2: "no se puede
  // cambiar libremente desde esta pantalla").
  if (estado.proveedorDte) {
    const proveedor = obtenerProveedorDte(estado.proveedorDte);
    return (
      <Card>
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Lock className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Proveedor de facturación electrónica</CardTitle>
              <Badge variant="outline">Definido</Badge>
            </div>
            <CardDescription>
              Elegiste <span className="font-medium text-foreground">{proveedor?.nombre ?? estado.proveedorDte}</span>.
              Para cambiar de proveedor, contacta a soporte — es una operación delicada que no se puede deshacer
              desde aquí.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
  }

  function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    if (!seleccion) {
      setError("Elige un proveedor de la lista para continuar.");
      return;
    }
    iniciarTransicion(async () => {
      const resultado = await elegirProveedorDte(seleccion);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      onActualizar({ ...estado, proveedorDte: seleccion, estadoCertificacion: "pendiente" });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Elige tu proveedor de facturación electrónica</CardTitle>
        <CardDescription>
          Es la empresa que emitirá tus documentos tributarios ante el SII. Una vez que guardes tu elección, no
          podrás cambiarla libremente — si tienes dudas sobre cuál elegir, puedes pausar aquí y retomar después.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={manejarEnvio} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="proveedor-dte">Proveedor</Label>
            <Select value={seleccion} onValueChange={(valor) => { setSeleccion(valor); setError(null); }}>
              <SelectTrigger id="proveedor-dte" className="w-full">
                <SelectValue placeholder="Selecciona un proveedor" />
              </SelectTrigger>
              <SelectContent>
                {PROVEEDORES_DTE.map((proveedor) => (
                  <SelectItem key={proveedor.id} value={proveedor.id}>
                    {proveedor.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {seleccion ? (
              <p className="text-sm text-muted-foreground">{obtenerProveedorDte(seleccion)?.descripcion}</p>
            ) : null}
          </div>

          {error ? (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={pendiente}>
            {pendiente ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : null}
            {pendiente ? "Guardando…" : "Guardar proveedor"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// B.1) Certificado digital — input de archivo + contraseña (§1.2)
// -----------------------------------------------------------------------------

function SeccionCertificado({
  estado,
  onActualizar,
}: {
  estado: EstadoConfiguracionDte;
  onActualizar: (estado: EstadoConfiguracionDte) => void;
}) {
  const [reemplazando, setReemplazando] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [contrasena, setContrasena] = useState("");
  const [venceEn, setVenceEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [pendiente, iniciarTransicion] = useTransition();

  const mostrarFormulario = !estado.certificadoCargado || reemplazando;

  function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setExito(false);

    if (!archivo) {
      setError("Selecciona el archivo de tu certificado (.pfx o .p12).");
      return;
    }
    if (!contrasena) {
      setError("Ingresa la contraseña de tu certificado digital.");
      return;
    }
    if (!venceEn) {
      setError("Ingresa la fecha de vencimiento de tu certificado.");
      return;
    }

    const formData = new FormData();
    formData.set("archivo", archivo);
    formData.set("contrasenaCertificado", contrasena);
    formData.set("venceEn", venceEn);

    iniciarTransicion(async () => {
      const resultado = await cargarCertificadoDigital(formData);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setExito(true);
      setReemplazando(false);
      setArchivo(null);
      setContrasena("");
      onActualizar({
        ...estado,
        certificadoCargado: true,
        certificadoVenceEn: venceEn,
        estadoCertificacion: "en_proceso",
      });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Certificado digital</CardTitle>
        <CardDescription>
          Tu certificado y su contraseña se cifran antes de guardarse. Una vez cargados, no podrás verlos de nuevo
          aquí — solo reemplazarlos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!mostrarFormulario ? (
          <TarjetaCertificadoGuardado
            estado={estado}
            exito={exito}
            onReemplazar={() => {
              setReemplazando(true);
              setExito(false);
              setError(null);
            }}
          />
        ) : (
          <form onSubmit={manejarEnvio} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="certificado-archivo">Archivo del certificado (.pfx o .p12)</Label>
              <Input
                id="certificado-archivo"
                type="file"
                accept=".pfx,.p12"
                onChange={(evento) => setArchivo(evento.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="certificado-contrasena">Contraseña del certificado</Label>
              <Input
                id="certificado-contrasena"
                type="password"
                autoComplete="off"
                value={contrasena}
                onChange={(evento) => setContrasena(evento.target.value)}
                placeholder="La contraseña que te entregó tu certificadora"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="certificado-vence">Fecha de vencimiento</Label>
              <Input
                id="certificado-vence"
                type="date"
                value={venceEn}
                onChange={(evento) => setVenceEn(evento.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                La encuentras en los datos de tu certificado — te avisaremos antes de que venza.
              </p>
            </div>

            {error ? (
              <Alert variant="destructive">
                <ShieldAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {pendiente ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                Cifrando y guardando — no cierres esta ventana.
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={pendiente}>
                {pendiente ? "Guardando…" : "Guardar certificado"}
              </Button>
              {reemplazando ? (
                <Button type="button" variant="ghost" onClick={() => { setReemplazando(false); setError(null); }}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function TarjetaCertificadoGuardado({
  estado,
  exito,
  onReemplazar,
}: {
  estado: EstadoConfiguracionDte;
  exito: boolean;
  onReemplazar: () => void;
}) {
  const proximoAVencer = diasHasta(estado.certificadoVenceEn) !== null && diasHasta(estado.certificadoVenceEn)! <= DIAS_UMBRAL_VENCIMIENTO;

  return (
    <div className="space-y-3">
      {exito ? (
        <Alert className="bg-success-subtle text-success-subtle-foreground">
          <CheckCircle2 className="text-success" />
          <AlertDescription className="text-success-subtle-foreground">
            Certificado guardado de forma segura.
          </AlertDescription>
        </Alert>
      ) : null}

      <div
        className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${
          proximoAVencer
            ? "border-warning bg-warning-subtle/40"
            : "border-border bg-muted/30"
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
              proximoAVencer
                ? "bg-warning-subtle text-warning-subtle-foreground"
                : "bg-success-subtle text-success-subtle-foreground"
            }`}
          >
            {proximoAVencer ? <TriangleAlert className="size-5" aria-hidden="true" /> : <FileLock2 className="size-5" aria-hidden="true" />}
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground">Certificado cargado y cifrado</p>
            <p className="text-sm text-muted-foreground">
              {estado.certificadoVenceEn
                ? `Vence el ${formatearFecha(estado.certificadoVenceEn)}`
                : "Aún no registramos su fecha de vencimiento"}
              {proximoAVencer ? " — está por vencer pronto." : "."}
            </p>
            <BadgeEstadoCertificacion estado={estado.estadoCertificacion} />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onReemplazar} className="w-fit shrink-0">
          {proximoAVencer ? "Renovar certificado" : "Reemplazar certificado"}
        </Button>
      </div>
    </div>
  );
}

function diasHasta(fechaIso: string | null): number | null {
  if (!fechaIso) return null;
  const fecha = new Date(`${fechaIso}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return null;
  const ahora = new Date();
  ahora.setHours(0, 0, 0, 0);
  const diffMs = fecha.getTime() - ahora.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function BadgeEstadoCertificacion({ estado }: { estado: EstadoConfiguracionDte["estadoCertificacion"] }) {
  switch (estado) {
    case "activo":
      return (
        <Badge variant="outline" className="border-success-subtle text-success">
          <ShieldCheck className="size-3" aria-hidden="true" /> Activo
        </Badge>
      );
    case "en_proceso":
      return (
        <Badge variant="outline" className="border-warning text-warning">
          En proceso
        </Badge>
      );
    case "con_problemas":
      return (
        <Badge variant="destructive">
          <ShieldAlert className="size-3" aria-hidden="true" /> Con problemas
        </Badge>
      );
    case "pendiente":
    default:
      return <Badge variant="outline">Pendiente</Badge>;
  }
}

// -----------------------------------------------------------------------------
// B.2) Credenciales del proveedor — campos según el proveedor elegido (§1.2)
// -----------------------------------------------------------------------------

function SeccionCredenciales({
  estado,
  onActualizar,
}: {
  estado: EstadoConfiguracionDte;
  onActualizar: (estado: EstadoConfiguracionDte) => void;
}) {
  const proveedor = estado.proveedorDte ? obtenerProveedorDte(estado.proveedorDte) : null;
  const [reemplazando, setReemplazando] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [pendiente, iniciarTransicion] = useTransition();

  if (!proveedor) return null;

  const mostrarFormulario = !estado.credencialesCargadas || reemplazando;

  function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setExito(false);

    for (const campo of proveedor!.camposCredenciales) {
      if (!valores[campo.clave]?.trim()) {
        setError(`Completa el campo "${campo.etiqueta}".`);
        return;
      }
    }

    iniciarTransicion(async () => {
      const resultado = await cargarCredencialesProveedor(valores);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setExito(true);
      setReemplazando(false);
      setValores({});
      onActualizar({ ...estado, credencialesCargadas: true });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Credenciales de {proveedor.nombre}</CardTitle>
        <CardDescription>
          Las que te entregó el proveedor al contratar el servicio. También se cifran antes de guardarse — no
          podrás volver a verlas aquí, solo reemplazarlas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!mostrarFormulario ? (
          <div className="space-y-3">
            {exito ? (
              <Alert className="bg-success-subtle text-success-subtle-foreground">
                <CheckCircle2 className="text-success" />
                <AlertDescription className="text-success-subtle-foreground">
                  Credenciales guardadas de forma segura.
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-subtle text-success-subtle-foreground">
                  <Lock className="size-5" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Credenciales cargadas y cifradas</p>
                  <p className="text-sm text-muted-foreground">
                    Campos guardados: {proveedor.camposCredenciales.map((c) => c.etiqueta).join(", ")}.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-fit shrink-0"
                onClick={() => {
                  setReemplazando(true);
                  setExito(false);
                  setError(null);
                }}
              >
                Reemplazar credenciales
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={manejarEnvio} className="space-y-4">
            {proveedor.camposCredenciales.map((campo) => (
              <div key={campo.clave} className="space-y-2">
                <Label htmlFor={`credencial-${campo.clave}`}>{campo.etiqueta}</Label>
                <Input
                  id={`credencial-${campo.clave}`}
                  type={campo.tipo}
                  autoComplete="off"
                  value={valores[campo.clave] ?? ""}
                  onChange={(evento) =>
                    setValores((anterior) => ({ ...anterior, [campo.clave]: evento.target.value }))
                  }
                />
              </div>
            ))}

            {error ? (
              <Alert variant="destructive">
                <ShieldAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {pendiente ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                Cifrando y guardando — no cierres esta ventana.
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={pendiente}>
                {pendiente ? "Guardando…" : "Guardar credenciales"}
              </Button>
              {reemplazando ? (
                <Button type="button" variant="ghost" onClick={() => { setReemplazando(false); setError(null); }}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

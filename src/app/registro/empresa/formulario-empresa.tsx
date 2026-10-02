"use client";

/**
 * «Tu empresa» — registro v2, paso 2.
 * =============================================================================
 * Nombre de fantasía, RUT y, solo si la identidad no trae nombre (código por
 * correo; Google sí lo trae), «Tu nombre». Debajo, las tres preguntas
 * obligatorias de un toque: envíos al día, conductores y de dónde vienen los
 * pedidos. Con ellas Rutax prioriza su atención comercial y decide qué
 * plataformas integrar; no configuran la cuenta.
 *
 * Controles NATIVOS (radio y checkbox reales, ocultos con `sr-only` y dibujados
 * como opciones de un toque en su `<label>`): el teclado, las flechas del
 * radiogroup y el lector de pantalla funcionan sin ARIA a mano, y el foco
 * visible lo pinta `has-[:focus-visible]`.
 *
 * «Continuar» está deshabilitado hasta completar. Eso es comodidad: el servidor
 * re-valida todo (`registrarEmpresaCourier`) y devuelve el error con su campo.
 */

import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { CLASE_OPCION_TOQUE } from "@/lib/ui/clase-opcion-toque";

import { AvisoTerminos } from "@/components/identidad/aviso-terminos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { enmascararRut, limpiarMascaraRut } from "@/lib/formato-cl";
import {
  CONDUCTORES_OPCIONES,
  ENVIOS_DIA_OPCIONES,
  FUENTES_PEDIDOS_OPCIONES,
  FUENTE_OTRA_MAX,
} from "@/lib/ui/perfil-comercial";
import { esRutValido } from "@/modules/identidad/rut";
import type { CampoRegistroEmpresa } from "@/modules/identidad/registro-empresa";
import { completarRegistroEmpresa } from "./actions";

const MENSAJE_RUT_INVALIDO = "El dígito verificador no coincide.";
const MENSAJE_RUT_FORMATO = "Usa el formato 12.345.678-9.";
const CLASE_ERROR_CAMPO = "text-sm text-fault-fg";

const CLASE_OPCION = CLASE_OPCION_TOQUE;

function formatoRutValido(limpio: string): boolean {
  return /^[0-9]{1,8}-[0-9kK]$/.test(limpio);
}

function Pregunta({
  id,
  titulo,
  ayuda,
  error,
  children,
}: {
  id: string;
  titulo: string;
  ayuda?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="space-y-2.5" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="text-sm font-medium text-fg">{titulo}</legend>
      {ayuda ? <p className="text-xs text-fg-muted">{ayuda}</p> : null}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className={CLASE_ERROR_CAMPO}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

type Errores = Partial<Record<CampoRegistroEmpresa, string>>;

export function FormularioEmpresa({
  pideNombre,
  avisoVisible,
}: {
  pideNombre: boolean;
  avisoVisible: boolean;
}) {
  const router = useRouter();
  const idBase = useId();

  const [nombreFantasia, setNombreFantasia] = useState("");
  const [rut, setRut] = useState("");
  const [nombreDueno, setNombreDueno] = useState("");
  const [envios, setEnvios] = useState("");
  const [conductores, setConductores] = useState("");
  const [fuentes, setFuentes] = useState<string[]>([]);
  const [fuenteOtra, setFuenteOtra] = useState("");

  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<{ mensaje: string; conSalida?: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const refNombreFantasia = useRef<HTMLInputElement>(null);
  const refRut = useRef<HTMLInputElement>(null);
  const refNombreDueno = useRef<HTMLInputElement>(null);
  const refFuenteOtra = useRef<HTMLInputElement>(null);

  const otraActiva = fuentes.includes("otra");
  const rutLimpio = limpiarMascaraRut(rut);

  const completo =
    nombreFantasia.trim().length > 0 &&
    formatoRutValido(rutLimpio) &&
    esRutValido(rutLimpio) &&
    (!pideNombre || nombreDueno.trim().length >= 2) &&
    envios !== "" &&
    conductores !== "" &&
    fuentes.length > 0 &&
    (!otraActiva || fuenteOtra.trim().length > 0);

  function limpiarError(campo: CampoRegistroEmpresa) {
    setErrores((previo) => ({ ...previo, [campo]: undefined }));
    setErrorGeneral(null);
  }

  function alternarFuente(valor: string) {
    limpiarError("fuentesPedidos");
    setFuentes((previo) => (previo.includes(valor) ? previo.filter((f) => f !== valor) : [...previo, valor]));
  }

  function validarRutAlPerderFoco() {
    if (!rutLimpio) return;
    if (!formatoRutValido(rutLimpio)) {
      setErrores((previo) => ({ ...previo, rut: MENSAJE_RUT_FORMATO }));
    } else if (!esRutValido(rutLimpio)) {
      setErrores((previo) => ({ ...previo, rut: MENSAJE_RUT_INVALIDO }));
    }
  }

  /** Solo se llama desde manejadores, nunca durante el render. */
  function enfocar(campo: CampoRegistroEmpresa) {
    const refs: Partial<Record<CampoRegistroEmpresa, RefObject<HTMLInputElement | null>>> = {
      nombreFantasia: refNombreFantasia,
      rut: refRut,
      nombreDueno: refNombreDueno,
      fuenteOtra: refFuenteOtra,
    };
    refs[campo]?.current?.focus();
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando || !completo) return;
    setErrorGeneral(null);
    setEnviando(true);
    try {
      const resultado = await completarRegistroEmpresa({
        nombreFantasia,
        rut: rutLimpio,
        nombreDueno: pideNombre ? nombreDueno : undefined,
        enviosDiaRango: envios,
        conductoresRango: conductores,
        fuentesPedidos: fuentes,
        fuenteOtra: otraActiva ? fuenteOtra : undefined,
        avisoVisible,
      });

      if (resultado.ok) {
        // Queda "enviando" a propósito: la pantalla se va.
        router.replace(resultado.destino);
        router.refresh();
        return;
      }

      if (resultado.tipo === "sin_sesion") {
        router.replace("/registro");
        return;
      }
      if (resultado.tipo === "validacion") {
        if (resultado.campo === "terminos") {
          setErrorGeneral({ mensaje: resultado.mensaje });
        } else {
          setErrores((previo) => ({ ...previo, [resultado.campo]: resultado.mensaje }));
          enfocar(resultado.campo);
        }
      } else if (resultado.tipo === "conflicto_rut") {
        setErrores((previo) => ({ ...previo, rut: resultado.mensaje }));
        enfocar("rut");
      } else {
        setErrorGeneral({ mensaje: resultado.mensaje, conSalida: resultado.tipo === "correo_ocupado" });
      }
    } catch {
      setErrorGeneral({ mensaje: "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo." });
    }
    setEnviando(false);
  }

  const idEnvios = `${idBase}-envios`;
  const idConductores = `${idBase}-conductores`;
  const idFuentes = `${idBase}-fuentes`;

  return (
    <form noValidate onSubmit={enviar} aria-busy={enviando} className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold text-fg">Tu empresa</h1>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-nombreFantasia`}>Nombre de fantasía</Label>
          <Input
            id={`${idBase}-nombreFantasia`}
            ref={refNombreFantasia}
            autoFocus
            autoComplete="organization"
            value={nombreFantasia}
            onChange={(e) => {
              setNombreFantasia(e.target.value);
              limpiarError("nombreFantasia");
            }}
            readOnly={enviando}
            aria-invalid={Boolean(errores.nombreFantasia)}
            aria-describedby={errores.nombreFantasia ? `${idBase}-nombreFantasia-error` : undefined}
            className="pointer-coarse:h-12"
          />
          {errores.nombreFantasia ? (
            <p id={`${idBase}-nombreFantasia-error`} role="alert" className={CLASE_ERROR_CAMPO}>
              {errores.nombreFantasia}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-rut`}>RUT de la empresa</Label>
          <Input
            id={`${idBase}-rut`}
            ref={refRut}
            inputMode="text"
            autoComplete="off"
            placeholder="12.345.678-9"
            value={rut}
            onChange={(e) => {
              setRut(enmascararRut(e.target.value));
              limpiarError("rut");
            }}
            onBlur={validarRutAlPerderFoco}
            readOnly={enviando}
            aria-invalid={Boolean(errores.rut)}
            aria-describedby={errores.rut ? `${idBase}-rut-error` : undefined}
            className="pointer-coarse:h-12 tabular-nums"
          />
          {errores.rut ? (
            <p id={`${idBase}-rut-error`} role="alert" className={CLASE_ERROR_CAMPO}>
              {errores.rut}
            </p>
          ) : null}
        </div>
      </div>

      {pideNombre ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-nombreDueno`}>Tu nombre</Label>
          <Input
            id={`${idBase}-nombreDueno`}
            ref={refNombreDueno}
            autoComplete="name"
            value={nombreDueno}
            onChange={(e) => {
              setNombreDueno(e.target.value);
              limpiarError("nombreDueno");
            }}
            readOnly={enviando}
            aria-invalid={Boolean(errores.nombreDueno)}
            aria-describedby={errores.nombreDueno ? `${idBase}-nombreDueno-error` : undefined}
            className="pointer-coarse:h-12"
          />
          {errores.nombreDueno ? (
            <p id={`${idBase}-nombreDueno-error`} role="alert" className={CLASE_ERROR_CAMPO}>
              {errores.nombreDueno}
            </p>
          ) : null}
        </div>
      ) : null}

      <hr className="border-line" />

      <Pregunta id={idEnvios} titulo="¿Cuántos envíos entregas en un día normal?" error={errores.enviosDiaRango}>
        <div role="radiogroup" aria-label="Envíos en un día normal" className="flex flex-wrap gap-2">
          {ENVIOS_DIA_OPCIONES.map((o) => (
            <label key={o.valor} className={CLASE_OPCION}>
              <input
                type="radio"
                name="envios_dia_rango"
                value={o.valor}
                checked={envios === o.valor}
                onChange={() => {
                  setEnvios(o.valor);
                  limpiarError("enviosDiaRango");
                }}
                disabled={enviando}
                className="sr-only"
              />
              <span className="tabular-nums">{o.etiqueta}</span>
            </label>
          ))}
        </div>
      </Pregunta>

      <Pregunta id={idConductores} titulo="¿Cuántos conductores trabajan contigo?" error={errores.conductoresRango}>
        <div role="radiogroup" aria-label="Conductores" className="flex flex-wrap gap-2">
          {CONDUCTORES_OPCIONES.map((o) => (
            <label key={o.valor} className={CLASE_OPCION}>
              <input
                type="radio"
                name="conductores_rango"
                value={o.valor}
                checked={conductores === o.valor}
                onChange={() => {
                  setConductores(o.valor);
                  limpiarError("conductoresRango");
                }}
                disabled={enviando}
                className="sr-only"
              />
              <span className="tabular-nums">{o.etiqueta}</span>
            </label>
          ))}
        </div>
      </Pregunta>

      <Pregunta
        id={idFuentes}
        titulo="¿De dónde vienen tus pedidos?"
        ayuda="Puedes marcar varias."
        error={errores.fuentesPedidos}
      >
        <div className="flex flex-wrap gap-2">
          {FUENTES_PEDIDOS_OPCIONES.map((o) => {
            const marcada = fuentes.includes(o.valor);
            return (
              <label key={o.valor} className={CLASE_OPCION}>
                <input
                  type="checkbox"
                  name="fuentes_pedidos"
                  value={o.valor}
                  checked={marcada}
                  onChange={() => alternarFuente(o.valor)}
                  disabled={enviando}
                  className="sr-only"
                />
                {marcada ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
                {o.etiqueta}
              </label>
            );
          })}
        </div>
        {otraActiva ? (
          <div className="space-y-1.5">
            <Input
              ref={refFuenteOtra}
              autoFocus
              value={fuenteOtra}
              onChange={(e) => {
                setFuenteOtra(e.target.value);
                limpiarError("fuenteOtra");
              }}
              maxLength={FUENTE_OTRA_MAX}
              placeholder="¿Cuál?"
              aria-label="Otra plataforma"
              readOnly={enviando}
              aria-invalid={Boolean(errores.fuenteOtra)}
              aria-describedby={errores.fuenteOtra ? `${idBase}-otra-error` : undefined}
              className="max-w-xs pointer-coarse:h-12"
            />
            {errores.fuenteOtra ? (
              <p id={`${idBase}-otra-error`} role="alert" className={CLASE_ERROR_CAMPO}>
                {errores.fuenteOtra}
              </p>
            ) : null}
          </div>
        ) : null}
      </Pregunta>

      {errorGeneral ? (
        <div role="alert" className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg">
          <span className="flex items-start gap-1.5">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{errorGeneral.mensaje}</span>
          </span>
          {errorGeneral.conSalida ? (
            <Link href="/login" className="mt-1.5 block font-medium underline underline-offset-4">
              Iniciar sesión ›
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col items-end gap-3">
        <Button type="submit" className="pointer-coarse:h-12" disabled={!completo || enviando}>
          {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Continuar
        </Button>
        {avisoVisible ? <AvisoTerminos className="text-right text-xs leading-relaxed text-fg-muted" /> : null}
      </div>
    </form>
  );
}

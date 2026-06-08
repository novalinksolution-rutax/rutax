import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { RESULTADOS_CALLBACK_ML, type ModoConexionMl, type ResultadoCallbackMl } from "./compartido";
import { PantallaConexionMl } from "./pantalla-conexion-ml";

export const metadata: Metadata = {
  title: "Conectar con Mercado Libre",
};

interface PageProps {
  searchParams: Promise<{ resultado?: string; modo?: string }>;
}

function leerResultado(valor: string | undefined): ResultadoCallbackMl | null {
  if (!valor) return null;
  return (RESULTADOS_CALLBACK_ML as string[]).includes(valor) ? (valor as ResultadoCallbackMl) : null;
}

function leerModo(valor: string | undefined): ModoConexionMl {
  return valor === "reconexion" ? "reconexion" : "conexion_inicial";
}

/**
 * Pantallas M + N — "Conectar con Mercado Libre" y "Resultado de la conexión"
 * (§3.2/§3.3).
 *
 * Un único componente parametrizable, tal como exige §3.3: "Constrúyanse como
 * un único componente parametrizable por contexto (`modo`), no como dos
 * pantallas duplicadas". La presencia de `?resultado=` en la URL (que solo
 * llega vía la redirección del route handler de callback) decide si se
 * muestra la Pantalla M (CTA inicial) o la N (resultado, una de las 7
 * ramificaciones de la tabla §3.2).
 *
 * También sirve como destino del botón "Reconectar" de la Pantalla O — con
 * `modo=reconexion` la instrucción de "cuenta principal" se presenta "aún más
 * prominente" (§3.2, "Flujo de reconectar", paso 2).
 */
export default async function PaginaConectarMl({ searchParams }: PageProps) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    redirect("/");
  }

  const params = await searchParams;
  const resultado = leerResultado(params.resultado);
  const modo = leerModo(params.modo);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 py-10">
      <PantallaConexionMl modo={modo} resultado={resultado} />
    </div>
  );
}

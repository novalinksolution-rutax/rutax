import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ListaCapacidades } from "@/components/ui/bloque-capacidades";
import { FormularioMiPerfil } from "@/components/perfil/formulario-mi-perfil";
import {
  BloqueCorreo,
  ContenidoContrasena,
  DatoDesdeCuando,
  DatoPerfil,
  NotaPerfil,
} from "@/components/perfil/secciones-perfil";
import { enmascararRut } from "@/lib/formato-cl";
import { formatearTelefonoLegible } from "@/lib/telefono-cl";
import { capacidadesLegiblesDeRol } from "@/modules/identidad/capacidades-legibles";
import { obtenerWhatsAppDelSeller } from "./actions";
import { PanelWhatsAppDelSeller } from "./panel-whatsapp";

export const metadata: Metadata = {
  title: "Mi perfil",
};

/**
 * `/portal/perfil` — los datos propios del seller.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ TENÍA ANTES, Y POR QUÉ NO ALCANZABA
 * -----------------------------------------------------------------------------
 * Nació como una pantalla de un solo bloque —su WhatsApp— porque ese campo se
 * pide al activar la cuenta y quien la activó antes de que existiera no volvía a
 * pasar por ahí. Seguía sin haber ningún sitio donde el seller pudiera
 * corregirse el nombre, ver con qué correo entró o saber qué puede hacer en el
 * portal.
 *
 * El usuario pidió (26-08-2026) que «Mi perfil» valga para todos los roles, así
 * que ahora es la misma pantalla que la del equipo del courier, con las mismas
 * piezas (`components/perfil/secciones-perfil.tsx`) — y el bloque de WhatsApp
 * conservado, que es lo único suyo.
 *
 * -----------------------------------------------------------------------------
 * DOS COSAS QUE ACÁ SON DISTINTAS
 * -----------------------------------------------------------------------------
 * · **Su empresa.** El seller no es solo una persona: pertenece a una razón
 *   social con la que el courier le factura. Verla acá cierra la pregunta «¿a
 *   nombre de quién me están cobrando?» sin ir a buscarla a una factura.
 *
 * · **No hay lista de «no puedes».** El seller es el único rol de su familia, así
 *   que `capacidadesLegiblesDeRol` devuelve la mitad negativa vacía —y eso es
 *   correcto, no un olvido (ver `universoDe`)—. Renderizar la lista con su texto
 *   de vacío diría «nada queda fuera de tu rol», que es exactamente lo contrario
 *   de la verdad: casi todo el sistema queda fuera. Se omite entera.
 */
export default async function PaginaPerfilSeller() {
  const sesion = await obtenerSesionActual();
  if (!sesion || sesion.usuario.tipoUsuario !== "seller") redirect("/portal");
  if (!sesion.usuario.tenantId || !sesion.usuario.sellerId) redirect("/portal");

  const cliente = crearClienteServiceRole();
  const [{ data: perfil }, { data: empresa }, whatsapp] = await Promise.all([
    // El teléfono vive fuera de la vista de `public` a propósito (dato
    // personal), así que se lee con `service_role` sobre el esquema.
    cliente
      .schema("identidad")
      .from("usuarios_perfil")
      .select("nombre_completo, telefono, creado_en")
      .eq("id", sesion.usuarioId)
      .eq("tenant_id", sesion.usuario.tenantId)
      .maybeSingle(),
    cliente
      .from("sellers")
      .select("razon_social, rut")
      .eq("id", sesion.usuario.sellerId)
      .eq("tenant_id", sesion.usuario.tenantId)
      .maybeSingle(),
    obtenerWhatsAppDelSeller(),
  ]);

  const telefonoE164 = (perfil?.telefono as string | null) ?? null;
  const { vaAPoder } = capacidadesLegiblesDeRol("seller");

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-fg">Mi perfil</h1>
        <p className="text-fg-muted">Tus datos, cómo te contactamos y qué puedes hacer acá.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Tus datos</CardTitle>
          <CardDescription>Los puedes cambiar cuando quieras.</CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioMiPerfil
            nombreInicial={(perfil?.nombre_completo as string | null) ?? sesion.nombreCompleto ?? ""}
            telefonoInicial={telefonoE164 ? formatearTelefonoLegible(telefonoE164) : ""}
            ayudaNombre="Es el nombre con el que te ve tu courier cuando hay que resolver algo de un pedido tuyo."
            /* ⚠️ Se dice explícitamente que NO es el de los avisos, porque
               abajo en la misma pantalla hay otro campo de teléfono. Sin esta
               frase, quien cambie éste va a creer que cambió aquél — y se va a
               quedar esperando avisos que llegan al número viejo. */
            ayudaTelefono="Opcional, para que te llamen si hay un problema. No es el de los avisos por WhatsApp: ese se cambia más abajo."
          />
        </CardContent>
      </Card>

      {/* El lector devuelve `null` solo si la sesión no es de un seller con
          permiso, y eso ya lo cortó el guard de arriba. Si aun así viniera
          vacío, se omite el bloque en vez de inventar un estado: un panel de
          consentimiento mostrando datos falsos es peor que un panel ausente. */}
      {whatsapp ? <PanelWhatsAppDelSeller datos={whatsapp} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Tu cuenta</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2.5">
            <BloqueCorreo email={sesion.email} />

            {empresa?.razon_social ? (
              <DatoPerfil termino="Tu empresa" conSeparador>
                <span className="text-sm text-fg">{empresa.razon_social as string}</span>
              </DatoPerfil>
            ) : null}
            {empresa?.rut ? (
              <DatoPerfil termino="RUT">
                <span className="rx-num text-sm text-fg">{enmascararRut(empresa.rut as string)}</span>
              </DatoPerfil>
            ) : null}
            {empresa?.razon_social ? (
              <NotaPerfil>
                Es la empresa a la que tu courier le factura. Si está mal, avísale a tu courier: lo
                corrige él.
              </NotaPerfil>
            ) : null}

            <DatoPerfil termino="Rol" conSeparador>
              <Badge variant="outline">Seller</Badge>
            </DatoPerfil>
            <NotaPerfil>
              Entras a tu portal: tus pedidos, tus bodegas, tus incidencias y tus cobros. No ves la
              operación del courier ni la de los demás sellers.
            </NotaPerfil>

            <DatoDesdeCuando
              rotulo="Con este courier desde"
              fechaIso={perfil?.creado_en as string | undefined}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Qué puedes hacer</CardTitle>
        </CardHeader>
        <CardContent>
          <ListaCapacidades
            rotulo="Puedes"
            tono="balanced"
            items={vaAPoder}
            vacio="Tu cuenta no habilita ninguna acción todavía."
            colapsable
            umbral={8}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tu contraseña</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ContenidoContrasena email={sesion.email} />
        </CardContent>
      </Card>
    </div>
  );
}

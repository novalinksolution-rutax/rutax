import type { Metadata } from "next";

import { CabeceraDocumentoLegal } from "@/components/ui/cabecera-documento-legal";
import { PRIVACIDAD } from "@/lib/legal/versiones";
import {
  DIAS_RETENCION_IMAGENES,
  DIAS_RETENCION_METADATOS,
} from "@/modules/operacion/jobs/purgar-evidencias";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description:
    "Cómo Rutax trata los datos personales de conductores, destinatarios y usuarios de sus couriers clientes.",
};

/**
 * Política de privacidad — PÚBLICA, sin sesión.
 *
 * Los plazos de retención se importan del job que efectivamente los aplica
 * (`purgar-evidencias`) en vez de escribirse a mano. Una política que promete 90
 * días mientras el sistema guarda para siempre no es un detalle de redacción: es
 * exactamente la clase de desajuste que la Ley 21.719 sanciona. Atando el texto
 * al código, cambiar el plazo obliga a cambiar los dos a la vez.
 */
export default function PaginaPrivacidad() {
  return (
    <article>
      <CabeceraDocumentoLegal titulo="Política de privacidad" documento={PRIVACIDAD} />


      <h2>1. Quiénes somos y qué rol tenemos</h2>
      <p>
        Rutax es un producto de <strong>Novalink SpA</strong>, RUT 78.060.175-2, con domicilio
        en Eulogia Sánchez 065, Santiago de Chile. Puedes escribirnos a{" "}
        <a href="mailto:novalinksolution@gmail.com">novalinksolution@gmail.com</a>.
      </p>
      <p>
        Rutax es un <strong>software que usan empresas de última milla</strong> (los
        llamamos <em>couriers</em>) para operar sus entregas y su administración. Novalink
        SpA <strong>no reparte paquetes ni contrata conductores</strong>: solo provee el
        software.
      </p>
      <p>
        Esa distinción define nuestro rol frente a tus datos. Cuando un courier usa Rutax
        para gestionar sus entregas, <strong>el courier decide</strong> qué datos recoge y
        para qué, y <strong>Novalink SpA los trata por encargo suyo</strong>, siguiendo sus
        instrucciones y sin usarlos para fines propios. En los términos de la Ley 21.719, el
        courier es el <strong>responsable</strong> del tratamiento y Novalink SpA es el{" "}
        <strong>encargado</strong>.
      </p>
      <p>
        En la práctica: si eres el destinatario de un paquete o un conductor, la empresa a la
        que debes dirigirte es el courier que hace la entrega. Si no sabes cuál es o no
        obtienes respuesta, escríbenos y te derivamos.
      </p>

      <h2>2. Qué datos tratamos</h2>
      <table>
        <thead>
          <tr>
            <th>De quién</th>
            <th>Qué</th>
            <th>Para qué</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Usuarios del courier</td>
            <td>Nombre, correo, rol, y el registro de sus acciones</td>
            <td>Dar acceso, aplicar permisos y mantener la bitácora de auditoría</td>
          </tr>
          <tr>
            <td>Conductores</td>
            <td>
              Nombre, RUT, tipo de relación laboral, zonas asignadas y, si corresponde, datos
              bancarios para pagarles
            </td>
            <td>Asignar reparto, liquidar lo que se les debe y pagarlo</td>
          </tr>
          <tr>
            <td>Destinatarios</td>
            <td>
              Nombre, dirección, comuna, teléfono e instrucciones de entrega; y la evidencia
              de la entrega (foto, firma, coordenada y distancia al destino)
            </td>
            <td>Entregar el paquete y poder acreditar que se entregó</td>
          </tr>
          <tr>
            <td>Sellers</td>
            <td>Razón social, RUT y contacto</td>
            <td>Facturarles y darles acceso a su portal</td>
          </tr>
        </tbody>
      </table>
      <p>
        <strong>No tratamos datos que no necesitemos.</strong> Dos ejemplos concretos, porque
        se pregunta seguido: no guardamos el recorrido GPS de los conductores —del conductor
        se conserva únicamente su <em>última</em> posición conocida, que se sobrescribe, y
        solo mientras está de turno—; y la página pública de seguimiento que recibe el
        destinatario muestra únicamente la tienda, el estado y la comuna: ni su nombre, ni su
        dirección, ni su teléfono.
      </p>

      <h2>3. Cuánto tiempo los guardamos</h2>
      <table>
        <thead>
          <tr>
            <th>Dato</th>
            <th>Plazo</th>
            <th>Por qué</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Fotos y firmas de la entrega</td>
            <td>{DIAS_RETENCION_IMAGENES} días</td>
            <td>
              Es lo más sensible que guardamos. Ese plazo cubre el cierre del período, la
              factura, el pago y un eventual reclamo, y después se borra.
            </td>
          </tr>
          <tr>
            <td>
              Datos de la entrega sin imagen (quién entregó, cuándo, coordenada y distancia al
              destino)
            </td>
            <td>{Math.round(DIAS_RETENCION_METADATOS / 365)} año</td>
            <td>
              Es lo que permite acreditar una entrega meses después si alguien la cuestiona.
            </td>
          </tr>
          <tr>
            <td>Documentos tributarios y registros contables</td>
            <td>6 años</td>
            <td>Lo exige la normativa tributaria chilena.</td>
          </tr>
          <tr>
            <td>Bitácora de auditoría</td>
            <td>Mientras dure el servicio</td>
            <td>
              Es el registro de quién hizo qué con el dinero y con los accesos. Borrarla sería
              perder la trazabilidad que la propia normativa exige.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        El borrado es automático y diario. Hay una excepción deliberada:{" "}
        <strong>si la entrega está atada a un reclamo abierto o a un cobro impago</strong>, su
        evidencia se conserva hasta que ese asunto se cierre — borrarla sería destruir la
        prueba de algo que alguien todavía está discutiendo.
      </p>

      <h2>4. Con quién los compartimos</h2>
      <p>
        No vendemos datos personales ni los cedemos con fines publicitarios. Los compartimos
        solo con proveedores que nos prestan servicios de infraestructura, y únicamente en lo
        necesario:
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> — base de datos y almacenamiento de archivos, alojada en{" "}
          <strong>São Paulo, Brasil</strong>.
        </li>
        <li>
          <strong>Vercel</strong> — ejecución de la aplicación, en la misma región.
        </li>
        <li>
          <strong>Inngest</strong> — orquestación de los procesos automáticos.
        </li>
        <li>
          <strong>Mercado Libre</strong> — cuando el courier conecta cuentas de Flex, para leer
          los envíos que le corresponden.
        </li>
        <li>
          Proveedores de <strong>facturación electrónica</strong>, <strong>pagos</strong> y{" "}
          <strong>correo</strong>, cuando el courier activa esas funciones.
        </li>
      </ul>
      <p>
        Como la infraestructura está en Brasil, tus datos se{" "}
        <strong>transfieren fuera de Chile</strong>. Esa transferencia se ampara en las
        cláusulas contractuales que tenemos con cada proveedor, y no habilita a ninguno de
        ellos a usar los datos para fines propios.
      </p>

      <h2>5. Cómo los protegemos</h2>
      <ul>
        <li>
          <strong>Separación entre couriers impuesta por la base de datos</strong>, no solo por
          la aplicación: un courier no puede leer los datos de otro aunque el software tuviera
          un error.
        </li>
        <li>
          <strong>Cifrado</strong> de certificados digitales, credenciales y tokens. Nunca
          viajan en texto plano, ni aparecen en registros ni en direcciones web.
        </li>
        <li>
          <strong>Bitácora de auditoría</strong> de toda acción sobre dinero y sobre accesos.
        </li>
        <li>
          <strong>Acceso por rol</strong>: cada persona ve lo que su función necesita. El
          seller solo ve lo suyo; el conductor, lo suyo.
        </li>
      </ul>

      <h2>6. Tus derechos</h2>
      <p>
        Puedes pedir acceder a tus datos, corregirlos, eliminarlos, oponerte a su tratamiento o
        pedir que te los entreguemos en un formato portable.
      </p>
      <p>
        Como Novalink SpA trata estos datos <strong>por encargo del courier</strong>, la vía
        correcta es dirigir la solicitud a ese courier, que es quien decide sobre ellos.
        Nosotros lo asistimos técnicamente para responderte. Si no logras identificarlo o no
        obtienes respuesta, escríbenos a{" "}
        <a href="mailto:novalinksolution@gmail.com">novalinksolution@gmail.com</a> y te
        ayudamos a canalizarla.
      </p>
      <p>
        También puedes reclamar ante la autoridad de protección de datos que corresponda
        conforme a la Ley 21.719.
      </p>

      <h2>7. Brechas de seguridad</h2>
      <p>
        Si ocurre un incidente que afecte datos personales, notificamos al courier afectado sin
        dilaciones indebidas, con lo que sepamos del alcance y de las medidas tomadas, para que
        pueda cumplir sus propias obligaciones de notificación.
      </p>

      <h2>8. Cambios</h2>
      <p>
        Si cambiamos esta política, actualizamos la fecha del encabezado y avisamos a los
        couriers con cuenta activa. Los cambios que afecten de forma relevante el tratamiento
        se comunican antes de aplicarse.
      </p>
    </article>
  );
}

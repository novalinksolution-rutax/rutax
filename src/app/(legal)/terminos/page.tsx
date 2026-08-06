import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Términos y condiciones",
  description:
    "Condiciones del servicio de software Rutax para empresas de última milla en Chile.",
};

/** Términos del servicio — PÚBLICOS, sin sesión. */
export default function PaginaTerminos() {
  return (
    <article>
      <h1 className="mb-2 text-2xl font-semibold">Términos y condiciones</h1>
      <p className="text-muted-foreground">Última actualización: 5 de agosto de 2026</p>

      <h2>1. Quién presta el servicio</h2>
      <p>
        Rutax es un producto de <strong>Novalink SpA</strong>, RUT 78.060.175-2, con domicilio
        en Eulogia Sánchez 065, Santiago de Chile, correo{" "}
        <a href="mailto:novalinksolution@gmail.com">novalinksolution@gmail.com</a>.
      </p>
      <p>
        Al crear una cuenta y usar Rutax, la empresa que contrata (el{" "}
        <strong>courier</strong>) acepta estos términos. Quien acepta declara tener facultades
        para obligar a esa empresa.
      </p>

      <h2>2. Qué es Rutax y qué no es</h2>
      <p>
        Rutax es <strong>software por suscripción</strong>: una plataforma para que un courier
        centralice sus pedidos, arme manifiestos, coordine conductores, y genere sus cobros a
        sellers y sus liquidaciones a conductores.
      </p>
      <p>Conviene dejar por escrito lo que Rutax no hace, porque define responsabilidades:</p>
      <ul>
        <li>
          <strong>No realiza entregas ni contrata conductores.</strong> La operación de reparto
          y la relación laboral o de servicios con los conductores son del courier, incluidas
          las obligaciones de la Ley 21.431.
        </li>
        <li>
          <strong>No reemplaza la aplicación de Mercado Envíos.</strong> Para pedidos Flex, el
          escaneo y la confirmación de entrega se hacen en la app de Mercado Libre, que es
          obligatoria. Rutax se organiza en torno a ella y la evidencia que captura para esos
          pedidos es informativa.
        </li>
        <li>
          <strong>No emite documentos tributarios por cuenta propia.</strong> Las facturas se
          emiten bajo el RUT del courier, con su certificado digital y sus folios, a través del
          proveedor autorizado que él contrate.
        </li>
        <li>
          <strong>No es un servicio de asesoría</strong> tributaria, contable ni legal.
        </li>
      </ul>

      <h2>3. Cuenta y uso</h2>
      <p>El courier se compromete a:</p>
      <ul>
        <li>Entregar información veraz al registrarse y mantenerla al día.</li>
        <li>
          Resguardar las credenciales de su equipo y avisarnos si sospecha de un acceso no
          autorizado.
        </li>
        <li>
          Usar el servicio conforme a la ley, en particular la normativa de protección de datos
          y la tributaria.
        </li>
        <li>
          Cargar en la plataforma únicamente datos que esté facultado para tratar, y darles a
          las personas afectadas la información que la ley le exige.
        </li>
      </ul>
      <p>
        Quedan prohibidos el acceso no autorizado, la extracción masiva automatizada de datos y
        cualquier uso que degrade el servicio para otros couriers.
      </p>

      <h2>4. Datos del courier</h2>
      <p>
        Los datos que el courier carga <strong>son suyos</strong>. Novalink SpA los trata por
        encargo suyo y no los usa para fines propios. El detalle está en la{" "}
        <a href="/privacidad">política de privacidad</a>.
      </p>
      <p>
        Mientras la cuenta esté activa, el courier puede exportar sus datos desde la
        plataforma. Al terminar el contrato dispone de <strong>30 días corridos</strong> para
        hacerlo; pasado ese plazo procedemos a eliminarlos, salvo lo que debamos conservar por
        obligación legal.
      </p>

      <h2>5. Suscripción y pago</h2>
      <ul>
        <li>El precio y la periodicidad son los del plan contratado.</li>
        <li>
          La suscripción se renueva automáticamente por períodos iguales, salvo aviso de
          término antes del cierre del período en curso.
        </li>
        <li>
          El impago habilita a suspender el servicio previo aviso. La suspensión no borra los
          datos: los deja inaccesibles hasta regularizar.
        </li>
        <li>
          Los cambios de precio se comunican con al menos <strong>30 días</strong> de
          anticipación y rigen desde el período siguiente.
        </li>
      </ul>

      <h2>6. Disponibilidad</h2>
      <p>
        Trabajamos para mantener el servicio disponible durante la ventana operativa habitual
        del rubro, pero <strong>no garantizamos disponibilidad ininterrumpida</strong>. Rutax
        depende de servicios de terceros —Mercado Libre, el proveedor de facturación
        electrónica, las pasarelas de pago, la infraestructura de nube— y una caída de
        cualquiera de ellos puede afectarlo.
      </p>
      <p>
        Las mantenciones programadas se avisan con anticipación y se procuran fuera de la
        ventana de reparto.
      </p>

      <h2>7. Responsabilidad</h2>
      <p>
        El courier es responsable de sus decisiones operativas y comerciales, de la exactitud
        de los datos que carga, y del cumplimiento de sus obligaciones laborales y tributarias.
      </p>
      <p>
        Novalink SpA responde por el funcionamiento del software conforme a estos términos. En
        la medida que la ley lo permita, no responde por lucro cesante ni por daños indirectos,
        y su responsabilidad total se limita a lo que el courier haya pagado por la suscripción
        en los <strong>12 meses</strong> anteriores al hecho que la origine.
      </p>
      <p>
        Nada de lo anterior limita la responsabilidad por dolo o culpa grave, ni los derechos
        que la ley chilena reconozca de forma irrenunciable.
      </p>

      <h2>8. Término</h2>
      <p>
        El courier puede terminar cuando quiera, con efecto al cierre del período pagado.
        Novalink SpA puede terminar por incumplimiento grave —uso ilícito, impago sostenido,
        daño a la plataforma— avisando por escrito y dando un plazo razonable para exportar los
        datos, salvo que la gravedad exija actuar de inmediato.
      </p>

      <h2>9. Cambios a estos términos</h2>
      <p>
        Podemos modificarlos avisando con al menos <strong>30 días</strong> de anticipación por
        correo o dentro de la plataforma. Si el courier no está de acuerdo, puede terminar
        antes de que entren en vigencia.
      </p>

      <h2>10. Ley aplicable</h2>
      <p>
        Estos términos se rigen por la ley chilena. Cualquier controversia se somete a los
        tribunales ordinarios de Santiago de Chile.
      </p>
    </article>
  );
}

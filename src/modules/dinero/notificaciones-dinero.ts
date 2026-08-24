/**
 * Los cinco correos de dinero — los que no existían.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * EL HUECO
 * -----------------------------------------------------------------------------
 * Hasta hoy **ningún evento de dinero mandaba un correo. Ni uno.** El seller no
 * se enteraba de que le facturaron; el conductor no se enteraba de que le
 * pagaron. Todo se veía entrando al portal, y quien no entra no se entera.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTOS CINCO Y NO LOS DIEZ DEL DISEÑO
 * -----------------------------------------------------------------------------
 * Decisión del usuario (24-08-2026): **los que cierran un hecho de dinero**. El
 * criterio es que alguien esté esperando ese hecho, o que algo se rompa si nadie
 * actúa:
 *
 * | Correo | Quién lo espera | Qué se rompe sin él |
 * |---|---|---|
 * | Factura emitida | el seller | llama a preguntar por su factura |
 * | Liquidación pagada | el conductor | pregunta por WhatsApp si le llegó |
 * | Pago rechazado | el courier | el conductor queda sin pagar y nadie lo sabe |
 * | Folios por agotarse | el courier | **deja de poder facturar** |
 * | Certificado por vencer | el courier | **deja de poder facturar** |
 *
 * Los otros cinco —período cerrado, liquidación emitida, morosidad, excedente,
 * seguimiento— avisan de algo que el portal ya muestra y que nadie está
 * esperando en ese instante. Quedan escritos como decisión, no como olvido.
 *
 * -----------------------------------------------------------------------------
 * QUIÉN FIRMA CADA UNO (regla 42)
 * -----------------------------------------------------------------------------
 * **El courier firma cuando el destinatario es su cliente** —el seller que
 * recibe su factura, el conductor que recibe su pago—. **Rutax firma cuando
 * nosotros somos la contraparte**: folios y certificado son infraestructura que
 * el courier contrató con nosotros, y avisarle de eso es cosa nuestra.
 *
 * -----------------------------------------------------------------------------
 * UN CORREO NUNCA TUMBA UN JOB DE DINERO
 * -----------------------------------------------------------------------------
 * ⚠️ Los constructores son puros y no lanzan; el envío va siempre envuelto en el
 * llamador. Una factura emitida no se desemite porque el proveedor de correo
 * esté caído, y un pago confirmado no se desconfirma. Es la misma regla que ya
 * gobierna `enviarNotificacionEmail`.
 */

import { envolverEmail } from "@/lib/email/plantilla-email";
import { formatearCLP } from "@/lib/ui/formato-moneda";

export interface ContenidoEmailDinero {
  asunto: string;
  html: string;
  texto: string;
}

/** 'YYYY-MM-DD' → 'DD-MM-YYYY'. Se parte como cadena: `Date` la correría un día. */
function fechaCorta(fecha: string): string {
  const [anio, mes, dia] = fecha.slice(0, 10).split("-");
  if (!anio || !mes || !dia) return fecha;
  return `${dia}-${mes}-${anio}`;
}

function periodo(inicio: string, fin: string): string {
  return `${fechaCorta(inicio)} al ${fechaCorta(fin)}`;
}

// ---------------------------------------------------------------------------
// 1 · Factura emitida → el seller
// ---------------------------------------------------------------------------

/**
 * `dinero/dte.emitido` → «tu factura está lista».
 *
 * ⚠️ **Es el único correo del producto que nombra el IVA**, y no por excepción:
 * el documento tributario lo lleva y esconderlo acá haría que el total del
 * correo no cuadrara con el papel. La regla 22 dice que **Rutax** no muestra
 * impuestos en sus pantallas; esto no es una pantalla de Rutax, es el aviso de
 * un documento del SII.
 */
export function construirEmailFacturaEmitida(args: {
  nombreCourier: string;
  folio: number;
  fechaEmision: string;
  periodoInicio: string;
  periodoFin: string;
  netoClp: number;
  ivaClp: number;
  totalClp: number;
  entregas: number;
  /** Enlace al detalle en el portal. `null` si no hay dominio configurado. */
  urlPortal: string | null;
}): ContenidoEmailDinero {
  const total = formatearCLP(args.totalClp);
  const rango = periodo(args.periodoInicio, args.periodoFin);

  return {
    // El hecho y su número. El folio es lo que el contador del seller busca.
    asunto: `Factura ${args.folio} · ${total}`,
    html: envolverEmail({
      // Firma el COURIER: el seller es su cliente, no el nuestro.
      marca: args.nombreCourier,
      titular: `Tu factura ${args.folio} está emitida`,
      preencabezado: `${total} · período ${rango}`,
      cuerpoHtml:
        `<p style="margin:0">Corresponde a las ${args.entregas} entregas del período ` +
        `${rango}. El documento tributario lo emite el Servicio de Impuestos Internos; ` +
        `en tu portal puedes descargarlo en PDF junto con el detalle de cada entrega.</p>`,
      datos: [
        { etiqueta: "Período", valor: rango },
        { etiqueta: "Entregas", valor: String(args.entregas) },
        { etiqueta: "Neto", valor: formatearCLP(args.netoClp) },
        { etiqueta: "IVA 19 %", valor: formatearCLP(args.ivaClp) },
        { etiqueta: "Total", valor: total, destacada: true },
      ],
      ...(args.urlPortal
        ? { accion: { etiqueta: "Ver el detalle y descargar", url: args.urlPortal } }
        : {}),
      motivoRecepcion:
        `Recibes este correo porque ${args.nombreCourier} despacha tus pedidos. ` +
        `Tus cobros y facturas están en tu portal.`,
    }),
    texto:
      `Tu factura ${args.folio} está emitida por ${total} (neto ${formatearCLP(args.netoClp)} ` +
      `+ IVA ${formatearCLP(args.ivaClp)}), por las ${args.entregas} entregas del período ${rango}. ` +
      `Descárgala desde tu portal.`,
  };
}

// ---------------------------------------------------------------------------
// 2 · Liquidación pagada → el conductor
// ---------------------------------------------------------------------------

/**
 * `dinero/payout.confirmado` → «te transferimos».
 *
 * El monto va en el asunto porque es lo que decide si se abre ahora: el
 * conductor que ve «$284.500» sabe de qué se trata sin abrir nada.
 */
export function construirEmailLiquidacionPagada(args: {
  nombreCourier: string;
  montoClp: number;
  periodoInicio: string;
  periodoFin: string;
  entregas: number;
  visitas: number;
  urlApp: string | null;
}): ContenidoEmailDinero {
  const monto = formatearCLP(args.montoClp);
  const rango = periodo(args.periodoInicio, args.periodoFin);

  // Las visitas se nombran aparte de las entregas porque son otro hecho
  // generador, y porque es la parte que el conductor no da por descontada.
  const composicion = [
    `${args.entregas} ${args.entregas === 1 ? "entrega" : "entregas"}`,
    args.visitas > 0
      ? `${args.visitas} ${args.visitas === 1 ? "visita a bodega" : "visitas a bodega"}`
      : null,
  ]
    .filter(Boolean)
    .join(" y ");

  return {
    asunto: `Te transferimos ${monto}`,
    html: envolverEmail({
      marca: args.nombreCourier,
      titular: "Tu liquidación está pagada",
      preencabezado: `${monto} · ${rango}`,
      cuerpoHtml:
        `<p style="margin:0">Corresponde a ${composicion} del período ${rango}. ` +
        `Puede tardar unas horas en aparecer en tu banco.</p>`,
      datos: [
        { etiqueta: "Período", valor: rango },
        { etiqueta: "Entregas", valor: String(args.entregas) },
        ...(args.visitas > 0 ? [{ etiqueta: "Visitas a bodega", valor: String(args.visitas) }] : []),
        { etiqueta: "Transferido", valor: monto, destacada: true },
      ],
      ...(args.urlApp ? { accion: { etiqueta: "Ver el detalle", url: args.urlApp } } : {}),
      motivoRecepcion:
        `Recibes este correo porque trabajas con ${args.nombreCourier}. ` +
        `El detalle de cada liquidación está en tu app.`,
    }),
    texto:
      `Te transferimos ${monto} por ${composicion} del período ${rango}. ` +
      `Puede tardar unas horas en aparecer en tu banco.`,
  };
}

// ---------------------------------------------------------------------------
// 3 · Pago rechazado → el courier
// ---------------------------------------------------------------------------

/**
 * `dinero/payout.rechazado` → «el banco rechazó la transferencia».
 *
 * ⚠️ **Va al courier, no al conductor.** Es él quien puede arreglarlo —los datos
 * bancarios están en la ficha del conductor— y avisarle al conductor de un
 * rechazo que no puede resolver solo lo deja llamando sin nada que hacer. El
 * conductor se entera cuando el pago se reintenta y llega.
 *
 * El motivo del banco se pasa **tal como vino**, sin traducir: inventar una
 * explicación sobre un código que no se persiste fue exactamente el defecto que
 * se corrigió en la pantalla de liquidaciones.
 */
export function construirEmailPagoRechazado(args: {
  nombreConductor: string;
  montoClp: number;
  periodoInicio: string;
  periodoFin: string;
  /** Lo que dijo el banco. `null` si no vino nada. */
  motivoBanco: string | null;
  urlLiquidacion: string | null;
}): ContenidoEmailDinero {
  const monto = formatearCLP(args.montoClp);
  const rango = periodo(args.periodoInicio, args.periodoFin);

  return {
    asunto: `Pago rechazado · ${args.nombreConductor} · ${monto}`,
    html: envolverEmail({
      // Firma Rutax: es un aviso de sistema al courier sobre su operación.
      marca: "Rutax",
      titular: `El banco rechazó el pago a ${args.nombreConductor}`,
      preencabezado: `${monto} · período ${rango}`,
      cuerpoHtml:
        `<p style="margin:0">La liquidación volvió a quedar pendiente de pago. ` +
        `Revisa los datos bancarios en su ficha y vuelve a emitir el pago.</p>` +
        `<p style="margin:12px 0 0">Él no recibió este aviso: no hay nada que pueda ` +
        `hacer de su lado.</p>`,
      datos: [
        { etiqueta: "Conductor", valor: args.nombreConductor },
        { etiqueta: "Período", valor: rango },
        ...(args.motivoBanco ? [{ etiqueta: "Dijo el banco", valor: args.motivoBanco }] : []),
        { etiqueta: "Monto", valor: monto, destacada: true },
      ],
      ...(args.urlLiquidacion
        ? { accion: { etiqueta: "Abrir la liquidación", url: args.urlLiquidacion } }
        : {}),
      motivoRecepcion:
        "Recibes este correo porque administras la operación de tu courier en Rutax. " +
        "Los pagos a conductores están en Dinero → Liquidaciones.",
    }),
    texto:
      `El banco rechazó el pago de ${monto} a ${args.nombreConductor} (período ${rango})` +
      `${args.motivoBanco ? `. Dijo: ${args.motivoBanco}` : ""}. ` +
      `La liquidación volvió a quedar pendiente de pago.`,
  };
}

// ---------------------------------------------------------------------------
// 4 · Folios por agotarse → el courier
// ---------------------------------------------------------------------------

/**
 * `dinero/alertaFoliosProximos` → «te quedan N folios».
 *
 * Este y el del certificado son los dos que avisan de algo que **detiene la
 * facturación**, y por eso el cuerpo dice la consecuencia antes que el número:
 * «te quedan 12» no significa nada para quien no sabe que sin folios no se
 * emite.
 */
export function construirEmailFoliosPorAgotarse(args: {
  nombreCourier: string;
  foliosRestantes: number;
  folioHasta: number;
  urlFolios: string | null;
}): ContenidoEmailDinero {
  return {
    asunto: `Te quedan ${args.foliosRestantes} folios para facturar`,
    html: envolverEmail({
      // Firma Rutax: los folios son infraestructura que el courier contrató con
      // nosotros, y avisarle de eso es cosa nuestra.
      marca: "Rutax",
      titular: `Te quedan ${args.foliosRestantes} folios`,
      preencabezado: "Sin folios no se pueden emitir facturas",
      cuerpoHtml:
        "<p style=\"margin:0\"><strong>Cuando se acaben no vas a poder emitir facturas</strong>, " +
        "y el cierre de período se queda esperando. Pide un CAF nuevo en el SII y cárgalo " +
        "en Rutax antes de que eso pase.</p>" +
        "<p style=\"margin:12px 0 0\">El trámite en el SII es inmediato, pero conviene no " +
        "dejarlo para el día del cierre.</p>",
      datos: [
        { etiqueta: "Folios disponibles", valor: String(args.foliosRestantes), destacada: true },
        { etiqueta: "Último folio del CAF", valor: String(args.folioHasta) },
      ],
      ...(args.urlFolios ? { accion: { etiqueta: "Cargar un CAF nuevo", url: args.urlFolios } } : {}),
      motivoRecepcion:
        "Recibes este correo porque administras la cuenta de Rutax de tu empresa. " +
        "Tus folios están en Configuración → Facturación.",
    }),
    texto:
      `Te quedan ${args.foliosRestantes} folios (el CAF llega hasta el ${args.folioHasta}). ` +
      `Cuando se acaben no vas a poder emitir facturas: pide un CAF nuevo en el SII y cárgalo en Rutax.`,
  };
}

// ---------------------------------------------------------------------------
// 5 · Certificado por vencer → el courier
// ---------------------------------------------------------------------------

/**
 * `identidad/certificadoPorVencer` → «tu certificado vence el …».
 *
 * El plazo va en días y **no** en fecha sola: «vence el 12-09-2026» obliga a
 * hacer la cuenta, y el que la hace mal es el que se queda sin facturar.
 */
export function construirEmailCertificadoPorVencer(args: {
  nombreCourier: string;
  diasRestantes: number;
  fechaVencimiento: string;
  urlCertificado: string | null;
}): ContenidoEmailDinero {
  const dias = args.diasRestantes;
  const plazo = dias <= 0 ? "hoy" : dias === 1 ? "mañana" : `en ${dias} días`;

  return {
    asunto:
      dias <= 0
        ? "Tu certificado digital venció"
        : `Tu certificado digital vence ${plazo}`,
    html: envolverEmail({
      marca: "Rutax",
      titular:
        dias <= 0
          ? "Tu certificado digital venció"
          : `Tu certificado digital vence ${plazo}`,
      preencabezado: "Sin certificado vigente no se pueden emitir facturas",
      cuerpoHtml:
        (dias <= 0
          ? "<p style=\"margin:0\"><strong>No puedes emitir facturas hasta que cargues uno nuevo.</strong> "
          : "<p style=\"margin:0\"><strong>Cuando venza no vas a poder emitir facturas.</strong> ") +
        "El certificado lo renueva el proveedor con el que lo compraste; una vez que lo " +
        "tengas, se carga en Rutax en un minuto.</p>",
      datos: [
        { etiqueta: "Vence", valor: fechaCorta(args.fechaVencimiento), destacada: true },
        ...(dias > 0 ? [{ etiqueta: "Te quedan", valor: `${dias} días` }] : []),
      ],
      ...(args.urlCertificado
        ? { accion: { etiqueta: "Cargar el certificado", url: args.urlCertificado } }
        : {}),
      motivoRecepcion:
        "Recibes este correo porque administras la cuenta de Rutax de tu empresa. " +
        "Tu certificado está en Configuración → Facturación.",
    }),
    texto:
      dias <= 0
        ? `Tu certificado digital venció el ${fechaCorta(args.fechaVencimiento)}. No puedes emitir facturas hasta que cargues uno nuevo.`
        : `Tu certificado digital vence ${plazo} (${fechaCorta(args.fechaVencimiento)}). Cuando venza no vas a poder emitir facturas.`,
  };
}

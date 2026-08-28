import { describe, it, expect } from "vitest";
import { BLOQUES, pasosDelAsistente, siguientePendiente, type ClavePaso } from "./pasos";
import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
import type { EstadoOnboardingCourier } from "./estado";

function estadoBase(parcial: Partial<EstadoOnboardingCourier> = {}): EstadoOnboardingCourier {
  return {
    nombreFantasia: "Despachos del Centro",
    completo: false,
    faltaParaOperar: "invitar a tu primer seller",
    dte: {
      estado: "pendiente",
      proveedorElegido: null,
      certificadoVenceEn: null,
      camposEmisorFaltantes: ["giro", "dirección", "comuna", "actividad económica"],
    },
    folios: { estado: "pendiente", gestionadoPorProveedor: false, cantidadVigentes: 0 },
    tarifas: { estado: "sin_tarifas", cantidad: 0 },
    cobranza: { estado: "pendiente", bancoConectado: false, cuentaBancoAlias: null },
    plan: { estado: "sin_suscripcion", nombrePlan: null, trialHasta: null },
    bodegas: { cantidad: 0, hayPrincipal: false },
    conductores: { cantidad: 0 },
    sellers: { cantidad: 0 },
    periodos: { tipoPeriodo: "mensual", explicita: false },
    datosCobro: { configurado: false, banco: null },
    retencion: { configurada: false, porcentaje: null },
    retiro: { montoVisitaClp: null },
    zonas: { cantidad: 0 },
    contacto: { telefono: null, email: null },
    ...parcial,
  };
}

/** Busca por clave y no por posición: el orden puede cambiar, el significado no. */
function paso(estado: EstadoOnboardingCourier, clave: ClavePaso) {
  const encontrado = pasosDelAsistente(estado).find((p) => p.clave === clave);
  if (!encontrado) throw new Error(`No existe el paso ${clave}`);
  return encontrado;
}

describe("pasosDelAsistente — forma de la lista", () => {
  it("devuelve quince pasos numerados de forma corrida, en orden fijo", () => {
    const pasos = pasosDelAsistente(estadoBase());
    expect(pasos.map((p) => p.numero)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(pasos.map((p) => p.clave)).toEqual([
      "sellers",
      "conductores",
      "bodega",
      "empresa",
      "dte",
      "folios",
      "tarifas",
      "periodos",
      "cobro",
      "cobranza",
      "retencion",
      "retiro",
      "zonas",
      "contacto",
      "plan",
    ]);
  });

  it("🔴 la numeración es CORRIDA y no se reinicia por bloque", () => {
    // «Paso 9 de 14» ubica; «paso 2 del bloque 3» obliga a sumar. Si alguien
    // numera por bloque, esto se pone en rojo.
    const pasos = pasosDelAsistente(estadoBase());
    const numerosPorBloque = BLOQUES.map((b) =>
      pasos.filter((p) => p.bloque === b.clave).map((p) => p.numero),
    );
    expect(numerosPorBloque).toEqual([
      [1, 2, 3],
      [4, 5, 6, 7, 8, 9, 10],
      [11, 12, 13, 14, 15],
    ]);
  });

  it("todo paso pertenece a un bloque declarado", () => {
    const claves = new Set(BLOQUES.map((b) => b.clave));
    for (const p of pasosDelAsistente(estadoBase())) {
      expect(claves.has(p.bloque)).toBe(true);
    }
  });

  it("solo sellers, conductores, DTE y tarifas son críticos", () => {
    // El resto no bloquea operar. Que estén en la lista no los vuelve requisitos.
    //
    // ⚠️ La BODEGA no es crítica a propósito: sin ella la asignación y el
    // manifiesto funcionan igual; lo que se cae es el ruteo, que es otra frase.
    const criticos = pasosDelAsistente(estadoBase())
      .filter((p) => p.critico)
      .map((p) => p.clave);
    expect(criticos).toEqual(["sellers", "conductores", "dte", "tarifas"]);
  });

  it("los cinco pasos con pantalla propia se marcan como resueltos fuera", () => {
    const fuera = pasosDelAsistente(estadoBase())
      .filter((p) => p.seResuelveFuera)
      .map((p) => p.clave);
    expect(fuera).toEqual(["sellers", "conductores", "bodega", "zonas", "plan"]);
  });
});

describe("pasosDelAsistente — DTE y el bloque Emisor", () => {
  it("el certificado en revisión CUENTA como listo", () => {
    // 🐞 El defecto que cerró este bloque: `completo` exigía
    // `estado_certificacion = 'activo'`, valor que nadie escribe nunca, así que
    // el aviso del marco no desaparecía jamás para ningún courier.
    const p = paso(
      estadoBase({
        dte: {
          estado: "en_proceso",
          proveedorElegido: "simplefactura",
          certificadoVenceEn: null,
          camposEmisorFaltantes: [],
        },
      }),
      "dte",
    );
    expect(p.listo).toBe(true);
  });

  it("🔴 los datos del emisor son SU PROPIO paso, no parte del de facturación", () => {
    // Se partieron a propósito: son identidad tributaria de la empresa y sirven
    // aunque Rutax tenga apagada la emisión. Dentro del paso de facturación,
    // apagar el área se los habría llevado por delante.
    const estado = estadoBase({
      dte: {
        estado: "en_proceso",
        proveedorElegido: "simplefactura",
        certificadoVenceEn: null,
        camposEmisorFaltantes: ["giro", "comuna"],
      },
    });
    // El certificado está cargado, así que ese paso está listo…
    expect(paso(estado, "dte").listo).toBe(true);
    // …y lo que falta se ve en el suyo.
    expect(paso(estado, "empresa").listo).toBe(false);
  });

  it("nombra los campos que faltan, con «y» antes del último", () => {
    // Decir «faltan 3» obliga a abrir el paso solo para averiguar cuáles.
    const p = paso(
      estadoBase({
        dte: {
          estado: "en_proceso",
          proveedorElegido: "simplefactura",
          certificadoVenceEn: null,
          camposEmisorFaltantes: ["giro", "dirección", "comuna"],
        },
      }),
      "empresa",
    );
    expect(p.resumen).toContain("giro, dirección y comuna");
  });

  it("escribe la fecha del certificado sin correrla un día", () => {
    // 🐞 `new Date('2027-03-14')` es medianoche UTC = 13 de marzo en Santiago.
    const p = paso(
      estadoBase({
        dte: {
          estado: "activo",
          proveedorElegido: "openfactura",
          certificadoVenceEn: "2027-03-14T00:00:00.000Z",
          camposEmisorFaltantes: [],
        },
      }),
      "dte",
    );
    expect(p.resumen).toContain("14 mar");
  });
});

describe("pasosDelAsistente — folios y su dependencia", () => {
  it("sin proveedor, folios queda BLOQUEADO y con su motivo escrito", () => {
    const folios = paso(estadoBase(), "folios");
    expect(folios.bloqueado).toBe(true);
    expect(folios.dependeDe).toBe("dte");
    expect(folios.motivoBloqueo).toContain("proveedor");
  });

  it("con proveedor elegido, folios se desbloquea", () => {
    const folios = paso(
      estadoBase({
        dte: {
          estado: "pendiente",
          proveedorElegido: "openfactura",
          certificadoVenceEn: null,
          camposEmisorFaltantes: [],
        },
      }),
      "folios",
    );
    expect(folios.bloqueado).toBe(false);
    expect(folios.motivoBloqueo).toBeNull();
  });

  it("folios gestionados por el proveedor cuentan como listos", () => {
    const folios = paso(
      estadoBase({
        dte: {
          estado: "activo",
          proveedorElegido: "simplefactura",
          certificadoVenceEn: null,
          camposEmisorFaltantes: [],
        },
        folios: { estado: "no_aplica", gestionadoPorProveedor: true, cantidadVigentes: 0 },
      }),
      "folios",
    );
    expect(folios.listo).toBe(true);
    expect(folios.resumen).toContain("No tienes que hacer nada");
  });
});

describe("pasosDelAsistente — el resumen lleva el DATO, no la promesa", () => {
  it("cuenta lo que hay en cada paso", () => {
    const estado = estadoBase({
      sellers: { cantidad: 2 },
      conductores: { cantidad: 5 },
      bodegas: { cantidad: 1, hayPrincipal: true },
      // Con proveedor: sin él, folios cae en su rama de dependencia y no llega a
      // contar rangos.
      dte: {
        estado: "activo",
        proveedorElegido: "openfactura",
        certificadoVenceEn: null,
        camposEmisorFaltantes: [],
      },
      folios: { estado: "vigente", gestionadoPorProveedor: false, cantidadVigentes: 3 },
      tarifas: { estado: "configuradas", cantidad: 4 },
      cobranza: { estado: "conectado", bancoConectado: true, cuentaBancoAlias: "Banco de Chile" },
      zonas: { cantidad: 6 },
    });
    expect(paso(estado, "sellers").resumen).toContain("2 sellers");
    expect(paso(estado, "conductores").resumen).toContain("5 conductores activos");
    expect(paso(estado, "bodega").resumen).toContain("principal");
    expect(paso(estado, "folios").resumen).toContain("3 rangos vigentes");
    expect(paso(estado, "tarifas").resumen).toContain("4 tarifas activas");
    expect(paso(estado, "cobranza").resumen).toContain("Banco de Chile");
    expect(paso(estado, "zonas").resumen).toContain("6 zonas activas");
  });

  it("el singular no dice «1 sellers»", () => {
    const estado = estadoBase({ sellers: { cantidad: 1 }, conductores: { cantidad: 1 } });
    expect(paso(estado, "sellers").resumen).toContain("1 seller.");
    expect(paso(estado, "conductores").resumen).toContain("1 conductor activo");
  });

  it("sin tarifas, el resumen dice la consecuencia y no «pendiente»", () => {
    expect(paso(estadoBase(), "tarifas").resumen).toContain("no se puede cobrar");
  });

  it("sin sellers y sin conductores, dice qué se rompe", () => {
    expect(paso(estadoBase(), "sellers").resumen).toContain("ni un pedido");
    expect(paso(estadoBase(), "conductores").resumen).toContain("a quién asignarle");
  });

  it("🔴 la periodicidad heredada se distingue de la elegida", () => {
    // Las dos muestran la misma palabra y solo una es una decisión del courier.
    const heredada = paso(estadoBase(), "periodos");
    expect(heredada.listo).toBe(false);
    expect(heredada.resumen).toContain("Nadie lo eligió");

    const elegida = paso(
      estadoBase({ periodos: { tipoPeriodo: "quincenal", explicita: true } }),
      "periodos",
    );
    expect(elegida.listo).toBe(true);
    expect(elegida.resumen).toContain("Quincenal");
  });

  it("🔴 la retención sin configurar dice el 0% que se está aplicando", () => {
    // El default silencioso es el bug: hay que nombrarlo, no dejarlo en blanco.
    const sinDefinir = paso(estadoBase(), "retencion");
    expect(sinDefinir.listo).toBe(false);
    expect(sinDefinir.resumen).toContain("0%");
  });

  it("🔴 una retención de 0 GUARDADA cuenta como configurada", () => {
    // Un courier con solo conductores dependientes no retiene nada, y eso es una
    // decisión legítima — distinta de no haber tocado nunca el campo.
    const cero = paso(
      estadoBase({ retencion: { configurada: true, porcentaje: 0 } }),
      "retencion",
    );
    expect(cero.listo).toBe(true);
    expect(cero.resumen).toContain("0%");
    expect(cero.resumen).not.toContain("Sin definir");
  });

  it("el porcentaje se escribe sin decimales de relleno", () => {
    const p = paso(estadoBase({ retencion: { configurada: true, porcentaje: 14.5 } }), "retencion");
    expect(p.resumen).toContain("14,5%");
  });

  it("sin cuenta bancaria, dice qué le pasa al seller", () => {
    expect(paso(estadoBase(), "cobro").resumen).toContain("no sabe a dónde pagarte");
  });

  it("sin contacto público, dice a quién deja sin respuesta", () => {
    expect(paso(estadoBase(), "contacto").resumen).toContain("no tiene a quién preguntarle");
  });
});

// =============================================================================
// 🔴 El interruptor de Rutax encoge el asistente
// =============================================================================

describe("pasosDelAsistente — áreas apagadas", () => {
  it("con TODAS las áreas apagadas quedan nueve pasos, renumerados sin huecos", () => {
    // Es la promesa del encargo: no se le pide al courier que configure algo que
    // Rutax todavía no le va a dejar usar.
    const pasos = pasosDelAsistente(estadoBase(), []);
    expect(pasos.map((p) => p.clave)).toEqual([
      "sellers",
      "conductores",
      "bodega",
      "empresa",
      "tarifas",
      "periodos",
      "retiro",
      "zonas",
      "contacto",
    ]);
    // 🔴 Renumerados de 1 a 9: si se filtrara DESPUÉS de numerar, el asistente
    // diría «paso 4 de 9» con huecos y el conteo dejaría de cuadrar.
    expect(pasos.map((p) => p.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("🔴 los datos de la empresa SOBREVIVEN a todo apagado", () => {
    // Giro, dirección, comuna y actividad económica son identidad tributaria: no
    // dependen de que se pueda emitir. Por eso son un paso aparte.
    const claves = pasosDelAsistente(estadoBase(), []).map((p) => p.clave);
    expect(claves).toContain("empresa");
    expect(claves).not.toContain("dte");
  });

  it("cada área se lleva solo lo suyo", () => {
    const soloFolios = pasosDelAsistente(estadoBase(), ["folios_caf"]).map((p) => p.clave);
    expect(soloFolios).toContain("dte");
    expect(soloFolios).toContain("folios");
    expect(soloFolios).not.toContain("plan");
    expect(soloFolios).not.toContain("retencion");
    expect(soloFolios).not.toContain("cobranza");
  });

  it("con todo encendido no se pierde ningún paso (contraprueba)", () => {
    // Sin esto, un filtro que quitara SIEMPRE pasaría las pruebas de arriba.
    expect(pasosDelAsistente(estadoBase(), [...AREAS_PRODUCTO])).toHaveLength(15);
    expect(pasosDelAsistente(estadoBase())).toHaveLength(15);
  });
});

describe("siguientePendiente", () => {
  const pasos = pasosDelAsistente(estadoBase());

  it("propone el siguiente pendiente hacia adelante", () => {
    expect(siguientePendiente(pasos, "sellers")?.clave).toBe("conductores");
  });

  it("da la vuelta cuando ya no queda nada por delante", () => {
    // Desde el último paso mira los anteriores; folios está bloqueado, así que
    // el primero alcanzable es sellers.
    expect(siguientePendiente(pasos, "plan")?.clave).toBe("sellers");
  });

  it("no se propone a sí mismo", () => {
    expect(siguientePendiente(pasos, "conductores")?.clave).not.toBe("conductores");
  });

  it("salta los bloqueados", () => {
    // Folios está bloqueado sin proveedor: tras DTE toca tarifas.
    expect(siguientePendiente(pasos, "dte")?.clave).toBe("tarifas");
  });

  it("devuelve null cuando no queda ningún pendiente alcanzable", () => {
    const todosListos = pasosDelAsistente(
      estadoBase({
        sellers: { cantidad: 1 },
        conductores: { cantidad: 1 },
        bodegas: { cantidad: 1, hayPrincipal: true },
        dte: {
          estado: "activo",
          proveedorElegido: "simplefactura",
          certificadoVenceEn: null,
          camposEmisorFaltantes: [],
        },
        folios: { estado: "no_aplica", gestionadoPorProveedor: true, cantidadVigentes: 0 },
        tarifas: { estado: "configuradas", cantidad: 1 },
        periodos: { tipoPeriodo: "quincenal", explicita: true },
        datosCobro: { configurado: true, banco: "BCI" },
        cobranza: { estado: "conectado", bancoConectado: true, cuentaBancoAlias: "BCI" },
        retencion: { configurada: true, porcentaje: 14.5 },
        retiro: { montoVisitaClp: 1500 },
        zonas: { cantidad: 2 },
        contacto: { telefono: "+56912345678", email: null },
        plan: { estado: "activa", nombrePlan: "Estándar", trialHasta: null },
      }),
    );
    expect(siguientePendiente(todosListos, "sellers")).toBeNull();
  });
});

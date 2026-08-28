/**
 * Tests del interruptor de áreas — lo que Rutax apaga por courier.
 * =============================================================================
 *
 * Lo que estas pruebas protegen es una promesa concreta hecha al usuario: cuando
 * Rutax apaga «emisión de facturas» o «pago a conductores», el courier
 * **conserva las pantallas donde VE cuánto le debe cada seller y cuánto le debe
 * a cada conductor**. Antes de separar ver de hacer, apagar esas áreas borraba
 * justo esas pantallas, porque `emitir_facturas` gateaba las dos cosas.
 *
 * Si alguien vuelve a meter una capacidad de lectura dentro de un área, o gatea
 * una pantalla de lectura con una capacidad de acción, esto se pone en rojo.
 */

import { describe, it, expect } from "vitest";

import {
  AREAS_PRODUCTO,
  DESCRIPCION_AREAS,
  areaDeCapacidad,
  capacidadesDeArea,
  esAreaProducto,
  type AreaProducto,
} from "./areas-producto";
import { CAPACIDADES, tieneCapacidad, type Capacidad } from "./capacidades";
import type { UsuarioActual } from "./usuario-actual";

function usuario(overrides: Partial<UsuarioActual> = {}): UsuarioActual {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "dueno",
    estado: "activo",
    areasHabilitadas: [...AREAS_PRODUCTO],
    ...overrides,
  };
}

// =============================================================================
// Forma del catálogo
// =============================================================================

describe("catálogo de áreas", () => {
  it("cada área tiene su descripción, y no sobra ninguna", () => {
    // Si se agrega un área al tipo y no al catálogo, el panel del backstage la
    // omitiría en silencio y Rutax no podría encenderla nunca.
    expect(DESCRIPCION_AREAS.map((d) => d.clave).sort()).toEqual([...AREAS_PRODUCTO].sort());
  });

  it("esAreaProducto falla cerrado ante cualquier otra cosa", () => {
    expect(esAreaProducto("emision_facturas")).toBe(true);
    expect(esAreaProducto("dinero")).toBe(false);
    expect(esAreaProducto("")).toBe(false);
    expect(esAreaProducto(null)).toBe(false);
    expect(esAreaProducto(undefined)).toBe(false);
  });

  it("toda capacidad de un área existe en el catálogo de RBAC", () => {
    // Un typo acá haría que el área apagara una capacidad que no existe, o sea
    // que no apagara nada — y el interruptor parecería funcionar.
    for (const area of AREAS_PRODUCTO) {
      for (const cap of capacidadesDeArea(area)) {
        expect(CAPACIDADES).toContain(cap);
      }
    }
  });

  it("ninguna capacidad pertenece a DOS áreas", () => {
    const vistas = new Map<Capacidad, AreaProducto>();
    for (const area of AREAS_PRODUCTO) {
      for (const cap of capacidadesDeArea(area)) {
        expect(vistas.has(cap)).toBe(false);
        vistas.set(cap, area);
      }
    }
  });
});

// =============================================================================
// 🔴 La promesa: la lectura NO se apaga
// =============================================================================

describe("ver y hacer están separados", () => {
  const LECTURAS_QUE_NUNCA_SE_APAGAN: Capacidad[] = [
    "ver_periodos_cobro",
    "ver_liquidaciones",
    "ver_reportes_ejecutivos",
  ];

  it("🔴 ninguna capacidad de lectura del dinero pertenece a un área", () => {
    for (const cap of LECTURAS_QUE_NUNCA_SE_APAGAN) {
      expect(areaDeCapacidad(cap)).toBeNull();
    }
  });

  it("🔴 con TODAS las áreas apagadas, el dueño sigue viendo sus cifras", () => {
    // Es el encargo, literal: «hay cosas valiosas que sí pueden ver — los cobros,
    // la cantidad que se le debe pagar a los conductores, la que se le debe
    // cobrar a los sellers, y la reportería».
    const u = usuario({ areasHabilitadas: [] });
    expect(tieneCapacidad(u, "ver_periodos_cobro")).toBe(true);
    expect(tieneCapacidad(u, "ver_liquidaciones")).toBe(true);
    expect(tieneCapacidad(u, "ver_reportes_ejecutivos")).toBe(true);
  });

  it("🔴 con TODAS las áreas apagadas, el dueño NO puede mover dinero", () => {
    const u = usuario({ areasHabilitadas: [] });
    expect(tieneCapacidad(u, "emitir_facturas")).toBe(false);
    expect(tieneCapacidad(u, "aprobar_facturacion")).toBe(false);
    expect(tieneCapacidad(u, "gestionar_liquidaciones_conductores")).toBe(false);
    expect(tieneCapacidad(u, "gestionar_cobranza")).toBe(false);
    expect(tieneCapacidad(u, "ver_conciliacion")).toBe(false);
    expect(tieneCapacidad(u, "gestionar_configuracion_dte")).toBe(false);
    expect(tieneCapacidad(u, "gestionar_suscripcion")).toBe(false);
  });

  it("apagar un área NO toca la operación", () => {
    // El courier tiene que seguir operando entero: pedidos, asignación,
    // manifiestos, incidencias, ruteo, torre.
    const u = usuario({ areasHabilitadas: [] });
    for (const cap of [
      "asignar_y_reasignar_pedidos",
      "generar_manifiestos",
      "gestionar_incidencias",
      "ajustar_operacion_diaria",
      "ver_preparacion_dia",
      "gestionar_bodegas",
      "ver_torre_control",
      "gestionar_tarifas",
      "sincronizar_conexiones_ml",
    ] as Capacidad[]) {
      expect(tieneCapacidad(u, cap)).toBe(true);
    }
  });
});

// =============================================================================
// El interruptor, área por área
// =============================================================================

describe("tieneCapacidad — el interruptor por área", () => {
  it("encender solo un área habilita solo lo suyo", () => {
    const u = usuario({ areasHabilitadas: ["emision_facturas"] });
    expect(tieneCapacidad(u, "emitir_facturas")).toBe(true);
    expect(tieneCapacidad(u, "gestionar_liquidaciones_conductores")).toBe(false);
    expect(tieneCapacidad(u, "ver_conciliacion")).toBe(false);
  });

  it("con todo encendido, el dueño tiene todas sus capacidades de siempre", () => {
    // Contraprueba: sin ella, un interruptor que apagara SIEMPRE pasaría las
    // pruebas de arriba y dejaría el producto inutilizable.
    const u = usuario();
    expect(tieneCapacidad(u, "emitir_facturas")).toBe(true);
    expect(tieneCapacidad(u, "gestionar_liquidaciones_conductores")).toBe(true);
    expect(tieneCapacidad(u, "ver_conciliacion")).toBe(true);
    expect(tieneCapacidad(u, "gestionar_suscripcion")).toBe(true);
  });

  it("🔴 el área no le da a nadie una capacidad que su rol no tiene", () => {
    // El interruptor RESTA, nunca suma. Un coordinador con todas las áreas
    // encendidas sigue sin poder emitir facturas.
    const coordinador = usuario({ rol: "coordinador" });
    expect(tieneCapacidad(coordinador, "emitir_facturas")).toBe(false);
    expect(tieneCapacidad(coordinador, "ver_periodos_cobro")).toBe(false);
  });

  it("una cuenta no activa no ejerce nada, aunque tenga todo encendido", () => {
    expect(tieneCapacidad(usuario({ estado: "invitado" }), "ver_periodos_cobro")).toBe(false);
    expect(tieneCapacidad(usuario({ estado: "suspendido" }), "emitir_facturas")).toBe(false);
  });

  it("🔴 sin `areasHabilitadas` en ejecución, niega en vez de reventar", () => {
    // El tipo lo exige, pero un objeto deserializado o un doble sin tipar puede
    // llegar sin él. Lanzar dentro de la función que arma la navegación dejaría
    // la página en blanco; negar esconde un botón.
    const sinCampo = { ...usuario(), areasHabilitadas: undefined } as unknown as UsuarioActual;
    expect(() => tieneCapacidad(sinCampo, "emitir_facturas")).not.toThrow();
    expect(tieneCapacidad(sinCampo, "emitir_facturas")).toBe(false);
    // Y lo que no es de área sigue funcionando.
    expect(tieneCapacidad(sinCampo, "ver_periodos_cobro")).toBe(true);
  });
});

// =============================================================================
// `ver_documentos_propios` sirve a dos audiencias con la misma llave
// =============================================================================

describe("el seller y el conductor entran por sus propias capacidades", () => {
  it("el DTE del seller depende de la emisión de facturas", () => {
    expect(areaDeCapacidad("ver_documentos_propios")).toBe("emision_facturas");
  });

  it("🔴 la liquidación del conductor depende del pago a conductores", () => {
    // Una versión anterior mapeaba `ver_documentos_propios` por tipo de usuario
    // creyendo que servía a los dos. La matriz dice otra cosa: el conductor usa
    // `ver_liquidacion_propia`, que con aquel mapeo NO quedaba gateada por
    // ningún área — o sea que el conductor habría seguido viendo su liquidación
    // con el pago apagado.
    expect(areaDeCapacidad("ver_liquidacion_propia")).toBe("pago_conductores");
  });

  it("🔴 apagar el pago a conductores NO le quita el DTE al seller", () => {
    // Una sola capacidad sirve a dos audiencias; mapearla a un área fija habría
    // castigado a la mitad equivocada.
    const seller = usuario({
      tipoUsuario: "seller",
      rol: "seller",
      sellerId: "22222222-2222-2222-2222-222222222222",
      areasHabilitadas: ["emision_facturas"],
    });
    expect(tieneCapacidad(seller, "ver_documentos_propios")).toBe(true);

    const conductor = usuario({
      tipoUsuario: "conductor",
      rol: "conductor",
      driverId: "33333333-3333-3333-3333-333333333333",
      areasHabilitadas: ["emision_facturas"],
    });
    expect(tieneCapacidad(conductor, "ver_liquidacion_propia")).toBe(false);
  });

  it("y al revés: con solo el pago encendido, el conductor ve y el seller no", () => {
    const conductor = usuario({
      tipoUsuario: "conductor",
      rol: "conductor",
      driverId: "33333333-3333-3333-3333-333333333333",
      areasHabilitadas: ["pago_conductores"],
    });
    expect(tieneCapacidad(conductor, "ver_liquidacion_propia")).toBe(true);

    const seller = usuario({
      tipoUsuario: "seller",
      rol: "seller",
      sellerId: "22222222-2222-2222-2222-222222222222",
      areasHabilitadas: ["pago_conductores"],
    });
    expect(tieneCapacidad(seller, "ver_documentos_propios")).toBe(false);
  });
});

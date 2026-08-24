import { describe, it, expect } from "vitest";
import { pasosDelAsistente, siguientePendiente } from "./pasos";
import type { EstadoOnboardingCourier } from "./estado";

function estadoBase(parcial: Partial<EstadoOnboardingCourier> = {}): EstadoOnboardingCourier {
  return {
    nombreFantasia: "Despachos del Centro",
    completo: false,
    pasosCompletados: 0,
    totalPasos: 5,
    faltaParaOperar: "facturación",
    dte: { estado: "pendiente", proveedorElegido: null, certificadoVenceEn: null },
    folios: { estado: "pendiente", gestionadoPorProveedor: false, cantidadVigentes: 0 },
    tarifas: { estado: "sin_tarifas", cantidad: 0 },
    cobranza: { estado: "pendiente", bancoConectado: false, cuentaBancoAlias: null },
    plan: { estado: "sin_suscripcion", nombrePlan: null, trialHasta: null },
    ...parcial,
  };
}

describe("pasosDelAsistente", () => {
  it("devuelve los cinco pasos numerados del 1 al 5, en orden fijo", () => {
    const pasos = pasosDelAsistente(estadoBase());
    expect(pasos.map((p) => p.numero)).toEqual([1, 2, 3, 4, 5]);
    expect(pasos.map((p) => p.clave)).toEqual(["dte", "folios", "tarifas", "cobranza", "plan"]);
  });

  it("solo DTE y tarifas son críticos", () => {
    // Los otros tres son informativos y no bloquean operar. Que estén en la
    // lista no los vuelve requisitos.
    const criticos = pasosDelAsistente(estadoBase())
      .filter((p) => p.critico)
      .map((p) => p.clave);
    expect(criticos).toEqual(["dte", "tarifas"]);
  });

  it("el certificado en revisión CUENTA como listo", () => {
    // 🐞 El defecto que cerró este bloque: `completo` exigía
    // `estado_certificacion = 'activo'`, valor que nadie escribe nunca, así que
    // el aviso del marco no desaparecía jamás para ningún courier.
    const pasos = pasosDelAsistente(
      estadoBase({
        dte: { estado: "en_proceso", proveedorElegido: "simplefactura", certificadoVenceEn: null },
      }),
    );
    expect(pasos[0].listo).toBe(true);
  });

  it("sin proveedor, folios queda BLOQUEADO y con su motivo escrito", () => {
    const folios = pasosDelAsistente(estadoBase())[1];
    expect(folios.bloqueado).toBe(true);
    expect(folios.dependeDe).toBe("dte");
    expect(folios.motivoBloqueo).toContain("proveedor");
  });

  it("con proveedor elegido, folios se desbloquea", () => {
    const folios = pasosDelAsistente(
      estadoBase({
        dte: { estado: "pendiente", proveedorElegido: "openfactura", certificadoVenceEn: null },
      }),
    )[1];
    expect(folios.bloqueado).toBe(false);
    expect(folios.motivoBloqueo).toBeNull();
  });

  it("folios gestionados por el proveedor cuentan como listos", () => {
    const folios = pasosDelAsistente(
      estadoBase({
        dte: { estado: "activo", proveedorElegido: "simplefactura", certificadoVenceEn: null },
        folios: { estado: "no_aplica", gestionadoPorProveedor: true, cantidadVigentes: 0 },
      }),
    )[1];
    expect(folios.listo).toBe(true);
    expect(folios.resumen).toContain("No tienes que hacer nada");
  });

  it("el resumen lleva el DATO, no la promesa", () => {
    const pasos = pasosDelAsistente(
      estadoBase({
        dte: { estado: "activo", proveedorElegido: "openfactura", certificadoVenceEn: null },
        folios: { estado: "vigente", gestionadoPorProveedor: false, cantidadVigentes: 3 },
        tarifas: { estado: "configuradas", cantidad: 4 },
        cobranza: { estado: "conectado", bancoConectado: true, cuentaBancoAlias: "Banco de Chile" },
      }),
    );
    expect(pasos[1].resumen).toContain("3 rangos vigentes");
    expect(pasos[2].resumen).toContain("4 tarifas activas");
    expect(pasos[3].resumen).toContain("Banco de Chile");
  });

  it("sin tarifas, el resumen dice la consecuencia y no «pendiente»", () => {
    // Una entrega sin tarifa se hace igual y no se puede cobrar: eso es lo que
    // hay que leer, no un rótulo de estado.
    expect(pasosDelAsistente(estadoBase())[2].resumen).toContain("no se puede cobrar");
  });

  it("escribe la fecha del certificado sin correrla un día", () => {
    // Fecha civil: pasarla por `Date` la interpretaría como medianoche UTC, que
    // en Santiago es el día anterior.
    const paso = pasosDelAsistente(
      estadoBase({
        dte: {
          estado: "activo",
          proveedorElegido: "openfactura",
          certificadoVenceEn: "2027-03-14",
        },
      }),
    )[0];
    expect(paso.resumen).toContain("14 mar");
  });
});

describe("siguientePendiente", () => {
  const pasos = pasosDelAsistente(
    estadoBase({
      dte: { estado: "activo", proveedorElegido: "openfactura", certificadoVenceEn: null },
    }),
  );

  it("propone el siguiente pendiente hacia adelante", () => {
    expect(siguientePendiente(pasos, "dte")?.clave).toBe("folios");
  });

  it("da la vuelta cuando ya no queda nada por delante", () => {
    // Es el caso real: el dueño abre el paso 4 por el medio y no hay nada
    // después. Sin la vuelta, el botón «Seguir con…» desaparece justo ahí.
    expect(siguientePendiente(pasos, "plan")?.clave).toBe("folios");
  });

  it("no se propone a sí mismo", () => {
    expect(siguientePendiente(pasos, "folios")?.clave).not.toBe("folios");
  });

  it("salta los bloqueados", () => {
    // Mandar a alguien a un paso que no puede completar es peor que no
    // ofrecerle nada.
    const conFoliosBloqueado = pasosDelAsistente(estadoBase());
    expect(siguientePendiente(conFoliosBloqueado, "dte")?.clave).toBe("tarifas");
  });

  it("devuelve null cuando no queda ningún pendiente alcanzable", () => {
    const todosListos = pasosDelAsistente(
      estadoBase({
        dte: { estado: "activo", proveedorElegido: "openfactura", certificadoVenceEn: null },
        folios: { estado: "vigente", gestionadoPorProveedor: false, cantidadVigentes: 2 },
        tarifas: { estado: "configuradas", cantidad: 1 },
        cobranza: { estado: "conectado", bancoConectado: true, cuentaBancoAlias: "Banco" },
        plan: { estado: "activa", nombrePlan: "Pro", trialHasta: null },
      }),
    );
    expect(siguientePendiente(todosListos, "dte")).toBeNull();
  });
});

/**
 * Pruebas de integración de las Server Actions de escritura del backstage de
 * suscripciones (`suscripciones/acciones.ts`) — F3-A, adversarial.
 *
 * Estas Server Actions son la SUPERFICIE REAL que invocan los formularios de
 * `/admin/suscripciones/*` — `autorizacion-admin.test.ts` ya prueba
 * `exigirSuperAdminEscritura` en aislamiento, y `sesion-admin.test.ts` ya
 * prueba que `exigirActorAdmin` propaga esa excepción tal cual. Lo que NINGÚN
 * test existente cierra es el circuito completo: que cuando el gate rechaza
 * (rol `soporte_lectura` o sesión sin AAL2), la Server Action NUNCA invoca la
 * mutación subyacente de `modules/plataforma/acciones.ts` — es decir, que el
 * bloqueo ocurre ANTES de tocar la base de datos, no solo que la respuesta HTTP
 * sea `{ok:false}`. Esa es la propiedad de seguridad que de verdad importa: un
 * atacante que se salte la UI (curl directo a la Server Action) no debe poder
 * ejecutar NINGÚN efecto, sin importar qué devuelva el catch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../sesion-admin", () => ({
  exigirActorAdmin: vi.fn(),
}));

vi.mock("@/modules/plataforma/acciones", () => ({
  asignarPlan: vi.fn(),
  activarSuscripcion: vi.fn(),
  suspenderSuscripcion: vi.fn(),
  cancelarSuscripcion: vi.fn(),
  registrarPagoManual: vi.fn(),
  generarLinkCobroPeriodo: vi.fn(),
  establecerCaracteristicasOverride: vi.fn(),
  establecerEmisionDteReal: vi.fn(),
}));

import { exigirActorAdmin } from "../sesion-admin";
import {
  asignarPlan,
  activarSuscripcion,
  suspenderSuscripcion,
  cancelarSuscripcion,
  registrarPagoManual,
  generarLinkCobroPeriodo,
  establecerCaracteristicasOverride,
  establecerEmisionDteReal,
} from "@/modules/plataforma/acciones";
import {
  accionAsignarPlan,
  accionActivarSuscripcion,
  accionSuspenderSuscripcion,
  accionCancelarSuscripcion,
  accionRegistrarPagoManual,
  accionGenerarLinkCobro,
  accionEstablecerOverride,
  accionEstablecerEmisionDteReal,
} from "./acciones";

// Errores tipados reales (mismo shape que `@/modules/plataforma/autorizacion-admin`,
// re-declarados aquí a propósito: el mock de `../sesion-admin` no reexporta el
// módulo real, así que el `catch` genérico de cada Server Action solo puede
// distinguir por `.message`, que es justo lo que se está probando).
class RequierePermisoEscritura extends Error {
  constructor() {
    super("Tu rol de soporte (solo lectura) no puede realizar esta acción.");
    this.name = "RequierePermisoEscritura";
  }
}
class RequiereAal2 extends Error {
  constructor() {
    super("Esta acción exige verificación en dos pasos (MFA) en esta sesión.");
    this.name = "RequiereAal2";
  }
}

const ACTOR_ESCRITURA = {
  adminSecret: "secreto-test",
  actorUsuarioId: "ad000000-0000-0000-0000-000000000001",
  rolAdmin: "admin_total" as const,
  aal: "aal2" as const,
};

function formData(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Tabla de las 8 acciones de escritura de este archivo, cada una con:
 * - el `FormData` mínimo que necesita para no fallar por validación antes del gate,
 * - la Server Action a invocar,
 * - el mock de la mutación subyacente que NO debe tocarse si el gate rechaza.
 */
const ACCIONES = [
  {
    nombre: "accionAsignarPlan",
    ejecutar: accionAsignarPlan,
    fd: formData({ tenant_id: "t1", plan_id: "p1", estado: "trial" }),
    mutacion: asignarPlan,
  },
  {
    nombre: "accionActivarSuscripcion",
    ejecutar: accionActivarSuscripcion,
    fd: formData({ suscripcion_id: "s1" }),
    mutacion: activarSuscripcion,
  },
  {
    nombre: "accionSuspenderSuscripcion",
    ejecutar: accionSuspenderSuscripcion,
    fd: formData({ suscripcion_id: "s1" }),
    mutacion: suspenderSuscripcion,
  },
  {
    nombre: "accionCancelarSuscripcion",
    ejecutar: accionCancelarSuscripcion,
    fd: formData({ suscripcion_id: "s1" }),
    mutacion: cancelarSuscripcion,
  },
  {
    nombre: "accionRegistrarPagoManual",
    ejecutar: accionRegistrarPagoManual,
    fd: formData({ periodo_id: "pe1" }),
    mutacion: registrarPagoManual,
  },
  {
    nombre: "accionGenerarLinkCobro",
    ejecutar: accionGenerarLinkCobro,
    fd: formData({ periodo_id: "pe1" }),
    mutacion: generarLinkCobroPeriodo,
  },
  {
    nombre: "accionEstablecerOverride",
    ejecutar: accionEstablecerOverride,
    fd: formData({ tenant_id: "t1" }),
    mutacion: establecerCaracteristicasOverride,
  },
  {
    nombre: "accionEstablecerEmisionDteReal",
    ejecutar: accionEstablecerEmisionDteReal,
    fd: formData({ tenant_id: "t1", habilitada: "true" }),
    mutacion: establecerEmisionDteReal,
  },
] as const;

describe("Server Actions de escritura de suscripciones — gate soporte_lectura", () => {
  for (const { nombre, ejecutar, fd, mutacion } of ACCIONES) {
    it(`${nombre}: rol soporte_lectura → {ok:false}, la mutación NUNCA se invoca`, async () => {
      vi.mocked(exigirActorAdmin).mockRejectedValue(new RequierePermisoEscritura());

      const resultado = await ejecutar(fd);

      expect(resultado.ok).toBe(false);
      expect((resultado as { mensaje?: string }).mensaje).toMatch(/solo lectura/i);
      expect(mutacion).not.toHaveBeenCalled();
    });

    it(`${nombre}: sesión sin AAL2 (MFA no verificado) → {ok:false}, la mutación NUNCA se invoca`, async () => {
      vi.mocked(exigirActorAdmin).mockRejectedValue(new RequiereAal2());

      const resultado = await ejecutar(fd);

      expect(resultado.ok).toBe(false);
      expect((resultado as { mensaje?: string }).mensaje).toMatch(/dos pasos|mfa/i);
      expect(mutacion).not.toHaveBeenCalled();
    });
  }
});

describe("Server Actions de escritura de suscripciones — camino feliz (admin_total + AAL2)", () => {
  beforeEach(() => {
    vi.mocked(exigirActorAdmin).mockResolvedValue(ACTOR_ESCRITURA);
  });

  it("accionAsignarPlan: propaga adminSecret + actorUsuarioId REAL a la mutación", async () => {
    vi.mocked(asignarPlan).mockResolvedValue({ ok: true } as never);

    const resultado = await accionAsignarPlan(
      formData({ tenant_id: "t1", plan_id: "p1", estado: "activa" }),
    );

    expect(resultado).toEqual({ ok: true });
    expect(asignarPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        adminSecret: ACTOR_ESCRITURA.adminSecret,
        actorUsuarioId: ACTOR_ESCRITURA.actorUsuarioId,
        tenantId: "t1",
        planId: "p1",
        estado: "activa",
      }),
    );
  });

  it("accionEstablecerEmisionDteReal: propaga actorUsuarioId REAL (nunca null) al opt-in de DTE real", async () => {
    vi.mocked(establecerEmisionDteReal).mockResolvedValue({ ok: true } as never);

    await accionEstablecerEmisionDteReal(formData({ tenant_id: "t1", habilitada: "true" }));

    expect(establecerEmisionDteReal).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUsuarioId: ACTOR_ESCRITURA.actorUsuarioId,
        tenantId: "t1",
        habilitada: true,
      }),
    );
  });
});

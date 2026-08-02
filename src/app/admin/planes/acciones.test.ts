/**
 * Pruebas de integración de las Server Actions de escritura del CRUD de planes
 * (`planes/acciones.ts`) — F3-A, adversarial. Mismo objetivo que
 * `suscripciones/acciones.test.ts`: probar que cuando `exigirActorAdmin`
 * rechaza (rol `soporte_lectura` o sesión sin AAL2), la mutación subyacente de
 * `modules/plataforma/acciones.ts` NUNCA se invoca — el bloqueo real está en
 * el servidor, no solo en lo que la UI oculta.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../sesion-admin", () => ({
  exigirActorAdmin: vi.fn(),
}));

vi.mock("@/modules/plataforma/acciones", () => ({
  crearPlan: vi.fn(),
  actualizarPlan: vi.fn(),
  activarDesactivarPlan: vi.fn(),
}));

import { exigirActorAdmin } from "../sesion-admin";
import { crearPlan, actualizarPlan, activarDesactivarPlan } from "@/modules/plataforma/acciones";
import { accionCrearPlan, accionActualizarPlan, accionActivarDesactivarPlan } from "./acciones";

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

const ACCIONES = [
  {
    nombre: "accionCrearPlan",
    ejecutar: accionCrearPlan,
    fd: formData({ nombre: "Pro", precio_mensual_clp: "50000", precio_anual_clp: "500000" }),
    mutacion: crearPlan,
  },
  {
    nombre: "accionActualizarPlan",
    ejecutar: accionActualizarPlan,
    fd: formData({ plan_id: "p1", nombre: "Pro", precio_mensual_clp: "50000", precio_anual_clp: "500000" }),
    mutacion: actualizarPlan,
  },
  {
    nombre: "accionActivarDesactivarPlan",
    ejecutar: accionActivarDesactivarPlan,
    fd: formData({ plan_id: "p1", activo: "false" }),
    mutacion: activarDesactivarPlan,
  },
] as const;

describe("Server Actions de escritura de planes — gate soporte_lectura / AAL2", () => {
  for (const { nombre, ejecutar, fd, mutacion } of ACCIONES) {
    it(`${nombre}: rol soporte_lectura → {ok:false}, la mutación NUNCA se invoca`, async () => {
      vi.mocked(exigirActorAdmin).mockRejectedValue(new RequierePermisoEscritura());

      const resultado = await ejecutar(fd);

      expect(resultado.ok).toBe(false);
      expect(mutacion).not.toHaveBeenCalled();
    });

    it(`${nombre}: sesión sin AAL2 → {ok:false}, la mutación NUNCA se invoca`, async () => {
      vi.mocked(exigirActorAdmin).mockRejectedValue(new RequiereAal2());

      const resultado = await ejecutar(fd);

      expect(resultado.ok).toBe(false);
      expect(mutacion).not.toHaveBeenCalled();
    });
  }

  it("accionCrearPlan: camino feliz propaga actorUsuarioId REAL a la mutación", async () => {
    vi.mocked(exigirActorAdmin).mockResolvedValue(ACTOR_ESCRITURA);
    vi.mocked(crearPlan).mockResolvedValue({ ok: true } as never);

    await accionCrearPlan(formData({ nombre: "Pro", precio_mensual_clp: "50000", precio_anual_clp: "500000" }));

    expect(crearPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        adminSecret: ACTOR_ESCRITURA.adminSecret,
        actorUsuarioId: ACTOR_ESCRITURA.actorUsuarioId,
        nombre: "Pro",
      }),
    );
  });
});

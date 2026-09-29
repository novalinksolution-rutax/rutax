/**
 * QA — el gate de la puesta en marcha en `(tenant)/layout.tsx`, ejecutado de verdad.
 *
 * El layout es un Server Component: se llama como función `async` y se inspecciona
 * lo que devuelve (o el `redirect` que lanza). Solo se sustituye el borde
 * (sesión, cliente Supabase, componentes pesados); la decisión del gate es la real,
 * incluida `leerGatePuestaEnMarcha`.
 *
 * Lo que fija:
 *   · Courier sin fila / fila sin marca ⇒ NO entra a ninguna ruta de `(tenant)`:
 *     el dueño va a `/puesta-en-marcha`; cualquier otro rol ve la pantalla
 *     pendiente (sin redirigir: no puede completar).
 *   · Error de lectura ⇒ bloqueado TAMBIÉN, pero SIN redirect (sería el bucle).
 *   · Con marca (incluida la del backfill, sin autor) ⇒ pasa.
 *   · Seller y conductor salen antes del gate, a su superficie.
 *   · Bloqueado no dispara las lecturas pesadas del shell (avisos, conciliación).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sesion: null as unknown,
  gate: { data: null as unknown, error: null as unknown, lanza: false },
  avisos: vi.fn(async () => []),
  conciliacion: vi.fn(async () => []),
}));

class Redireccion extends Error {
  constructor(public destino: string) {
    super(`REDIRECT:${destino}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Redireccion(destino);
  },
}));
vi.mock("lucide-react", () => ({ UserRound: () => null }));
vi.mock("@/lib/identidad/cerrar-sesion", () => ({ cerrarSesion: vi.fn() }));
vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  obtenerSesionActual: vi.fn(async () => m.sesion),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (tabla: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = {};
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = async () => {
        if (tabla === "courier_config_operacion") {
          if (m.gate.lanza) throw new Error("red caída");
          return { data: m.gate.data, error: m.gate.error };
        }
        return { data: { nombre_fantasia: "Novalink" }, error: null };
      };
      return c;
    },
  })),
}));
vi.mock("@/modules/identidad/capacidades", async () => {
  // Todas las capacidades en falso: lo que se prueba es el gate, no la navegación.
  const real = await vi.importActual<Record<string, unknown>>("@/modules/identidad/capacidades");
  return Object.fromEntries(
    Object.entries(real).map(([k, v]) => [k, typeof v === "function" ? () => false : v]),
  );
});
vi.mock("@/components/app-shell/app-shell", () => ({ AppShell: function AppShell() { return null; } }));
vi.mock("@/app/(tenant)/configuracion/_componentes/lanzador-herramienta-prueba", () => ({
  LanzadorHerramientaPrueba: () => null,
}));
vi.mock("@/components/app-shell/destinos-movil", () => ({ destinosMovil: () => [] }));
vi.mock("@/components/puesta-en-marcha/pantalla-empresa-pendiente", () => ({
  PantallaEmpresaPendiente: function PantallaEmpresaPendiente() { return null; },
}));
vi.mock("@/lib/avisos/obtener-avisos", () => ({ obtenerAvisos: (...a: unknown[]) => m.avisos(...(a as [])) }));
vi.mock("@/lib/supabase/service-role", () => ({ crearClienteServiceRole: () => ({}) }));
vi.mock("@/modules/dinero/index", () => ({
  listarEventosConciliacion: (...a: unknown[]) => m.conciliacion(...(a as [])),
}));

import LayoutTenant from "./layout";
import { PantallaEmpresaPendiente } from "@/components/puesta-en-marcha/pantalla-empresa-pendiente";

const TENANT = "11111111-1111-1111-1111-111111111111";

function sesion(sobre: Record<string, unknown> = {}) {
  return {
    usuarioId: "u1",
    usuario: { tenantId: TENANT, tipoUsuario: "interno", estado: "activo", rol: "dueno", ...sobre },
  };
}

async function correr(): Promise<{ redirigio: string | null; resultado: unknown }> {
  try {
    const resultado = await LayoutTenant({ children: null });
    return { redirigio: null, resultado };
  } catch (e) {
    if (e instanceof Redireccion) return { redirigio: e.destino, resultado: null };
    throw e;
  }
}

function esPendiente(resultado: unknown): { motivo: string } | null {
  const el = resultado as { type?: unknown; props?: { motivo?: string } } | null;
  return el && el.type === PantallaEmpresaPendiente ? { motivo: el.props?.motivo as string } : null;
}

beforeEach(() => {
  m.sesion = sesion();
  m.gate = { data: null, error: null, lanza: false };
  m.avisos.mockClear();
  m.conciliacion.mockClear();
});

describe("gate de la puesta en marcha en (tenant)/layout", () => {
  it("courier SIN fila: el dueño va a /puesta-en-marcha", async () => {
    const r = await correr();
    expect(r.redirigio).toBe("/puesta-en-marcha");
  });

  it("fila sin marca de completado: el dueño va a /puesta-en-marcha", async () => {
    m.gate.data = { puesta_en_marcha_completada_en: null, puesta_en_marcha_completada_por: null };
    expect((await correr()).redirigio).toBe("/puesta-en-marcha");
  });

  for (const rol of ["supervisor", "coordinador", "administracion"]) {
    it(`${rol} con courier pendiente: pantalla «no_dueno», SIN redirect (no puede completar)`, async () => {
      m.sesion = sesion({ rol });
      const r = await correr();
      expect(r.redirigio).toBeNull();
      expect(esPendiente(r.resultado)).toEqual({ motivo: "no_dueno" });
    });
  }

  it("error de lectura del gate (error de la base): bloquea SIN redirigir — no hay bucle", async () => {
    m.gate.error = { message: "boom" };
    const r = await correr();
    expect(r.redirigio).toBeNull();
    expect(esPendiente(r.resultado)).toEqual({ motivo: "error" });
  });

  it("la lectura lanza (red caída): bloquea SIN redirigir", async () => {
    m.gate.lanza = true;
    const r = await correr();
    expect(r.redirigio).toBeNull();
    expect(esPendiente(r.resultado)).toEqual({ motivo: "error" });
  });

  it("con marca puesta por el dueño: entra", async () => {
    m.gate.data = {
      puesta_en_marcha_completada_en: "2026-09-28T10:00:00Z",
      puesta_en_marcha_completada_por: "u1",
    };
    const r = await correr();
    expect(r.redirigio).toBeNull();
    expect(esPendiente(r.resultado)).toBeNull();
  });

  it("courier existente marcado por el backfill (sin autor): entra, no queda bloqueado", async () => {
    m.gate.data = {
      puesta_en_marcha_completada_en: "2026-09-28T10:00:00Z",
      puesta_en_marcha_completada_por: null,
    };
    const r = await correr();
    expect(r.redirigio).toBeNull();
    expect(esPendiente(r.resultado)).toBeNull();
  });

  it("el gate corta ANTES de las lecturas del shell (avisos, conciliación)", async () => {
    m.sesion = sesion({ rol: "supervisor" });
    await correr();
    expect(m.avisos).not.toHaveBeenCalled();
    expect(m.conciliacion).not.toHaveBeenCalled();
  });

  it("seller y conductor salen a su superficie antes del gate (no ven la pantalla pendiente)", async () => {
    m.sesion = sesion({ tipoUsuario: "seller" });
    expect((await correr()).redirigio).toBe("/portal");
    m.sesion = sesion({ tipoUsuario: "conductor" });
    expect((await correr()).redirigio).toBe("/conductor");
  });

  it("cuenta suspendida o invitada: al login, no al asistente", async () => {
    m.sesion = sesion({ estado: "suspendido" });
    expect((await correr()).redirigio).toBe("/login?error=cuenta_suspendida");
    m.sesion = sesion({ estado: "invitado" });
    expect((await correr()).redirigio).toBe("/login");
  });

  it("sin tenant: al login", async () => {
    m.sesion = sesion({ tenantId: null });
    expect((await correr()).redirigio).toBe("/login");
  });
});

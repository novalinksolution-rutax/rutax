/**
 * Prueba de regresión — el estado de ENTREGA del correo de invitación en `/equipo`.
 *
 * POR QUÉ EXISTE: hasta el 2026-08-16 esta pantalla no leía `email_estado`.
 * Mostraba "Enviada hace 1 minuto" y se acababa ahí, así que **una invitación
 * que rebotó se veía idéntica a una que llegó** — el dato estaba en la base
 * desde el 7-ago (lo escribe el webhook de Resend) y no llegaba nunca al ojo de
 * quien invita. Se destapó probando en producción con un rebote real.
 *
 * Se usa el doble schema-aware `crearClienteInvitacionesFalso` porque modela
 * las columnas reales de `public.invitaciones`: si alguien quitara
 * `email_estado` del GRANT por columna de esa vista, este SELECT fallaría con
 * 42703 igual que en la base real, y la prueba lo caza. Es la misma trampa que
 * ya rompió "Reenviar correo" en silencio del 07 al 13 de agosto.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({ obtenerSesionActual: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ crearClienteServiceRole: vi.fn() }));

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { crearClienteInvitacionesFalso } from "@/modules/identidad/invitaciones-postgrest-falso";
import { obtenerEstadoEquipo } from "./actions";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const USUARIO_ID = "40000000-0000-0000-0000-000000000001";

const SESION: SesionActual = {
  usuarioId: USUARIO_ID,
  email: "dueno@rutax.io",
  nombreCompleto: "Dueña de Prueba",
  usuario: {
    tenantId: TENANT_A,
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "dueno",
    estado: "activo",
  },
} as SesionActual;

/** Tres invitaciones internas: una rebotada, una entregada y una sin noticias del webhook. */
function filas() {
  const base = {
    tenant_id: TENANT_A,
    tipo_usuario: "interno",
    rol: "administracion",
    seller_id: null,
    driver_id: null,
    estado: "pendiente",
    expira_en: "2026-08-23T00:00:00Z",
    token: "tok",
  };
  return [
    {
      ...base,
      id: "11111111-1111-1111-1111-111111111111",
      email: "esta-no-existe@gmail.com",
      creado_en: "2026-08-16T06:39:00Z",
      email_estado: "rebotado",
      email_motivo: "hard bounce",
    },
    {
      ...base,
      id: "22222222-2222-2222-2222-222222222222",
      email: "si-llego@gmail.com",
      creado_en: "2026-08-16T06:36:00Z",
      email_estado: "entregado",
      email_motivo: null,
    },
    {
      ...base,
      id: "33333333-3333-3333-3333-333333333333",
      email: "recien-enviada@gmail.com",
      creado_en: "2026-08-16T06:41:00Z",
      email_estado: null,
      email_motivo: null,
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(obtenerSesionActual).mockResolvedValue(SESION);

  const { cliente } = crearClienteInvitacionesFalso({
    invitaciones: filas(),
    // `obtenerEstadoEquipo` consulta también los usuarios activos; acá no
    // interesan, pero el doble falla fuerte ante una tabla que no modela.
    otrasTablas: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }),
      }),
    }),
  });
  vi.mocked(createClient).mockResolvedValue(cliente);

  // El correo de los usuarios activos vive en `auth.users` y se resuelve con
  // service_role. Sin usuarios que resolver, basta con no romper.
  vi.mocked(crearClienteServiceRole).mockReturnValue({
    auth: { admin: { getUserById: vi.fn() } },
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
  } as never);
});

describe("obtenerEstadoEquipo — estado de entrega del correo", () => {
  it("trae email_estado y email_motivo de cada invitación", async () => {
    const resultado = await obtenerEstadoEquipo();

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const porEmail = new Map(resultado.estado.invitaciones.map((i) => [i.email, i]));

    expect(porEmail.get("esta-no-existe@gmail.com")).toMatchObject({
      emailEstado: "rebotado",
      emailMotivo: "hard bounce",
    });
    expect(porEmail.get("si-llego@gmail.com")).toMatchObject({ emailEstado: "entregado" });
  });

  it("una invitación sin noticias del webhook queda en null, no en 'entregado'", async () => {
    const resultado = await obtenerEstadoEquipo();
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const recien = resultado.estado.invitaciones.find((i) => i.email === "recien-enviada@gmail.com");

    // `null` es "todavía no se sabe". Tratarlo como éxito volvería a esconder
    // el rebote, que es exactamente el bug que esta prueba existe para cazar.
    expect(recien?.emailEstado).toBeNull();
  });
});

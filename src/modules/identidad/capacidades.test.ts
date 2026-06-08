import { describe, expect, it } from "vitest";
import {
  CAPACIDADES,
  capacidadesDe,
  esSuperAdminDePlataforma,
  puedeAjustarOperacionDiaria,
  puedeAprobarFacturacion,
  puedeAsignarYReasignarPedidos,
  puedeConfirmarManifiestoPropio,
  puedeEmitirFacturas,
  puedeGenerarManifiestos,
  puedeGestionarCobranza,
  puedeGestionarConexionMlPropia,
  puedeGestionarConfiguracionDte,
  puedeGestionarIncidencias,
  puedeGestionarLiquidacionesConductores,
  puedeGestionarTarifas,
  puedeGestionarUsuariosYRoles,
  puedeInvitarUsuarios,
  puedeMarcarEvidenciasPropias,
  puedeRevocarInvitaciones,
  puedeSolicitarSameDay,
  puedeVerBitacoraAuditoria,
  puedeVerConciliacion,
  puedeVerDocumentosPropios,
  puedeVerIncidenciasPropias,
  puedeVerLiquidacionPropia,
  puedeVerReportesEjecutivos,
  puedeVerRutaPropia,
  tieneCapacidad,
} from "./capacidades";
import { ROLES, type Rol } from "./roles";
import type { UsuarioActual } from "./usuario-actual";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const SELLER_A = "22222222-2222-2222-2222-222222222222";
const DRIVER_A = "33333333-3333-3333-3333-333333333333";

function usuario(overrides: Partial<UsuarioActual> & { rol: Rol }): UsuarioActual {
  const tipoUsuario =
    overrides.tipoUsuario ??
    (overrides.rol === "seller"
      ? "seller"
      : overrides.rol === "conductor"
        ? "conductor"
        : overrides.rol === "super_admin"
          ? "super_admin"
          : "interno");

  return {
    tenantId: tipoUsuario === "super_admin" ? null : TENANT_A,
    tipoUsuario,
    sellerId: tipoUsuario === "seller" ? SELLER_A : null,
    driverId: tipoUsuario === "conductor" ? DRIVER_A : null,
    estado: "activo",
    ...overrides,
  };
}

describe("catálogo de capacidades", () => {
  it("no tiene duplicados", () => {
    const unicas = new Set(CAPACIDADES);
    expect(unicas.size).toBe(CAPACIDADES.length);
  });
});

describe("tieneCapacidad — guard de cuenta activa", () => {
  it("niega TODAS las capacidades a un usuario invitado, sin importar su rol", () => {
    const dueno = usuario({ rol: "dueno", estado: "invitado" });
    expect(puedeGestionarUsuariosYRoles(dueno)).toBe(false);
    expect(puedeGestionarTarifas(dueno)).toBe(false);
    expect(capacidadesDe(dueno)).toEqual([]);
  });

  it("niega TODAS las capacidades a un usuario suspendido, sin importar su rol", () => {
    const admin = usuario({ rol: "administracion", estado: "suspendido" });
    expect(puedeEmitirFacturas(admin)).toBe(false);
    expect(puedeGestionarCobranza(admin)).toBe(false);
    expect(capacidadesDe(admin)).toEqual([]);
  });

  it("permite capacidades a un usuario activo con el rol correspondiente", () => {
    const dueno = usuario({ rol: "dueno", estado: "activo" });
    expect(puedeGestionarUsuariosYRoles(dueno)).toBe(true);
  });
});

describe("rol dueno — permisos totales dentro de su tenant (§4 levantamiento)", () => {
  const dueno = usuario({ rol: "dueno" });

  it("puede gestionar usuarios, roles e invitaciones (RF-005)", () => {
    expect(puedeGestionarUsuariosYRoles(dueno)).toBe(true);
    expect(puedeInvitarUsuarios(dueno)).toBe(true);
    expect(puedeRevocarInvitaciones(dueno)).toBe(true);
  });

  it("puede configurar tarifas y DTE (RF-007..009)", () => {
    expect(puedeGestionarTarifas(dueno)).toBe(true);
    expect(puedeGestionarConfiguracionDte(dueno)).toBe(true);
  });

  it("puede aprobar facturación, emitir facturas y ver conciliación (RF-030/033/035)", () => {
    expect(puedeAprobarFacturacion(dueno)).toBe(true);
    expect(puedeEmitirFacturas(dueno)).toBe(true);
    expect(puedeVerConciliacion(dueno)).toBe(true);
  });

  it("puede gestionar liquidaciones de conductores y cobranza", () => {
    expect(puedeGestionarLiquidacionesConductores(dueno)).toBe(true);
    expect(puedeGestionarCobranza(dueno)).toBe(true);
  });

  it("puede ver reportes ejecutivos y la bitácora de auditoría", () => {
    expect(puedeVerReportesEjecutivos(dueno)).toBe(true);
    expect(puedeVerBitacoraAuditoria(dueno)).toBe(true);
  });

  it("puede ejercer también capacidades operativas (asignación, manifiestos, incidencias)", () => {
    expect(puedeAsignarYReasignarPedidos(dueno)).toBe(true);
    expect(puedeGenerarManifiestos(dueno)).toBe(true);
    expect(puedeGestionarIncidencias(dueno)).toBe(true);
    expect(puedeAjustarOperacionDiaria(dueno)).toBe(true);
  });
});

describe("rol supervisor — operativos; SIN config financiera ni usuarios (§4 levantamiento)", () => {
  const supervisor = usuario({ rol: "supervisor" });

  it("puede confirmar/ajustar operación, gestionar incidencias y reasignar", () => {
    expect(puedeAsignarYReasignarPedidos(supervisor)).toBe(true);
    expect(puedeGestionarIncidencias(supervisor)).toBe(true);
    expect(puedeAjustarOperacionDiaria(supervisor)).toBe(true);
    expect(puedeGenerarManifiestos(supervisor)).toBe(true);
  });

  it("NO puede gestionar usuarios/roles ni invitar (explícitamente negado)", () => {
    expect(puedeGestionarUsuariosYRoles(supervisor)).toBe(false);
    expect(puedeInvitarUsuarios(supervisor)).toBe(false);
    expect(puedeRevocarInvitaciones(supervisor)).toBe(false);
  });

  it("NO puede tocar configuración financiera/tributaria ni facturación", () => {
    expect(puedeGestionarTarifas(supervisor)).toBe(false);
    expect(puedeGestionarConfiguracionDte(supervisor)).toBe(false);
    expect(puedeAprobarFacturacion(supervisor)).toBe(false);
    expect(puedeEmitirFacturas(supervisor)).toBe(false);
    expect(puedeGestionarLiquidacionesConductores(supervisor)).toBe(false);
    expect(puedeGestionarCobranza(supervisor)).toBe(false);
  });
});

describe("rol coordinador — solo asignación operativa (§4 levantamiento)", () => {
  const coordinador = usuario({ rol: "coordinador" });

  it("puede asignar/reasignar y generar manifiestos", () => {
    expect(puedeAsignarYReasignarPedidos(coordinador)).toBe(true);
    expect(puedeGenerarManifiestos(coordinador)).toBe(true);
  });

  it("NO puede gestionar incidencias ni ajustar operación general (es del supervisor)", () => {
    expect(puedeGestionarIncidencias(coordinador)).toBe(false);
    expect(puedeAjustarOperacionDiaria(coordinador)).toBe(false);
  });

  it("NO tiene ninguna capacidad financiera ni de usuarios", () => {
    expect(puedeGestionarUsuariosYRoles(coordinador)).toBe(false);
    expect(puedeGestionarTarifas(coordinador)).toBe(false);
    expect(puedeAprobarFacturacion(coordinador)).toBe(false);
    expect(puedeEmitirFacturas(coordinador)).toBe(false);
    expect(puedeGestionarLiquidacionesConductores(coordinador)).toBe(false);
  });
});

describe("rol administracion — capa de dinero; SIN reasignación operativa (§4 levantamiento)", () => {
  const admin = usuario({ rol: "administracion" });

  it("puede emitir facturas, aprobar facturación y ver conciliación", () => {
    expect(puedeEmitirFacturas(admin)).toBe(true);
    expect(puedeAprobarFacturacion(admin)).toBe(true);
    expect(puedeVerConciliacion(admin)).toBe(true);
  });

  it("puede generar liquidaciones de conductores y gestionar cobranza", () => {
    expect(puedeGestionarLiquidacionesConductores(admin)).toBe(true);
    expect(puedeGestionarCobranza(admin)).toBe(true);
  });

  it("puede gestionar tarifas y configuración DTE (RF-007..009 listan 'Dueño / admin')", () => {
    expect(puedeGestionarTarifas(admin)).toBe(true);
    expect(puedeGestionarConfiguracionDte(admin)).toBe(true);
  });

  it("puede ver la bitácora de auditoría (§10 doc. arquitectura: dueño/administración)", () => {
    expect(puedeVerBitacoraAuditoria(admin)).toBe(true);
  });

  it("NO puede asignar/reasignar pedidos ni generar manifiestos (explícitamente negado)", () => {
    expect(puedeAsignarYReasignarPedidos(admin)).toBe(false);
    expect(puedeGenerarManifiestos(admin)).toBe(false);
    expect(puedeGestionarIncidencias(admin)).toBe(false);
    expect(puedeAjustarOperacionDiaria(admin)).toBe(false);
  });

  it("NO puede gestionar usuarios ni roles (privativo del dueño)", () => {
    expect(puedeGestionarUsuariosYRoles(admin)).toBe(false);
    expect(puedeInvitarUsuarios(admin)).toBe(false);
  });
});

describe("rol conductor — solo sus propios datos (§4 levantamiento, P3 RLS)", () => {
  const conductor = usuario({ rol: "conductor" });

  it("puede ver su ruta, confirmar su manifiesto, marcar evidencias y ver su liquidación", () => {
    expect(puedeVerRutaPropia(conductor)).toBe(true);
    expect(puedeConfirmarManifiestoPropio(conductor)).toBe(true);
    expect(puedeMarcarEvidenciasPropias(conductor)).toBe(true);
    expect(puedeVerLiquidacionPropia(conductor)).toBe(true);
  });

  it("NO tiene ninguna capacidad interna del tenant", () => {
    expect(puedeGestionarUsuariosYRoles(conductor)).toBe(false);
    expect(puedeGestionarTarifas(conductor)).toBe(false);
    expect(puedeAprobarFacturacion(conductor)).toBe(false);
    expect(puedeAsignarYReasignarPedidos(conductor)).toBe(false);
    expect(puedeGestionarIncidencias(conductor)).toBe(false);
    expect(puedeGestionarLiquidacionesConductores(conductor)).toBe(false);
    expect(puedeVerBitacoraAuditoria(conductor)).toBe(false);
  });

  it("NO tiene capacidades de seller", () => {
    expect(puedeGestionarConexionMlPropia(conductor)).toBe(false);
    expect(puedeSolicitarSameDay(conductor)).toBe(false);
  });
});

describe("rol seller — estrictamente acotado a sus datos (§4 levantamiento, P2 RLS)", () => {
  const seller = usuario({ rol: "seller" });

  it("puede conectar OAuth, solicitar same-day, ver documentos e incidencias propias", () => {
    expect(puedeGestionarConexionMlPropia(seller)).toBe(true);
    expect(puedeSolicitarSameDay(seller)).toBe(true);
    expect(puedeVerDocumentosPropios(seller)).toBe(true);
    expect(puedeVerIncidenciasPropias(seller)).toBe(true);
  });

  it("NO tiene ninguna capacidad interna del tenant", () => {
    expect(puedeGestionarUsuariosYRoles(seller)).toBe(false);
    expect(puedeGestionarTarifas(seller)).toBe(false);
    expect(puedeAprobarFacturacion(seller)).toBe(false);
    expect(puedeEmitirFacturas(seller)).toBe(false);
    expect(puedeAsignarYReasignarPedidos(seller)).toBe(false);
    expect(puedeGestionarLiquidacionesConductores(seller)).toBe(false);
    expect(puedeVerBitacoraAuditoria(seller)).toBe(false);
  });

  it("NO tiene capacidades de conductor", () => {
    expect(puedeVerRutaPropia(seller)).toBe(false);
    expect(puedeVerLiquidacionPropia(seller)).toBe(false);
  });
});

describe("rol super_admin — plataforma, no tenant (§8.3 doc. arquitectura)", () => {
  const superAdmin = usuario({ rol: "super_admin", tenantId: null });

  it("es identificado como super-admin de plataforma", () => {
    expect(esSuperAdminDePlataforma(superAdmin)).toBe(true);
  });

  it("NO posee ninguna capacidad de tenant — su acceso va por funciones service_role auditadas", () => {
    expect(capacidadesDe(superAdmin)).toEqual([]);
    expect(puedeGestionarUsuariosYRoles(superAdmin)).toBe(false);
    expect(puedeAprobarFacturacion(superAdmin)).toBe(false);
    expect(puedeAsignarYReasignarPedidos(superAdmin)).toBe(false);
    expect(puedeVerBitacoraAuditoria(superAdmin)).toBe(false);
  });

  it("un usuario que NO es super_admin nunca es identificado como tal", () => {
    expect(esSuperAdminDePlataforma(usuario({ rol: "dueno" }))).toBe(false);
    expect(esSuperAdminDePlataforma(usuario({ rol: "administracion" }))).toBe(false);
  });
});

describe("tieneCapacidad — primitiva genérica", () => {
  it("delega correctamente para cualquier combinación rol/capacidad de la matriz", () => {
    expect(tieneCapacidad(usuario({ rol: "dueno" }), "gestionar_tarifas")).toBe(true);
    expect(tieneCapacidad(usuario({ rol: "coordinador" }), "gestionar_tarifas")).toBe(false);
  });
});

describe("cobertura: cada rol declarado en el enum tiene una entrada en la matriz", () => {
  it.each(ROLES)("rol '%s' responde sin lanzar y devuelve un arreglo (posiblemente vacío)", (rol) => {
    const u = usuario({ rol });
    expect(() => capacidadesDe(u)).not.toThrow();
    expect(Array.isArray(capacidadesDe(u))).toBe(true);
  });
});

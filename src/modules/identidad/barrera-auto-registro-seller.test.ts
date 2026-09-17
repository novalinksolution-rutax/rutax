import { describe, expect, it } from "vitest";
import { mensajeBarreraAutoRegistroSeller, verificarBarreraAutoRegistroSeller } from "./barrera-auto-registro-seller";
import { crearClienteAltaSellerFalso } from "./alta-seller-postgrest-falso";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const AUTH_USER = "auth-user-1";

describe("verificarBarreraAutoRegistroSeller", () => {
  it("permite a una identidad sin ningún perfil registrarse como seller", async () => {
    const { cliente } = crearClienteAltaSellerFalso();
    const resultado = await verificarBarreraAutoRegistroSeller(cliente, AUTH_USER, TENANT_A);
    expect(resultado).toEqual({ ok: true });
  });

  it("bloquea a una identidad que ya es conductor en otro tenant", async () => {
    const { cliente } = crearClienteAltaSellerFalso({
      perfiles: [{ id: AUTH_USER, tenant_id: TENANT_B, tipo_usuario: "conductor", rol: "conductor", estado: "activo" }],
    });
    const resultado = await verificarBarreraAutoRegistroSeller(cliente, AUTH_USER, TENANT_A);
    expect(resultado).toEqual({ ok: false, motivo: "identidad_no_es_seller", tipoActual: "conductor" });
    expect(mensajeBarreraAutoRegistroSeller(resultado)).toMatch(/conductor/);
  });

  it("bloquea a un usuario interno (dueño/equipo) de registrarse como seller", async () => {
    const { cliente } = crearClienteAltaSellerFalso({
      perfiles: [{ id: AUTH_USER, tenant_id: TENANT_A, tipo_usuario: "interno", rol: "dueno", estado: "activo" }],
    });
    const resultado = await verificarBarreraAutoRegistroSeller(cliente, AUTH_USER, TENANT_A);
    expect(resultado).toEqual({ ok: false, motivo: "identidad_no_es_seller", tipoActual: "interno" });
  });

  it("bloquea a un super_admin de registrarse como seller", async () => {
    const { cliente } = crearClienteAltaSellerFalso({
      perfiles: [{ id: AUTH_USER, tenant_id: null, tipo_usuario: "super_admin", rol: "super_admin", estado: "activo" }],
    });
    const resultado = await verificarBarreraAutoRegistroSeller(cliente, AUTH_USER, TENANT_A);
    expect(resultado).toEqual({ ok: false, motivo: "identidad_no_es_seller", tipoActual: "super_admin" });
  });

  it("permite a un seller de OTRO courier sumar una membresía nueva (multi-courier)", async () => {
    const { cliente } = crearClienteAltaSellerFalso({
      perfiles: [
        { id: AUTH_USER, tenant_id: TENANT_B, tipo_usuario: "seller", seller_id: "seller-b", rol: "seller", estado: "activo" },
      ],
      sellerMembresias: [{ id: "m-b", auth_user_id: AUTH_USER, tenant_id: TENANT_B, seller_id: "seller-b", estado: "activa" }],
    });
    const resultado = await verificarBarreraAutoRegistroSeller(cliente, AUTH_USER, TENANT_A);
    expect(resultado).toEqual({ ok: true });
  });

  it("bloquea si ya tiene una membresía en ESE MISMO courier (activa)", async () => {
    const { cliente } = crearClienteAltaSellerFalso({
      perfiles: [
        { id: AUTH_USER, tenant_id: TENANT_A, tipo_usuario: "seller", seller_id: "seller-a", rol: "seller", estado: "activo" },
      ],
      sellerMembresias: [{ id: "m-a", auth_user_id: AUTH_USER, tenant_id: TENANT_A, seller_id: "seller-a", estado: "activa" }],
    });
    const resultado = await verificarBarreraAutoRegistroSeller(cliente, AUTH_USER, TENANT_A);
    expect(resultado).toEqual({ ok: false, motivo: "ya_tiene_membresia_en_este_courier" });
    expect(mensajeBarreraAutoRegistroSeller(resultado)).toMatch(/ya tienes/i);
  });

  it("bloquea igual si la membresía existente está bloqueada — no hay nada que re-registrar", async () => {
    const { cliente } = crearClienteAltaSellerFalso({
      perfiles: [
        { id: AUTH_USER, tenant_id: TENANT_A, tipo_usuario: "seller", seller_id: "seller-a", rol: "seller", estado: "activo" },
      ],
      sellerMembresias: [
        { id: "m-a", auth_user_id: AUTH_USER, tenant_id: TENANT_A, seller_id: "seller-a", estado: "bloqueada" },
      ],
    });
    const resultado = await verificarBarreraAutoRegistroSeller(cliente, AUTH_USER, TENANT_A);
    expect(resultado).toEqual({ ok: false, motivo: "ya_tiene_membresia_en_este_courier" });
  });
});

describe("mensajeBarreraAutoRegistroSeller", () => {
  it("devuelve cadena vacía cuando la barrera pasó — no hay nada que mostrar", () => {
    expect(mensajeBarreraAutoRegistroSeller({ ok: true })).toBe("");
  });
});

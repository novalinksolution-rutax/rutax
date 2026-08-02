import { describe, it, expect } from "vitest";
import { validarUrlWebhook } from "./url-webhook";

describe("validarUrlWebhook", () => {
  it("acepta URLs HTTPS públicas", () => {
    expect(validarUrlWebhook("https://api.cliente.cl/webhooks/rutax").ok).toBe(true);
    expect(validarUrlWebhook("https://hooks.example.com:8443/x").ok).toBe(true);
  });

  it("rechaza esquemas que no sean HTTPS", () => {
    expect(validarUrlWebhook("http://api.cliente.cl/x").ok).toBe(false);
    expect(validarUrlWebhook("ftp://api.cliente.cl/x").ok).toBe(false);
  });

  it("rechaza URLs malformadas", () => {
    expect(validarUrlWebhook("no-es-una-url").ok).toBe(false);
    expect(validarUrlWebhook("").ok).toBe(false);
  });

  it("rechaza credenciales embebidas", () => {
    expect(validarUrlWebhook("https://user:pass@api.cliente.cl/x").ok).toBe(false);
  });

  it("bloquea loopback y localhost", () => {
    expect(validarUrlWebhook("https://localhost/x").ok).toBe(false);
    expect(validarUrlWebhook("https://app.localhost/x").ok).toBe(false);
    expect(validarUrlWebhook("https://127.0.0.1/x").ok).toBe(false);
    expect(validarUrlWebhook("https://127.5.5.5/x").ok).toBe(false);
    expect(validarUrlWebhook("https://[::1]/x").ok).toBe(false);
  });

  it("bloquea el endpoint de metadata y link-local", () => {
    expect(validarUrlWebhook("https://169.254.169.254/latest/meta-data/").ok).toBe(false);
    expect(validarUrlWebhook("https://[fe80::1]/x").ok).toBe(false);
  });

  it("bloquea rangos privados IPv4", () => {
    expect(validarUrlWebhook("https://10.0.0.5/x").ok).toBe(false);
    expect(validarUrlWebhook("https://172.16.0.1/x").ok).toBe(false);
    expect(validarUrlWebhook("https://172.31.255.255/x").ok).toBe(false);
    expect(validarUrlWebhook("https://192.168.1.1/x").ok).toBe(false);
    expect(validarUrlWebhook("https://100.64.0.1/x").ok).toBe(false);
    expect(validarUrlWebhook("https://0.0.0.0/x").ok).toBe(false);
  });

  it("permite IPv4 públicas que rozan los bordes de rangos privados", () => {
    // 172.15 y 172.32 están fuera de 172.16/12; 192.169 fuera de 192.168/16.
    expect(validarUrlWebhook("https://172.15.0.1/x").ok).toBe(true);
    expect(validarUrlWebhook("https://172.32.0.1/x").ok).toBe(true);
    expect(validarUrlWebhook("https://192.169.0.1/x").ok).toBe(true);
    expect(validarUrlWebhook("https://8.8.8.8/x").ok).toBe(true);
  });

  it("bloquea IPv6 privadas (ULA) e IPv4-mapped privadas", () => {
    expect(validarUrlWebhook("https://[fc00::1]/x").ok).toBe(false);
    expect(validarUrlWebhook("https://[fd12:3456::1]/x").ok).toBe(false);
    expect(validarUrlWebhook("https://[::ffff:127.0.0.1]/x").ok).toBe(false);
  });
});

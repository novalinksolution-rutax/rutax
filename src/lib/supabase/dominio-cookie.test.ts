import { describe, expect, it } from "vitest";
import { dominioCookieSupabase } from "./dominio-cookie";

describe("dominioCookieSupabase", () => {
  it("devuelve el dominio compartido para el apex", () => {
    expect(dominioCookieSupabase("rutax.io")).toBe(".rutax.io");
  });

  it("devuelve el dominio compartido para www", () => {
    expect(dominioCookieSupabase("www.rutax.io")).toBe(".rutax.io");
  });

  it("ignora el puerto al derivar el dominio compartido", () => {
    expect(dominioCookieSupabase("www.rutax.io:443")).toBe(".rutax.io");
  });

  it("devuelve el dominio compartido para cualquier subdominio de rutax.io", () => {
    expect(dominioCookieSupabase("admin.rutax.io")).toBe(".rutax.io");
  });

  it("es insensible a mayúsculas", () => {
    expect(dominioCookieSupabase("WWW.RUTAX.IO")).toBe(".rutax.io");
  });

  it("devuelve undefined en localhost (cookie host-only)", () => {
    expect(dominioCookieSupabase("localhost:3000")).toBeUndefined();
  });

  it("devuelve undefined en un preview de Vercel", () => {
    expect(dominioCookieSupabase("abc.vercel.app")).toBeUndefined();
  });

  it("devuelve undefined para host null", () => {
    expect(dominioCookieSupabase(null)).toBeUndefined();
  });

  it("devuelve undefined para host undefined", () => {
    expect(dominioCookieSupabase(undefined)).toBeUndefined();
  });

  it("devuelve undefined para una IP", () => {
    expect(dominioCookieSupabase("127.0.0.1:3000")).toBeUndefined();
  });

  it("no confunde un dominio que solo termina parecido (host distinto)", () => {
    expect(dominioCookieSupabase("evil-rutax.io")).toBeUndefined();
  });
});

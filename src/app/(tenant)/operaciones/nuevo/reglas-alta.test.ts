import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
import { describe, expect, it } from "vitest";
import {
  comunaDelCatalogo,
  esMovilChileno,
  puedeUsarBusquedaDeDirecciones,
  superaHoraDeCorte,
} from "./reglas-alta";
import { capacidadesDeRol } from "@/modules/identidad/capacidades";
import { ROLES, type Rol } from "@/modules/identidad/roles";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

describe("esMovilChileno", () => {
  it("acepta las formas en que la gente escribe un móvil", () => {
    for (const v of [
      "+56 9 1234 5678",
      "+56912345678",
      "56 9 1234 5678",
      "9 1234 5678",
      "912345678",
    ]) {
      expect(esMovilChileno(v), v).toBe(true);
    }
  });

  it("acepta el vacío: el teléfono es opcional", () => {
    // Un campo opcional que se pinta de rojo por estar vacío acusa a alguien de
    // un error que no cometió.
    expect(esMovilChileno("")).toBe(true);
    expect(esMovilChileno("   ")).toBe(true);
  });

  it("rechaza un fijo, un número corto y uno largo", () => {
    // El campo existe para avisarle al destinatario que el conductor va en
    // camino, y eso es un mensaje al móvil.
    expect(esMovilChileno("+56 2 2345 6789")).toBe(false);
    expect(esMovilChileno("12345")).toBe(false);
    expect(esMovilChileno("+56 9 1234 56789")).toBe(false);
    expect(esMovilChileno("no es un teléfono")).toBe(false);
  });
});

describe("comunaDelCatalogo", () => {
  it("reconoce la comuna venga como venga del proveedor", () => {
    expect(comunaDelCatalogo("Ñuñoa")).toBe("Ñuñoa");
    expect(comunaDelCatalogo("nunoa")).toBe("Ñuñoa");
    expect(comunaDelCatalogo("NUÑOA")).toBe("Ñuñoa");
    expect(comunaDelCatalogo("Comuna de Ñuñoa")).toBe("Ñuñoa");
    expect(comunaDelCatalogo("estacion central")).toBe("Estación Central");
  });

  it("devuelve null en vez de inventar una comuna", () => {
    // Si no calza, elige la persona: una comuna inventada rompe la tarifa y el
    // reparto por zona sin que nadie lo note.
    expect(comunaDelCatalogo("Valparaíso")).toBeNull();
    expect(comunaDelCatalogo(null)).toBeNull();
    expect(comunaDelCatalogo("")).toBeNull();
  });
});

describe("superaHoraDeCorte", () => {
  it("compara en minutos, no como texto", () => {
    // ⚠️ El bug que esta prueba existe para impedir: `"9:30" > "16:00"` es
    // VERDADERO comparando cadenas, así que el aviso de «se va mañana»
    // aparecería a las nueve y media de la mañana.
    expect(superaHoraDeCorte("09:30", "16:00")).toBe(false);
    expect(superaHoraDeCorte("9:30", "16:00")).toBe(false);
    expect(superaHoraDeCorte("16:01", "16:00")).toBe(true);
    expect(superaHoraDeCorte("23:59", "16:00")).toBe(true);
  });

  it("la hora exacta del corte todavía alcanza", () => {
    expect(superaHoraDeCorte("16:00", "16:00")).toBe(false);
  });

  it("ante una hora ilegible no avisa", () => {
    // Un aviso falso empuja a reagendar un pedido que sí alcanzaba a salir hoy.
    expect(superaHoraDeCorte("", "16:00")).toBe(false);
    expect(superaHoraDeCorte("16:30", "sin hora")).toBe(false);
  });
});

describe("puedeUsarBusquedaDeDirecciones", () => {
  /**
   * 🔴 La red del defecto del 26-08-2026: el formulario de alta same-day es UNO
   * y lo montan dos superficies, pero su acción de sugerencias exigía solo la
   * capacidad del equipo interno. Todo seller recibía lista vacía —que se lee
   * como «esa dirección no existe»— y nadie podía notarlo desde el código de la
   * pantalla, porque la pantalla es la misma.
   *
   * La regla se enuncia al revés, sobre el catálogo: **quien puede dar de alta
   * un same-day puede buscarle la dirección**. Así, si mañana un rol nuevo gana
   * `solicitar_same_day`, esto pasa solo.
   */
  function usuario(rol: Rol): UsuarioActual {
    return {
      areasHabilitadas: [...AREAS_PRODUCTO],
      tenantId: "11111111-1111-1111-1111-111111111111",
      tipoUsuario: rol === "seller" ? "seller" : rol === "conductor" ? "conductor" : "interno",
      sellerId: rol === "seller" ? "22222222-2222-2222-2222-222222222222" : null,
      driverId: rol === "conductor" ? "33333333-3333-3333-3333-333333333333" : null,
      rol,
      estado: "activo",
    };
  }

  const PUEDEN_CREAR = ROLES.filter((rol) => {
    const suyas = capacidadesDeRol(rol);
    return suyas.includes("solicitar_same_day") || suyas.includes("ajustar_operacion_diaria");
  });

  it("todo rol que puede crear un same-day puede buscar la dirección", () => {
    // Que la lista no esté vacía es parte de la prueba: si un refactor dejara
    // el filtro sin resultados, el `for` no correría y esto pasaría en verde.
    expect(PUEDEN_CREAR.length).toBeGreaterThan(0);
    expect(PUEDEN_CREAR).toContain("seller");
    for (const rol of PUEDEN_CREAR) {
      expect(puedeUsarBusquedaDeDirecciones(usuario(rol)), rol).toBe(true);
    }
  });

  it("y ningún otro rol la tiene: no se abrió de más al arreglarlo", () => {
    const resto = ROLES.filter((r) => !PUEDEN_CREAR.includes(r));
    for (const rol of resto) {
      expect(puedeUsarBusquedaDeDirecciones(usuario(rol)), rol).toBe(false);
    }
  });

  it("una cuenta suspendida no busca direcciones, aunque su rol pudiera", () => {
    expect(puedeUsarBusquedaDeDirecciones({ ...usuario("dueno"), estado: "suspendido" })).toBe(false);
    expect(puedeUsarBusquedaDeDirecciones({ ...usuario("seller"), estado: "invitado" })).toBe(false);
  });
});

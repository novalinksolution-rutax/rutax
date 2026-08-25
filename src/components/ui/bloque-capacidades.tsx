/**
 * `bloque de capacidades` — qué puede y qué no, salido del catálogo.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 REGLA 6 · UN PERMISO SE EXPLICA CON EL CATÁLOGO, NUNCA CON UN TEXTO A MANO
 * -----------------------------------------------------------------------------
 * Las listas salen de `MATRIZ_ROL_CAPACIDADES` por diferencia de conjuntos. Una
 * frase escrita a mano —«el coordinador reparte pedidos y arma rutas»— se
 * desactualiza en cuanto el rol gana una capacidad, **y nadie se entera**: la
 * pantalla sigue prometiendo lo mismo mientras la persona ya puede hacer otra
 * cosa. Es la única superficie donde el sistema explica qué hace cada rol, así
 * que si miente, miente en el único sitio donde alguien va a mirar.
 *
 * -----------------------------------------------------------------------------
 * DOS USOS, UNA SOLA PIEZA
 * -----------------------------------------------------------------------------
 * · **Cambiar el rol** de alguien que ya está: tres listas —pierde · gana ·
 *   sigue sin tener—, porque lo que importa es el delta.
 * · **Invitar** a alguien nuevo: dos listas —va a poder · no va a poder—,
 *   porque no hay rol anterior contra el cual restar.
 *
 * La segunda mitad («no va a poder») **no es relleno**: sin ella, quien invita
 * asume que el rol cubre lo que necesita y se entera de que no cuando la
 * persona ya está adentro pidiendo permisos.
 */

export function ListaCapacidades({
  rotulo,
  tono,
  items,
  vacio,
  colapsable = false,
  umbral = 3,
}: {
  rotulo: string;
  tono: "fault" | "balanced" | "muted";
  items: string[];
  vacio: string;
  /** Las listas largas se pliegan sin perderse. */
  colapsable?: boolean;
  /**
   * A partir de cuántos ítems se pliega.
   *
   * ⚠️ No es el mismo para las dos listas, y por eso es un parámetro. «Va a
   * poder» se pliega tarde (8) porque **es la mitad que hay que leer**: un rol
   * de cuatro capacidades tiene que verse entero, como en el tablero. El dueño
   * tiene veintiuna y desplegadas empujan el botón de invitar fuera de la
   * pantalla, que es la forma más segura de que nadie las lea — ahí sí se
   * pliega, y el conteo del resumen sigue diciendo cuántas son.
   */
  umbral?: number;
}) {
  const color =
    tono === "fault" ? "text-fault-fg" : tono === "balanced" ? "text-balanced-fg" : "text-fg-muted";

  const cuerpo =
    items.length === 0 ? (
      <p className="text-sm text-fg-muted">{vacio}</p>
    ) : (
      <ul className="list-disc space-y-0.5 pl-5 text-sm leading-snug text-fg-muted">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    );

  if (colapsable && items.length > umbral) {
    return (
      <details>
        <summary
          className={`cursor-pointer text-[10px] font-medium tracking-[0.12em] uppercase ${color}`}
        >
          {rotulo} ({items.length})
        </summary>
        <div className="mt-1">{cuerpo}</div>
      </details>
    );
  }

  return (
    <div>
      <p className={`text-[10px] font-medium tracking-[0.12em] uppercase ${color}`}>
        {rotulo}
        {items.length > 0 ? ` (${items.length})` : ""}
      </p>
      <div className="mt-1">{cuerpo}</div>
    </div>
  );
}

/**
 * Las dos listas de un rol, para el alta.
 *
 * `noVaAPoder` va **colapsable**: son casi veinte frases y desplegadas empujan
 * el botón de invitar fuera de la pantalla, que es la forma más segura de que
 * nadie las lea.
 */
export function BloqueCapacidadesRol({
  vaAPoder,
  noVaAPoder,
}: {
  vaAPoder: string[];
  noVaAPoder: string[];
}) {
  return (
    <div className="space-y-3 border border-line bg-bg-sunken px-4 py-3">
      <ListaCapacidades
        rotulo="Va a poder"
        tono="balanced"
        items={vaAPoder}
        vacio="Este rol no habilita ninguna acción."
        colapsable
        umbral={8}
      />
      <ListaCapacidades
        rotulo="No va a poder"
        tono="muted"
        items={noVaAPoder}
        vacio="No queda nada fuera."
        colapsable
      />
    </div>
  );
}

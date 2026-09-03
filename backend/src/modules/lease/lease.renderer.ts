/**
 * Rendu du modèle légal.
 *
 * Le corps du modèle est un texte verrouillé ne contenant que des marqueurs
 * `{{ champ }}`. Le rendu **remplace** ces marqueurs par les valeurs injectées,
 * et ne fait rien d'autre : il n'ajoute pas une virgule au texte légal.
 *
 * La sortie distingue explicitement le texte du modèle des valeurs injectées.
 * C'est ce qui permet à l'écran de surligner ce qui vient du dossier et de
 * laisser le reste en évidence comme non modifiable — la promesse « aucune
 * clause rédigée par la plateforme » doit être vérifiable à l'œil, pas
 * seulement affirmée.
 */

/** Fragment de ligne : texte du modèle, ou valeur injectée. */
export interface RenderedSegment {
  text: string;
  /** Nom du champ quand le fragment est une valeur injectée. */
  field: string | null;
}

export interface RenderedBlock {
  /** Niveau de titre `#` markdown, ou 0 pour un paragraphe. */
  heading: number;
  segments: RenderedSegment[];
}

/** Marqueur `{{ champ }}`, avec ou sans espaces autour du nom. */
const MARKER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Commentaire HTML, éventuellement réparti sur plusieurs lignes.
 *
 * Le retrait porte sur le corps entier et non sur chaque ligne : un
 * avertissement interne rédigé sur deux lignes verrait sinon sa seconde ligne
 * s'afficher dans l'acte, sortie de son contexte.
 */
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * Découpe une ligne en fragments.
 *
 * Un marqueur sans valeur correspondante n'est **pas** effacé : il reste
 * visible tel quel et signalé comme champ vide. Le supprimer silencieusement
 * produirait un acte au texte tronqué, plus difficile à repérer qu'un marqueur
 * resté en clair.
 */
function splitLine(line: string, values: Record<string, unknown>): RenderedSegment[] {
  const segments: RenderedSegment[] = [];
  let lastIndex = 0;

  for (const match of line.matchAll(MARKER)) {
    const [raw, field] = match;
    const start = match.index ?? 0;

    if (start > lastIndex) {
      segments.push({ text: line.slice(lastIndex, start), field: null });
    }

    const value = values[field];
    const rendered =
      value === undefined || value === null || String(value).trim() === ''
        ? raw
        : String(value);
    segments.push({ text: rendered, field });

    lastIndex = start + raw.length;
  }

  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), field: null });
  }

  return segments;
}

export function renderTemplate(
  body: string,
  values: Record<string, unknown>,
): RenderedBlock[] {
  // Les commentaires HTML du squelette portent des avertissements internes,
  // pas du texte contractuel : ils n'ont rien à faire dans l'acte affiché.
  return body
    .replace(HTML_COMMENT, '')
    .split('\n')
    .map((line) => {
      const heading = /^(#{1,6})\s/.exec(line);
      const content = heading ? line.slice(heading[1].length + 1) : line;
      return {
        heading: heading ? heading[1].length : 0,
        segments: splitLine(content, values),
      };
    })
    .filter((block) => block.segments.some((segment) => segment.text.trim() !== ''));
}

/** Version texte brut, pour l'empreinte et l'envoi au prestataire de signature. */
export function renderPlainText(
  body: string,
  values: Record<string, unknown>,
): string {
  return renderTemplate(body, values)
    .map((block) => {
      const line = block.segments.map((segment) => segment.text).join('');
      return block.heading > 0 ? `${'#'.repeat(block.heading)} ${line}` : line;
    })
    .join('\n');
}

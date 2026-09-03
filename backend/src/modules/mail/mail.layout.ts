/**
 * Habillage commun des e-mails.
 *
 * Écrit en HTML de table et en styles en ligne, à contrecœur mais sans
 * alternative : les clients de messagerie ignorent les feuilles de style
 * externes, et une bonne partie d'entre eux ne comprend ni flexbox ni grid. Ce
 * qui vaut pour le site — `frontend/app/globals.css` — ne s'applique pas ici ;
 * seules les valeurs de la maquette sont reprises à la main.
 *
 * Pas d'image, pas de police distante, pas de pixel de suivi : une image
 * bloquée par défaut casserait la mise en page, et un traceur dans un e-mail
 * transactionnel n'a aucune justification.
 */

const INK = '#1c1b18';
const INK_SOFT = '#55524b';
const PAPER = '#f1f0ea';
const SURFACE = '#ffffff';
const ACCENT = '#0e5c3a';
const LINE = '#dedbd1';

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

export interface EmailBody {
  /** Titre affiché en haut du message. */
  heading: string;
  /** Paragraphes du corps, en texte simple. */
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Mentions de bas de message : validité d'un lien, marche à suivre. */
  footnotes?: string[];
}

/** Échappement HTML. Tout ce qui vient d'un compte passe par là. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderHtml(body: EmailBody): string {
  const paragraphs = body.paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${INK_SOFT};">${escape(text)}</p>`,
    )
    .join('');

  // Le fond et l'espacement du bouton sont portés par la cellule, pas par le
  // lien : `background` et `display:inline-block` sont ignorés par une partie
  // des clients de messagerie, et le bouton s'y afficherait alors en blanc sur
  // blanc. L'attribut `bgcolor`, lui, est compris partout.
  const action = body.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px;">
        <tr><td bgcolor="${ACCENT}" style="background:${ACCENT};padding:13px 26px;">
          <a href="${escape(body.action.url)}" style="font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escape(body.action.label)}</a>
        </td></tr>
      </table>
      <p style="margin:0 0 14px;font-size:12px;line-height:1.6;color:${INK_SOFT};">
        Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br>
        <span style="font-family:${MONO};font-size:11.5px;color:${ACCENT};word-break:break-all;">${escape(body.action.url)}</span>
      </p>`
    : '';

  const footnotes = (body.footnotes ?? [])
    .map(
      (note) =>
        `<p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:${INK_SOFT};">${escape(note)}</p>`,
    )
    .join('');

  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(body.heading)}</title></head>
<body bgcolor="${PAPER}" style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background:${PAPER};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="${SURFACE}" style="width:100%;max-width:560px;background:${SURFACE};border:1px solid ${LINE};">
      <tr><td style="padding:22px 32px;border-bottom:1px solid ${LINE};">
        <span style="font-family:${FONT};font-size:17px;font-weight:700;letter-spacing:0.22em;color:${INK};">BAIL</span>
      </td></tr>
      <tr><td style="padding:30px 32px 34px;font-family:${FONT};">
        <h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;font-weight:600;color:${INK};">${escape(body.heading)}</h1>
        ${paragraphs}
        ${action}
        ${footnotes}
      </td></tr>
      <tr><td style="padding:18px 32px;border-top:1px solid ${LINE};font-family:${MONO};font-size:10.5px;letter-spacing:0.08em;color:${INK_SOFT};">
        BAIL · LOCATION LONGUE DURÉE EN DIRECT · METZ<br>
        <span style="color:${INK_SOFT};">Message automatique — cette adresse ne reçoit pas de réponse.</span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function renderText(body: EmailBody): string {
  const blocks = [
    body.heading.toUpperCase(),
    '',
    ...body.paragraphs.flatMap((text) => [text, '']),
    ...(body.action ? [`${body.action.label} :`, body.action.url, ''] : []),
    ...(body.footnotes ?? []).flatMap((note) => [note, '']),
    '—',
    'Bail · location longue durée en direct · Metz',
    'Message automatique — cette adresse ne reçoit pas de réponse.',
  ];
  return blocks.join('\n');
}

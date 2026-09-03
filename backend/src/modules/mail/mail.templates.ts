import { renderHtml, renderText, type EmailBody } from './mail.layout';

/**
 * Gabarits d'e-mails.
 *
 * Ce sont des fonctions TypeScript, pas des fichiers de gabarit : le
 * compilateur attrape ainsi un champ oublié, alors qu'un moteur de template le
 * rendrait en `undefined` chez le destinataire.
 *
 * Règle commune, sans exception : **aucun e-mail ne transporte de donnée de
 * dossier.** Ni revenu, ni pièce jointe, ni lien vers un fichier privé. Le
 * message dit qu'il s'est passé quelque chose et renvoie sur le site, où la
 * session contrôle qui voit quoi. Une boîte aux lettres se transfère, se
 * pirate et s'indexe ; la promesse faite au locataire ne s'arrête pas au bord
 * du navigateur.
 */
export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

function build(subject: string, body: EmailBody): RenderedTemplate {
  return { subject, html: renderHtml(body), text: renderText(body) };
}

/** Clés de gabarit, journalisées telles quelles dans `email_messages.template`. */
export const TEMPLATE = {
  emailVerification: 'email-verification',
  passwordReset: 'password-reset',
  passwordChanged: 'password-changed',
} as const;

export type TemplateKey = (typeof TEMPLATE)[keyof typeof TEMPLATE];

export function emailVerification(params: {
  firstName: string;
  url: string;
  validHours: number;
}): RenderedTemplate {
  return build('Confirmez votre adresse e-mail', {
    heading: 'Confirmez votre adresse',
    paragraphs: [
      `Bonjour ${params.firstName},`,
      'Une dernière étape avant d’utiliser votre compte Bail : confirmer que cette adresse est bien la vôtre. C’est par elle que passeront les décisions qui vous concernent — candidature retenue, pièce à corriger, rendez-vous de visite.',
    ],
    action: { label: 'Confirmer mon adresse', url: params.url },
    footnotes: [
      `Ce lien est valable ${params.validHours} heures et ne fonctionne qu’une fois.`,
      'Si vous n’avez pas créé de compte sur Bail, ignorez ce message : sans confirmation, aucun compte n’est utilisable avec cette adresse.',
    ],
  });
}

export function passwordReset(params: {
  firstName: string;
  url: string;
  validMinutes: number;
}): RenderedTemplate {
  return build('Réinitialisez votre mot de passe', {
    heading: 'Réinitialisez votre mot de passe',
    paragraphs: [
      `Bonjour ${params.firstName},`,
      'Vous avez demandé à définir un nouveau mot de passe. Le lien ci-dessous vous y mène.',
    ],
    action: { label: 'Choisir un nouveau mot de passe', url: params.url },
    footnotes: [
      `Ce lien est valable ${params.validMinutes} minutes et ne fonctionne qu’une fois.`,
      'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable et personne n’a accédé à votre compte.',
    ],
  });
}

export function passwordChanged(params: {
  firstName: string;
  changedAt: Date;
  revokedSessions: number;
  supportUrl: string;
}): RenderedTemplate {
  const stamp = params.changedAt.toLocaleString('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  });

  return build('Votre mot de passe a été modifié', {
    heading: 'Votre mot de passe a été modifié',
    paragraphs: [
      `Bonjour ${params.firstName},`,
      `Le mot de passe de votre compte Bail a été changé le ${stamp}.`,
      params.revokedSessions > 0
        ? `Par précaution, vos autres sessions ont été fermées : il faudra vous reconnecter sur vos autres appareils (${params.revokedSessions} déconnectée${params.revokedSessions > 1 ? 's' : ''}).`
        : 'Aucune autre session n’était ouverte sur votre compte.',
    ],
    // Ce message n'a pas de bouton : son seul rôle est d'alerter. Un lien
    // d'action dans un e-mail « votre mot de passe a changé » est justement ce
    // qu'imiterait un hameçonnage.
    footnotes: [
      'Vous n’êtes pas à l’origine de ce changement ? Contactez-nous immédiatement — quelqu’un a pu accéder à votre compte.',
      params.supportUrl,
    ],
  });
}

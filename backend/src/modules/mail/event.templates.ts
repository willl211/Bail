import { renderHtml, renderText, type EmailBody } from './mail.layout';
import type { RenderedTemplate } from './mail.templates';

/**
 * Gabarits des notifications d'événements.
 *
 * Séparés des messages liés au compte (`mail.templates.ts`) parce qu'ils
 * obéissent à une contrainte de plus : ils partent en différé, depuis une file
 * d'attente, et ne portent donc **aucun secret**. Leur seul lien est une URL du
 * site, que la session protège à l'arrivée.
 *
 * Comme les autres, ils ne transportent aucune donnée de dossier : ni revenu,
 * ni pièce jointe, ni taux d'effort. Le message dit qu'il s'est passé quelque
 * chose et renvoie sur le site.
 */
function build(subject: string, body: EmailBody): RenderedTemplate {
  return { subject, html: renderHtml(body), text: renderText(body) };
}

/** Clés de gabarit d'événement, telles que consignées dans `email_messages`. */
export const EVENT = {
  applicationReceived: 'application-received',
  applicationShortlisted: 'application-shortlisted',
  applicationRejected: 'application-rejected',
  applicationAccepted: 'application-accepted',
  documentRejected: 'document-rejected',
  fileVerified: 'file-verified',
  fileRejected: 'file-rejected',
  propertyPublished: 'property-published',
  propertyReturned: 'property-returned',
  visitBooked: 'visit-booked',
  visitCancelled: 'visit-cancelled',
} as const;

export type EventKey = (typeof EVENT)[keyof typeof EVENT];

const euros = (cents: number) =>
  `${(cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;

const appointment = (date: Date) =>
  date.toLocaleString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });

// ---------------------------------------------------------------- Propriétaire

export function applicationReceived(p: {
  ownerFirstName: string;
  propertyReference: string;
  propertyTitle: string;
  pendingCount: number;
  url: string;
}): RenderedTemplate {
  return build(`Nouvelle candidature — ${p.propertyReference}`, {
    heading: 'Vous avez reçu une candidature',
    paragraphs: [
      `Bonjour ${p.ownerFirstName},`,
      `Un dossier vient d’être déposé sur ${p.propertyReference} — ${p.propertyTitle}.`,
      p.pendingCount > 1
        ? `${p.pendingCount} candidatures attendent votre réponse sur ce bien.`
        : 'C’est la première candidature sur ce bien.',
    ],
    action: { label: 'Voir la candidature', url: p.url },
    // Le nom du candidat n'apparaît pas : il figure sur l'écran, derrière la
    // session. Un objet d'e-mail se lit par-dessus l'épaule.
    footnotes: [
      'Les pièces du dossier restent chez Bail : vous voyez le résultat des contrôles — revenus vérifiés, taux d’effort, garant — jamais les documents.',
    ],
  });
}

export function propertyPublished(p: {
  ownerFirstName: string;
  propertyReference: string;
  propertyTitle: string;
  url: string;
}): RenderedTemplate {
  return build(`${p.propertyReference} est en ligne`, {
    heading: 'Votre annonce est en ligne',
    paragraphs: [
      `Bonjour ${p.ownerFirstName},`,
      `${p.propertyReference} — ${p.propertyTitle} a passé le contrôle de Bail et est désormais visible des locataires.`,
      'Ouvrez des créneaux de visite pour que les candidats retenus puissent réserver.',
    ],
    action: { label: 'Voir mon annonce', url: p.url },
  });
}

export function propertyReturned(p: {
  ownerFirstName: string;
  propertyReference: string;
  reason: string;
  url: string;
}): RenderedTemplate {
  return build(`${p.propertyReference} — correction demandée`, {
    heading: 'Votre annonce demande une correction',
    paragraphs: [
      `Bonjour ${p.ownerFirstName},`,
      `${p.propertyReference} n’a pas passé le contrôle et repasse en brouillon.`,
      `Motif : ${p.reason}`,
      'Corrigez ce point, puis soumettez-la de nouveau : rien n’est perdu.',
    ],
    action: { label: 'Corriger mon annonce', url: p.url },
  });
}

export function visitBooked(p: {
  ownerFirstName: string;
  propertyReference: string;
  scheduledAt: Date;
  isVideo: boolean;
  url: string;
}): RenderedTemplate {
  return build(`Visite réservée — ${p.propertyReference}`, {
    heading: 'Un créneau de visite a été réservé',
    paragraphs: [
      `Bonjour ${p.ownerFirstName},`,
      `${p.propertyReference} sera visité ${appointment(p.scheduledAt)}${
        p.isVideo ? ', en visio' : ', sur place'
      }.`,
      'Un agent Bail accompagne la visite : vous n’avez pas à vous déplacer.',
    ],
    action: { label: 'Voir mes visites', url: p.url },
  });
}

export function visitCancelled(p: {
  firstName: string;
  propertyReference: string;
  scheduledAt: Date;
  url: string;
}): RenderedTemplate {
  return build(`Visite annulée — ${p.propertyReference}`, {
    heading: 'Une visite a été annulée',
    paragraphs: [
      `Bonjour ${p.firstName},`,
      `La visite de ${p.propertyReference} prévue ${appointment(p.scheduledAt)} est annulée. Le créneau redevient disponible.`,
    ],
    action: { label: 'Voir les créneaux', url: p.url },
  });
}

// ------------------------------------------------------------------- Locataire

export function applicationShortlisted(p: {
  tenantFirstName: string;
  propertyReference: string;
  propertyTitle: string;
  url: string;
}): RenderedTemplate {
  return build(`Votre candidature est retenue — ${p.propertyReference}`, {
    heading: 'Le propriétaire souhaite vous rencontrer',
    paragraphs: [
      `Bonjour ${p.tenantFirstName},`,
      `Votre candidature sur ${p.propertyReference} — ${p.propertyTitle} a retenu l’attention du propriétaire. Vous pouvez maintenant réserver un créneau de visite.`,
      'Les créneaux partent vite : le premier à réserver prend la place.',
    ],
    action: { label: 'Choisir un créneau', url: p.url },
  });
}

export function applicationRejected(p: {
  tenantFirstName: string;
  propertyReference: string;
  reason: string | null;
  url: string;
}): RenderedTemplate {
  return build(`Candidature non retenue — ${p.propertyReference}`, {
    heading: 'Votre candidature n’a pas été retenue',
    paragraphs: [
      `Bonjour ${p.tenantFirstName},`,
      `Le propriétaire de ${p.propertyReference} a retenu un autre dossier.`,
      ...(p.reason ? [`Motif indiqué : ${p.reason}`] : []),
      'Votre dossier reste vérifié et prêt : il repart en un clic sur un autre bien.',
    ],
    action: { label: 'Voir les biens disponibles', url: p.url },
  });
}

export function applicationAccepted(p: {
  tenantFirstName: string;
  propertyReference: string;
  propertyTitle: string;
  rentCents: number;
  url: string;
}): RenderedTemplate {
  return build(`Le logement est pour vous — ${p.propertyReference}`, {
    heading: 'Votre candidature est acceptée',
    paragraphs: [
      `Bonjour ${p.tenantFirstName},`,
      `Le propriétaire de ${p.propertyReference} — ${p.propertyTitle} vous a retenu. Le bail est en préparation : ${euros(p.rentCents)} par mois, charges comprises.`,
      'Vous serez prévenu dès qu’il sera prêt à signer.',
    ],
    action: { label: 'Suivre mon dossier', url: p.url },
  });
}

export function documentRejected(p: {
  tenantFirstName: string;
  documentLabel: string;
  reason: string;
  url: string;
}): RenderedTemplate {
  return build('Une pièce de votre dossier demande une correction', {
    heading: 'Une pièce à remplacer',
    paragraphs: [
      `Bonjour ${p.tenantFirstName},`,
      `Nos équipes n’ont pas pu valider votre ${p.documentLabel.toLowerCase()}.`,
      `Motif : ${p.reason}`,
      'Déposez une nouvelle version depuis votre dossier : vos candidatures en cours reprennent dès qu’elle est validée.',
    ],
    action: { label: 'Remplacer la pièce', url: p.url },
  });
}

export function fileVerified(p: {
  tenantFirstName: string;
  fileReference: string;
  url: string;
}): RenderedTemplate {
  return build('Votre dossier est vérifié', {
    heading: 'Votre dossier est vérifié',
    paragraphs: [
      `Bonjour ${p.tenantFirstName},`,
      `Toutes les pièces de votre dossier ${p.fileReference} ont été contrôlées par Bail. Il part désormais complet à chaque candidature.`,
      'C’est ce qui vous fait passer devant : le propriétaire n’a plus rien à vérifier lui-même.',
    ],
    action: { label: 'Candidater à un bien', url: p.url },
  });
}

export function fileRejected(p: {
  tenantFirstName: string;
  fileReference: string;
  url: string;
}): RenderedTemplate {
  return build('Votre dossier n’a pas pu être validé', {
    heading: 'Votre dossier demande une reprise',
    paragraphs: [
      `Bonjour ${p.tenantFirstName},`,
      `Le contrôle du dossier ${p.fileReference} n’a pas abouti. Le détail, pièce par pièce, est indiqué dans votre espace.`,
      'Vos candidatures sont suspendues le temps de la correction — elles ne sont pas supprimées.',
    ],
    action: { label: 'Voir mon dossier', url: p.url },
  });
}

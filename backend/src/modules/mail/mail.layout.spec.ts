import { renderHtml, renderText } from './mail.layout';

/**
 * Habillage des e-mails.
 *
 * Deux exigences que ces tests protègent. D'abord l'échappement : tout ce qui
 * vient d'un compte — un prénom, un motif de refus — traverse ce fichier, et un
 * `<script>` recopié tel quel dans un HTML envoyé par courrier est exactement
 * ce qu'un attaquant cherche. Ensuite la compatibilité : `bgcolor` double
 * chaque `background`, faute de quoi le bouton s'affiche en blanc sur blanc
 * chez une partie des clients de messagerie.
 */
const body = {
  heading: 'Votre candidature est retenue',
  paragraphs: ['Bonjour Camille,', 'Le propriétaire souhaite vous rencontrer.'],
  action: { label: 'Choisir un créneau', url: 'https://bail.local/biens/MZ-0155/visite' },
  footnotes: ['Les créneaux partent vite.'],
};

describe('renderHtml', () => {
  it('reprend le titre, les paragraphes, l’action et les mentions', () => {
    const html = renderHtml(body);

    expect(html).toContain('Votre candidature est retenue');
    expect(html).toContain('Bonjour Camille,');
    expect(html).toContain('Choisir un créneau');
    expect(html).toContain('Les créneaux partent vite.');
  });

  it('échappe le HTML venant des données', () => {
    const html = renderHtml({
      heading: 'Titre',
      paragraphs: ['<script>alert("xss")</script>'],
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('échappe aussi l’URL d’action', () => {
    const html = renderHtml({
      heading: 'Titre',
      paragraphs: [],
      action: { label: 'Ouvrir', url: 'https://bail.local/x" onmouseover="alert(1)' },
    });

    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain('&quot;');
  });

  it('double chaque fond par un attribut bgcolor', () => {
    // `background` en CSS est ignoré par plusieurs clients de messagerie :
    // sans `bgcolor`, le bouton s'y afficherait en blanc sur blanc.
    const html = renderHtml(body);
    expect(html).toMatch(/<td bgcolor="#0e5c3a"/);
    expect(html).toMatch(/bgcolor="#f1f0ea"/);
  });

  it('rappelle le lien en clair sous le bouton', () => {
    // Un bouton dont le client de messagerie mange le style laisse
    // l'utilisateur sans moyen d'agir.
    const html = renderHtml(body);
    expect(html).toContain('https://bail.local/biens/MZ-0155/visite');
  });

  it('n’embarque ni image ni police distante', () => {
    // Une image bloquée par défaut casserait la mise en page, et un traceur
    // dans un e-mail transactionnel n'a aucune justification.
    const html = renderHtml(body);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/fonts\.googleapis|@font-face/i);
  });

  it('omet le bloc d’action quand il n’y en a pas', () => {
    const html = renderHtml({ heading: 'Titre', paragraphs: ['Corps.'] });
    expect(html).not.toContain('Si le bouton ne fonctionne pas');
  });
});

describe('renderText', () => {
  it('produit une version lisible sans balise', () => {
    const text = renderText(body);

    expect(text).toContain('VOTRE CANDIDATURE EST RETENUE');
    expect(text).toContain('https://bail.local/biens/MZ-0155/visite');
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it('rappelle que l’adresse ne reçoit pas de réponse', () => {
    expect(renderText(body)).toContain('ne reçoit pas de réponse');
  });
});

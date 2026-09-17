# Étape 8 — finitions du 17 septembre 2026

## Développement réalisé

La palette crème, olive et bois ainsi que les illustrations sont conservées.
Newsreader compose les grands titres, DM Sans l’interface et IBM Plex Mono les
données. Les cinq fichiers de polices et leurs licences sont locaux.

La passe responsive complète la passe typographique :

- Menu compact jusqu’à 1080 px, identique pour les trois rôles, avec déconnexion.
  Fermeture par lien, Échap avec retour du focus et sortie au clavier.
- Lien d’évitement vers le contenu, un seul repère principal sur l’accueil,
  focus visible des champs et commandes tactiles agrandies.
- Formulaires sur une colonne sur téléphone, champs de 16 px, textes longs
  pouvant revenir à la ligne et boutons lisibles sans débordement volontaire.
- Filtres compacts à 320 px, tri sur sa propre ligne, barre de recherche empilée.
- Panneaux propriétaire/locataire plus lisibles ; déconnexion disponible même
  sur les petites largeurs ; candidatures sur une colonne.
- Galerie corrigée : les hauteurs de cellules mobiles suivent les images.
  La fiche affiche désormais les photos réellement fournies par l’API,
  avec remplacement visuel en cas d’absence ou de chargement échoué.
- Tableaux isolés dans une région défilante accessible au clavier ; onglets
  admin, chiffres, frise du bail et journal adaptés aux petits écrans.
- Page d’erreur compréhensible avec nouvelle tentative ; aucun mode d’emploi
  technique affiché au visiteur. Recherche vide avec retour à tous les biens.
- Exploitation et suivi de suppression : nouvelle tentative après panne,
  distinction entre chargement, erreur et absence de données.
- Déconnexion : un échec réseau garde l’utilisateur sur place avec un message
  et la possibilité de réessayer, sans prétendre que sa session est fermée.

Les règles partagées sont dans `frontend/app/responsive.css`, chargé après le
socle. Les règles spécifiques aux écrans restent dans leurs feuilles existantes.

## Textes rectifiés

Les indicateurs `source: setting` ne sont plus présentés comme des mesures sur
les pages publiques. Le compteur de biens et la médiane calculée restent affichés,
avec leur périmètre : annonces WHOMA en ligne, charges comprises.

Retrait des délais garantis, de la vérification automatique annoncée comme active,
de la promesse de priorité du dossier, de l’affirmation d’hébergement en France
non vérifiée et de la visio proposée sur la fiche logement. La recherche ne promet
plus une absence de frais alors que des honoraires sont prévus. L’administration
précise que le circuit des fonds reste à finaliser et que ses états ne prouvent
pas un virement bancaire.

## Vérifications et limites

- Suite frontend : **205 tests réussis dans 28 suites**. Les nouveaux scénarios
  couvrent le menu au clavier, les reprises après panne et la déconnexion.
- Compilation de production Next.js et vérification TypeScript réussies.
- Contrôle HTTP des pages publiques et des cinq polices locales réussi.
- Contrôle HTTP de la fiche logement, des espaces locataire et propriétaire
  (dossier, sauvegardes, données, biens, candidatures, abonnement, compte et dépôt)
  et de l’écran MFA admin réussi. Les sessions créées pour ces contrôles ont
  été fermées ; aucun facteur MFA n’a été configuré sur un compte de démonstration.
- Lint frontend et `git diff --check` réussis.
- Les tests de composants utilisent jsdom : ils ne mesurent pas le rendu CSS.

**La recette visuelle finale n’est pas effectuée.** Le navigateur de contrôle ne
renvoie aucun navigateur disponible (`[]`). Il est donc incorrect de déclarer
les largeurs ci-dessous validées ou l’étape entièrement clôturée. La précédente
recette visuelle de la palette précède cette modification de typographie et ne
valide pas cette passe responsive.

## Recette à réaliser dès qu’un navigateur est connecté

| Parcours | Écrans et situations | Largeurs |
|---|---|---|
| Visiteur | Accueil, maison, recherche/filtres ouverts, aucun résultat, fiche/photos, connexion et inscriptions | 320, 375, 390, 430, 768, 1080, 1440 px |
| Locataire | Chaque rubrique du dossier, documents longs, sauvegardes, visite, bail, honoraires, mes données | mêmes largeurs |
| Propriétaire | Mes biens, dépôt, candidatures nombreuses/vides, abonnement, compte | mêmes largeurs |
| Administration | MFA, dossier et aperçu PDF, biens, baux, exploitation, erreurs et listes vides | mêmes largeurs |

Contrôler : aucun contenu coupé latéralement, menus utilisables au clavier,
zones tactiles, nouvelles polices, focus, retour arrière et restauration des
filtres, contrastes des états, téléchargement, clavier virtuel ouvert, portrait
et paysage. Compléter sur Safari iOS et Chrome Android réels. Garder la revue
visuelle comme condition de clôture de l’étape 8, puis rejouer les parcours
métier en préproduction à l’étape 9.

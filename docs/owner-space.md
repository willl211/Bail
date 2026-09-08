# Espace propriétaire — septembre 2026

Le menu commun `OwnerAside` reprend les tons pierre, bois et olive et l’image existante `whoma-owner-panel.webp`. Les quatre onglets et les pages de gestion d’un bien partagent cet habillage. Sur mobile, le menu se place au-dessus du contenu.

Chaque logement dispose d’une vignette dans Mes biens et Candidatures. La première photo, selon son ordre enregistré, est affichée. En l’absence de photo ou si son chargement échoue, un emplacement « Photo à ajouter » apparaît. Les photos fictives de la démonstration peuvent donc afficher cet emplacement ; aucune image de logement n’est inventée.

La page Candidatures commence par un répertoire des logements : recherche par adresse, quartier, titre ou référence, filtres de réception et pagination de huit biens. Les nouvelles candidatures passent en premier. L’ouverture d’un bien affiche son identité au-dessus de ses candidats, puis le dossier sélectionné et les actions existantes. Un identifiant de candidat appartenant à un autre bien ne peut pas afficher son dossier dans ce contexte.

## Informations du compte

- `PATCH /api/v1/owner/contact` modifie uniquement le prénom, le nom et le téléphone du propriétaire connecté. Le formulaire d’adresse postale conserve son API.
- `POST /api/v1/auth/email/change` exige le mot de passe actuel et envoie une confirmation à la nouvelle adresse. L’adresse actuelle reste active en attendant. Trois demandes par heure et par utilisateur sont autorisées.
- `POST /api/v1/auth/email/change/confirm` consomme le jeton à usage unique, confirme la nouvelle adresse et révoque les sessions dans une transaction. L’ancienne adresse reçoit une notification. Une nouvelle demande ou un changement de mot de passe invalide les liens précédents.
- La page `/changement-email` demande une confirmation explicite : ouvrir le lien ne modifie pas le compte. En développement, les messages sont consultables dans Mailpit, sur `http://localhost:8025`.

La migration `20260908010000_email_change` ajoute l’usage `EMAIL_CHANGE` et les adresses source et cible aux jetons. Elle a été appliquée à la base locale sans réinitialisation des comptes ou des biens.

## Vérification

Les tests d’intégration couvrent les autorisations, les informations personnelles, les validations, le changement d’adresse, les liens expirés ou remplacés, les confirmations simultanées, les adresses déjà prises, les échecs d’envoi et les vignettes. Les tests d’interface vérifient la recherche, les filtres, la pagination, le contexte des candidats et les formulaires. Les parcours existants d’authentification, d’adresse postale et d’attribution ont également été vérifiés.

Le contrôle dans le navigateur couvre les quatre onglets, le détail d’une candidature et les largeurs 1440, 1060, 390 et 320 px. Les vérifications n’ont pas modifié le compte de démonstration.

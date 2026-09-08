# Espace locataire — septembre 2026

Le panneau `TenantAside` est partagé entre le dossier et les biens sauvegardés. Il utilise le même visuel architectural et les mêmes tons pierre, bois et olive que l’espace propriétaire. Le lien Rechercher un bien en double est retiré ; la recherche reste accessible dans la navigation générale. Le loyer conseillé et la déconnexion restent dans le panneau, adapté aux petits écrans.

## Dossier

- Vue d’ensemble : statut, prochaine action, tâches manquantes et suivi compact des vérifications. Les accès qui répétaient les onglets et le compteur du menu gauche ont été retirés. La synthèse destinée aux propriétaires et l’historique se déplient à la demande.
- Ma situation : fiche récapitulative, puis formulaire sur clic de Modifier. Annuler restaure les données enregistrées ; une sauvegarde réussie revient à la fiche.
- Mes documents : pièces refusées, expirées ou manquantes en premier, puis celles en cours de contrôle. Les documents validés sont repliés. Les motifs et les indications de remplacement restent visibles.
- Mon garant : choix entre une personne, un organisme et aucun garant ; seuls les champs utiles sont envoyés. Le choix Aucun ne supprime rien à lui seul : un garant enregistré et ses pièces ne sont retirés qu’après confirmation explicite.

Les formulaires restent montés quand leur rubrique est masquée pour conserver la saisie non enregistrée. Les réponses de l’API actualisent le dossier commun à toutes les rubriques. Le verrouillage pendant le contrôle, les règles de dépôt et de suppression, ainsi que le blocage de transmission d’un dossier incomplet restent appliqués. Les rubriques sont locales à la page : un rechargement revient à la vue d’ensemble.

Une confirmation explique la remise en contrôle lorsqu’une modification fait passer le dossier de Vérifié à Transmis, selon la réponse de l’API. L’interface explique aussi ce comportement avant les modifications concernées. Le renvoi d’un dossier incomplet ou refusé utilise l’API de transmission existante ; la liste des éléments bloquants provient du serveur.

Le panneau gauche mesure de 285 à 350 px sur ordinateur et utilise la hauteur de la fenêtre, avec une image plus grande et le budget en pied de panneau. Le contenu utilise une largeur maximale de 1680 px. Sur mobile, le panneau se compacte à environ 244 px de haut à 390 px de large, au lieu de 364 px précédemment.

## Biens sauvegardés

La première photo de l’annonce, déjà fournie par l’API, apparaît avec le titre, les caractéristiques, le prix charges comprises et les actions existantes. Les biens loués ou retirés restent visibles. Une photo absente ou inaccessible affiche « Photo indisponible » ; les données de démonstration référencent actuellement des fichiers photo fictifs. Aucune photo de logement n’est inventée.

## Vérification

Les tests couvrent la navigation entre rubriques, la conservation et l’annulation des saisies, la transmission et ses erreurs, le verrouillage, l’explication des changements de statut, le classement des documents, le choix et le retrait du garant, les vignettes et les annonces retirées. Le contrôle visuel avec le compte de démonstration couvre les largeurs 1920, 1440, 1000, 390 et 320 px, sans modification de ses données.

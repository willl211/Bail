# Contrôle des documents admin — 9 septembre 2026

Le registre `/back-office` permet désormais de consulter les justificatifs locataires et les diagnostics du logement, puis de décider sur la pièce examinée. Le contrôle reste manuel ; les prestataires du pilote conservent leur mode simulé.

## Parcours

- **Dossiers** : choisir le locataire, puis la pièce. L'aperçu privé, son statut et son motif de refus sont réunis. La validation nécessite l'ouverture du fichier et une confirmation de lecture. Chaque pièce dispose de son propre motif, effacé lorsqu'on change de document. La validation globale du dossier reste une décision distincte.
- **Biens** : rechercher par référence, adresse, titre ou propriétaire, filtrer les annonces et sélectionner le bien. Les diagnostics s'ouvrent dans le même espace de consultation. Pour le DPE, l'agent saisit la date de réalisation, la fin de validité et la classe lue sur la pièce ; la classe doit correspondre à l'annonce. Les dates ne sont pas déduites automatiquement d'une durée réglementaire.
- **Correction** : refuser la pièce avec un motif, puis renvoyer l'annonce au propriétaire. Celui-ci retrouve le motif de la pièce et celui du renvoi dans son espace, remplace le diagnostic et soumet à nouveau. Les annonces renvoyées restent consultables dans le registre.
- **Publication** : un DPE déposé peut être soumis au contrôle en état `PENDING`. La publication exige un DPE `VERIFIED` dont la fin de validité est connue et non dépassée. Le bail utilise le même contrôle de validité pour le DPE et ses annexes.

Les décisions sur les diagnostics sont disponibles pour les annonces `PENDING_REVIEW`. Les autres statuts permettent la consultation ; ce changement n'ajoute pas de procédure de retrait des annonces déjà publiées ou de renouvellement des diagnostics en cours de bail.

## Protection et historique

Les nouvelles routes `/admin/property-documents/:id/file` et `/admin/property-documents/:id/decision` sont réservées au rôle `AGENT`. Les fichiers restent privés, servis avec `Cache-Control: private, no-store` et `X-Content-Type-Options: nosniff`. La consultation est journalisée côté serveur avec l'identifiant de l'agent. Les URL de stockage ne sont pas renvoyées dans les listes admin. L'aperçu utilise un blob local au navigateur, libéré lorsqu'on change de pièce ou quitte l'écran.

Le backend refuse une validation de pièce si son fichier est absent ou vide. Les refus peuvent être enregistrés même si le fichier est indisponible, afin de demander un nouveau dépôt. La confirmation de lecture de l'interface guide l'agent ; elle ne constitue pas une preuve technique qu'un humain a effectivement lu le contenu.

Chaque modification du propriétaire et chaque décision avance `Property.reviewRevision` dans une transaction conditionnelle. Les lectures d'aperçu et les décisions transmettent la version affichée ; une version obsolète est refusée. Le remplacement réinitialise statut, dates et validation. Une modification de l'adresse, du quartier, de la surface, des classes énergétiques ou de l'année de construction remet les diagnostics vérifiés en attente de contrôle.

`PropertyReviewEvent` conserve l'auteur, la date, la version, le motif et les métadonnées examinées, même après remplacement ou retrait du document. Les fichiers bruts ne sont pas copiés dans l'historique. Ces événements sont visibles dans le bien et dans le journal général. Les dossiers locataires conservent leur historique et leurs protections de version existants.

## Migration et limites

Migration additive : `20260909020000_property_document_review` ajoute la version du bien, la date de validation du diagnostic et son historique. Elle préserve les annonces, pièces et décisions existantes ; elle ne transforme pas les données de démonstration en contrôles humains ni ne relance le seed.

Ce changement traite le point 3 de l'audit et la traçabilité des décisions sur les diagnostics et les annonces du point 11. Il ne résout pas l'éligibilité énergétique du point 6, l'identification des signataires, ni les paiements. Le contrôle des autres diagnostics selon les caractéristiques du logement reste limité aux règles déjà présentes.

## Vérification

Les tests couvrent le dépôt jusqu'à la publication, les accès privés selon le rôle, les dates et la classe du DPE, les fichiers absents, les refus motivés, la conservation de l'historique, le remplacement, l'invalidation après modification et les décisions simultanées. Les tests d'interface vérifient la lecture préalable, les champs du DPE et l'isolation des motifs entre pièces. Le navigateur a également servi à vérifier l'aperçu PDF et l'affichage à différentes largeurs, de 320 à 1 920 pixels.

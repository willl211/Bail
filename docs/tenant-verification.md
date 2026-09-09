# Fiabilité du dossier locataire — 9 septembre 2026

Une validation porte désormais sur une version précise du dossier. Les revenus
déclarés ne sont présentés comme vérifiés que si cette version est encore
courante et que toutes les pièces requises sont validées.

## Changements de données

- Modifier les revenus, l’employeur, la situation professionnelle ou la période
  d’essai retire la validation du dossier. Les pièces professionnelles déjà
  validées ou en cours d’analyse repassent en attente de rapprochement. Les
  refus et leurs motifs sont conservés.
- Enregistrer les mêmes valeurs ne modifie ni la version, ni la validation. Le
  formulaire conserve les centimes et refuse les revenus négatifs.
- Modifier les informations du garant nécessite un nouveau contrôle. Changer
  son identité ou son type retire ses anciennes pièces et demande celles du
  nouveau garant ; le formulaire annonce cette conséquence avant l’enregistrement.
- Ajouter ou retirer une pièce, supprimer un garant, transmettre le dossier ou
  rendre une décision produit une nouvelle version.
- Le statut `UNDER_REVIEW` conserve son verrou sur les modifications locataires.

Les documents et les décisions sont enregistrés avec la modification de la
version dans une même transaction. Une écriture conditionnelle sur la version
empêche une décision concurrente de conserver un sceau devenu invalide. Un
retour tardif du prestataire ne remplace pas une décision humaine ou une
invalidation intervenue pendant l’analyse.

## Une règle de validation commune

`tenant-file.policy.ts` définit l’agrégation des statuts et les contrôles exigés.
Un bulletin vérifié ne compense pas un autre bulletin manquant, refusé, expiré
ou en attente sur la même ligne. Le passeport est reconnu sur la ligne identité.
La situation et le revenu doivent être renseignés ; zéro est un revenu renseigné.

L’admin, l’espace locataire et la synthèse propriétaire utilisent ces règles.
Les types de pièces exigés restent ceux du MVP : cette évolution n’ajoute pas
de nouvelles exigences documentaires.

## Décisions et historique

Les décisions admin exigent `expectedRevision`. Une ancienne page reçoit un
conflit 409 et l’interface recharge les données. L’auteur provient de la session
authentifiée, jamais du formulaire.

La table `tenant_file_events` conserve chaque événement avec sa version, sa
date, son auteur et son motif. Une décision sur le dossier conserve également
un instantané des déclarations, du garant et des références/statuts des pièces.
Les fichiers bruts et leurs clés de stockage ne figurent pas dans cet instantané.
Un retrait de pièce ne supprime pas la trace de son contrôle. La suppression
du dossier supprime ses événements en cascade.

L’historique apparaît dans l’espace locataire, le panneau admin et le journal
du back-office. L’admin voit les déclarations à contrôler et peut ouvrir les
justificatifs via une route privée, réservée au rôle `AGENT`, sans cache partagé.
Les propriétaires ne reçoivent ni les documents ni les instantanés privés.

Le propriétaire voit « revenus déclarés · à vérifier » après modification.
Le taux d’effort reste masqué jusqu’à la nouvelle validation, puis est calculé
sur les revenus courants vérifiés et le loyer courant du bien. Les candidatures
existantes sont conservées.

## Migration et limites

La migration `20260909010000_tenant_file_verification` conserve les données et
les pièces existantes. Les anciens dossiers `VERIFIED` repassent en
`SUBMITTED`, avec un événement expliquant la nouvelle validation nécessaire :
leur ancien sceau ne permettait pas de déterminer les données effectivement
contrôlées. Aucun auteur ou instantané historique n’est inventé.

Le seed reste explicitement un jeu de démonstration. Il avance la version lors
de sa réinitialisation et identifie ses contrôles comme simulés. Il ne doit pas
être exécuté pour migrer des données existantes.

Le prestataire de vérification reste `mock` : cette évolution fiabilise les
règles et la reprise humaine, elle ne branche pas une analyse IA réelle. Le
contrôle des diagnostics des logements et les autres points de l’audit restent
des chantiers distincts.

## Vérifications

- Tests de la règle commune : statuts bloquants, identité, absence de données,
  revenu nul et validation périmée.
- Tests PostgreSQL : invalidation, conservation de l’instantané, décisions
  simultanées, page admin obsolète, retour tardif du prestataire, garant et droits
  d’accès aux pièces.
- Tests des interfaces : version envoyée, consultation privée, conservation
  des centimes, refus d’un revenu négatif et parcours existants.

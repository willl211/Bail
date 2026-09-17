# Publication et diagnostics — 14 septembre 2026

Le circuit implémenté vise la location de résidence principale en métropole (pilote Metz), avec un DPE. Les exemptions de DPE et les situations particulières nécessitent un examen humain ; aucune exemption n'est déduite de la surface habitable.

## Parcours

- Le propriétaire renseigne l'année de construction et quatre réponses explicites : électricité de plus de 15 ans, gaz de plus de 15 ans, zone à risques, zone de bruit des aéroports. « À vérifier » bloque la soumission, mais permet d'enregistrer le brouillon.
- Le DPE est demandé dans ce circuit. Le CREP est demandé avant 1949 ; gaz, électricité, risques et bruit selon les réponses. Les documents peuvent être en attente de contrôle à la soumission.
- Un agent consulte les fichiers, vérifie les déclarations et les dates, puis décide de leur validation. La publication exige les pièces applicables vérifiées et valides.
- Le CREP sans plomb ou sous le seuil nécessite une confirmation explicite de l'agent pour une validité illimitée. Les conclusions dangereuses et les travaux nécessaires restent à examiner manuellement.
- La préparation et l'envoi du bail utilisent les mêmes exigences de diagnostics. L'amiante reste disponible sur demande : il ne figure plus systématiquement parmi les annexes du bail. Aucune clause juridique n'a été modifiée.

Exiger les diagnostics applicables **avant publication** est la politique de whoma pour préparer les visites et le bail. Cela ne signifie pas que tous les diagnostics sont légalement exigibles dès la publication de toute annonce. Voir [les pièces à fournir en location](https://www.service-public.gouv.fr/particuliers/vosdroits/F33463).

## Énergie et dates

Les classes G sont refusées ; F le sera au 1er janvier 2028 et E au 1er janvier 2034. Les changements de calendrier suivent l'heure de Paris. Avant signature, la classe est aussi contrôlée à la date de début prévue du bail. Source : [décence énergétique en métropole](https://www.service-public.gouv.fr/particuliers/vosdroits/F35978/0_0_1).

L'agent saisit le dernier jour de validité, inclus jusqu'à 23:59:59.999 UTC. L'API refuse les dates impossibles, futures pour la réalisation, expirées, inversées et dépassant les plafonds. Par prudence, le dernier jour accepté précède l'anniversaire de fin de durée.

- DPE : réalisé depuis juillet 2021 et durée maximale de dix ans. Une attestation de nouvelle étiquette ne doit pas prolonger la validité du diagnostic d'origine. [DPE](https://www.service-public.gouv.fr/particuliers/vosdroits/F16096).
- Gaz et électricité : six ans au maximum. [Gaz](https://www.service-public.gouv.fr/particuliers/vosdroits/F17337), [électricité](https://www.service-public.gouv.fr/particuliers/vosdroits/F18692).
- CREP : six ans, ou validité illimitée si le résultat le permet. [Plomb](https://www.service-public.gouv.fr/particuliers/vosdroits/F1142).
- ERP : moins de six mois, et actualisation nécessaire si les informations changent. [État des risques](https://www.service-public.gouv.fr/particuliers/vosdroits/F12239).
- Bruit : date de réalisation exigée ; plan en vigueur à vérifier manuellement, sans durée légale inventée. [Bruit des aéroports](https://www.service-public.gouv.fr/particuliers/vosdroits/F35266).

## Expiration et reprise

Les listes publiques, la fiche directe, les nouveaux parcours de candidature et de visite utilisent le même filtre d'éligibilité. Un diagnostic expiré n'est donc pas exposé en attendant la tâche périodique. Les favoris conservés indiquent le logement indisponible ; le calcul des biens facturables l'exclut aussi.

Chaque minute, une tâche traite jusqu'à 100 annonces devenues inéligibles : retour en brouillon, motif détaillé et événement horodaté. Une comparaison du statut et de la version évite d'écraser une décision concurrente. Les candidatures, rendez-vous et baux existants ne sont pas supprimés ; les biens loués ou archivés ne sont pas modifiés.

Le propriétaire remplace les pièces concernées, complète les réponses et soumet à nouveau le bien. Une modification des caractéristiques ou réponses invalide les contrôles précédents. La synchronisation de l'abonnement est reprise après échec grâce à un marqueur persistant en base.

## Migration et limites

La migration est additive. **Les anciennes réponses sont UNKNOWN**, aucune obligation ou exemption n'est inventée. Les annonces existantes incomplètes deviennent indisponibles et repassent en brouillon au prochain contrôle. Les fichiers et historiques sont conservés ; aucun jeu de données n'est réinitialisé.

Ce contrôle de dates et de déclarations ne certifie ni l'authenticité du DPE, ni la sécurité physique du logement, ni l'actualité d'un zonage. Restent manuels : vérification ADEME et diagnostiqueur, plans actualisés, obligations amiante et travaux. La remise effective des annexes et la preuve de remise de l'ERP lors d'une visite devront être intégrées au parcours documentaire et au prestataire de signature. Les mentions énergétiques détaillées des annonces (estimations de dépenses et années de référence) restent un chantier distinct à compléter avant lancement.

Les tests utilisent uniquement la base isolée `bail_test` et des documents fictifs. Les fichiers du poste et les pièces réelles ne sont pas envoyés à un service externe.

## Validation locale terminée — 14 septembre 2026

- Types et lint backend/frontend : réussis.
- Tests unitaires backend : 169 réussis.
- Campagne complète frontend : 178 tests réussis, 21 suites, dont l'enregistrement des réponses et l'affichage conditionnel des pièces.
- Campagne complète PostgreSQL : 245 tests réussis, 19 suites. Les cas de fin de mois, de blocage du bail et de reprise d'une ancienne validation passent, ainsi que les parcours existants d'accès, de candidature, de notification, de dépôt et d'analyse des pièces.
- Contrôle visuel réalisé dans Chrome à 1440, 390 et 320 px : formulaire propriétaire, liste Mes biens et panneau admin. Aucun débordement horizontal ni erreur JavaScript ; le choix « gaz requis » actualise bien les pièces attendues. Les motifs longs débordaient initialement du formulaire et de la liste : ils reviennent maintenant à la ligne dans leur panneau.
- Migration locale appliquée et services du site/API rétablis. Les anciens biens incomplets restent à compléter avant republication ; aucune donnée de démonstration n'a été réinitialisée.
- Traces locales : `.cache/publication-validation-int.log`, `.cache/publication-validation-front.log`, `.cache/publication-qa/results.json` et captures associées. Script de contrôle : `.cache/verify-publication.cjs`, sans sauvegarde métier.

Les messages de panne fictive dans les tests backend sont attendus pour les scénarios de reprise. L'avertissement jsdom sur `window.location.reload()` dans le test de visite est préexistant et ne fait échouer aucun test. Les limites juridiques et les intégrations restantes décrites ci-dessus demeurent hors de cette validation technique.

# Brief produit

## Vision complète (long terme, pas toute pour le MVP)

- Les propriétaires mettent leur bien en location en payant un abonnement à la plateforme plutôt que de passer par une agence.
- Les locataires cherchent des biens comme sur SeLoger ou Leboncoin.
- Les locataires déposent un dossier numérique complet pour candidater aux biens correspondant à leurs critères et à leurs moyens.
- À terme, des visites autonomes de l'appartement via un boîtier à clé connecté et un code donné dans l'app, sécurisées par une pré-autorisation carte bancaire, une vérification d'identité et une signature électronique.
- Si le bien convient : rédaction du bail et signature en ligne, assistées par une IA.
- Le locataire paie des frais à la plateforme comme à une agence, mais moins chers.
- Une fois installé, le locataire a accès à un espace de services : copropriété, syndic, assistance via un réseau de partenaires (serrurier, plombier, etc.), sans avoir à démarcher qui que ce soit lui-même.

## Périmètre du MVP v0 (ce qu'il faut construire maintenant)

Le MVP v0 couvre le parcours complet, **sans** le boîtier connecté. La visite se fait accompagnée (agent physique) ou en visio en direct — au choix du locataire.

Modules à construire :
- Espace propriétaire (dépôt d'annonce, abonnement, suivi des candidatures)
- Espace locataire (recherche, filtres, dossier numérique)
- Prise de RDV de visite (accompagnée ou visio)
- Génération de bail à partir de modèles légaux + signature électronique
- Calcul et paiement des honoraires (barème réglementaire, encore à finaliser — voir `legal-context.md`)
- Back-office agence (registre des mandats, suivi des dossiers)

Hors périmètre v0, à ne pas construire maintenant :
- Boîtier connecté / visite 100% autonome (prévu v1)
- Services post-emménagement (syndic, assistance, réseau d'artisans) — viendra juste après le lancement commercial, pas nécessaire pour valider le MVP
- Bail mobilité (1-10 mois) — non retenu pour le MVP v0
- Intégration Visale (garantie loyers étudiants) — non retenue pour le MVP v0

## Pourquoi ce phasage

La visite autonome pose des questions de responsabilité (accident, dégradation, occupation frauduleuse pendant une visite sans témoin) et nécessite une infrastructure matérielle (boîtiers IoT) coûteuse à sécuriser correctement. Le choix a été fait de valider d'abord la demande, le parcours et le modèle économique avec des visites accompagnées/visio, avant d'investir dans le matériel connecté.

## Biens mis en avant — précision du 4 septembre 2026

Deux pistes avaient été envisagées : une recommandation par profil, ou un
système de likes. **Le like est retenu pour commencer**, mais il faut distinguer
ce qu'il sert :

| | Sauvegarder un bien | Classer par popularité |
|---|---|---|
| Nature | privé, utilitaire | public, comparatif |
| Bénéficiaire | le locataire | la plateforme |
| Valeur au pilote | immédiate | quasi nulle |

Seule la première moitié est construite. Avec huit annonces, un classement par
sauvegardes ne changerait pratiquement rien à ce que voit un visiteur ; en
revanche le vide entre « je regarde » et « je candidate » était réel, et rien ne
le comblait — un visiteur qui hésitait n'avait aucun moyen de retrouver un bien
le lendemain.

Ce que la donnée permet, au-delà du classement :

1. La liste « Mes biens sauvegardés » (fait).
2. Un **signal de prix** pour le propriétaire : beaucoup de sauvegardes et peu
   de candidatures signifient que le bien plaît mais que quelque chose retient.
   Actionnable, contrairement à un compteur de vues (fait).
3. Un indicateur au back-office : un bien à zéro sauvegarde après plusieurs
   jours en ligne est un bien à retravailler avec son propriétaire (fait).
4. Des notifications sur un bien mis de côté — baisse de loyer, bien loué (à
   faire).
5. Le classement des biens en avant (à faire, avec normalisation).
6. La **matière première d'une recommandation par profil** : les sauvegardes
   enregistrent des préférences réelles. Les likes ne s'opposent pas à cette
   piste, ils la préparent.

Le compteur n'est **jamais** montré aux autres locataires : voir README,
principe 15.

## Biens mis en avant — ce qui a été construit le 4 septembre 2026

C'est la **recommandation par profil** qui a été faite, pas le classement par
popularité. Le tri « compatibilité » de la maquette existait dans le code depuis
le premier écran, mais il retombait sur la récence faute d'avoir quoi que ce
soit à confronter : il n'y avait pas encore de dossier locataire.

Il s'appuie sur le barème qui note déjà chaque candidature — budget (40 points),
état du dossier (30), type de contrat accepté (20), garant (10) — extrait en
fonction pure et partagé par les deux usages. Deux barèmes distincts auraient
fini par diverger, et le produit aurait promis à l'écran autre chose que ce
qu'il calcule.

Ce que ça change concrètement, sur les huit annonces du pilote :

| Qui regarde | Trois biens en avant |
|---|---|
| Visiteur anonyme | les trois plus récents |
| CDI 2 240 €, sans garant | le studio le moins cher, puis le seul bien qui n'exige pas de garant |
| Fonction publique 2 610 € | les deux moins chers qui acceptent son contrat |
| Étudiant 780 € | les plus récents — aucun bien n'est dans son budget, et le classement ne fait pas semblant |

Le classement retombe sur la récence dès que les revenus ne sont pas
renseignés, **et l'écran le dit** avec le moyen d'y remédier. Un tri qui ne
classe rien sous une étiquette flatteuse vaudrait moins que pas de tri du tout.

Le classement par sauvegardes reste à faire, et reste subordonné : il
s'auto-entretient (une annonce nouvelle a zéro sauvegarde, donc ne remonte
jamais, donc n'en obtient jamais), là où la compatibilité se calcule dès la
première visite d'une annonce.

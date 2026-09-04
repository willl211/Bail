# Contexte juridique

Ce document existe pour que le développement n'ignore pas ces contraintes, mais **rien ici ne bloque le développement technique** — le juridique avance en parallèle. Il conditionne le lancement commercial réel (premier bail signé pour de vrai, premiers honoraires facturés), pas la construction du produit.

## Statut

- **Cartes professionnelles T, G et S** : portées par un associé ou salarié déjà
  titulaire (décision prise). Arbitrage T seule vs T+G **tranché le 4 septembre
  2026 : ce sera T + G + S.**
  - **T** (transactions) : la mise en location elle-même.
  - **G** (gestion immobilière) : indispensable au circuit des fonds retenu —
    la plateforme encaisse dépôts de garantie et premiers loyers pour le compte
    du propriétaire. Sans elle, il aurait fallu des paiements directs entre
    parties, et refaire le module de paiement.
  - **S** (syndic de copropriété) : hors périmètre du MVP v0. Elle prépare les
    services post-emménagement évoqués dans `product-brief.md`, qui viendront
    après le lancement commercial. **Rien à construire pour elle aujourd'hui**,
    et rien ne doit être ajouté au produit sous prétexte qu'elle existera.
- **Garantie financière et assurance RC Pro** : organisme pas encore identifié.
- **Avocat en droit immobilier** : pas encore trouvé, à faire avant de figer le mandat de location et le modèle de bail définitif.

## Circuit des fonds (impacte le modèle de données)

La plateforme **encaisse les loyers/dépôts pour le compte du propriétaire** (plutôt que des paiements directs entre parties). Cette décision implique le besoin d'une carte G en plus de la carte T — **obtenue** (voir ci-dessus), ce qui lève la seule incertitude qui pesait sur ce circuit. Le module paiement prévoit donc un état « fonds reçus, à reverser au propriétaire », pas seulement un paiement direct : c'est le champ `Payment.fundsStatus`, et le back-office l'affiche dans son onglet « Baux & paiements ».

## Barème d'honoraires et abonnement

Non figés — dépendent du marché, à définir. Le module de facturation doit être **paramétrable** (montants modifiables sans redéploiement) plutôt que codé en dur, puisque ces chiffres vont probablement changer plusieurs fois avant le lancement commercial.

## Transmission du dossier locataire au propriétaire (tranché le 3 septembre 2026)

Quand un locataire candidate, la **synthèse vérifiée** de son dossier est
transmise au propriétaire : identité, revenus nets, situation professionnelle,
taux d'effort, état du garant. Ses **documents** (pièce d'identité, bulletins de
salaire, avis d'imposition) ne le sont jamais — ils restent chez Bail.

Le fondement de ce traitement est l'**exécution du contrat**, pas le
consentement. Candidater *est* la demande de transmettre : sans cette
transmission, le service n'existe pas. La maquette prévoyait une case à cocher
pré-remplie ; elle a été retirée. Une case cochée par défaut donne l'apparence
d'un consentement sans en avoir la valeur — le RGPD exige un acte positif — et
laisserait croire à un choix qui n'en est pas un.

À la place, l'écran de candidature **informe** avant l'envoi : la synthèse est
affichée en entier, telle qu'elle partira, avec la mention que les documents ne
suivent pas. C'est l'obligation de transparence, elle est remplie par l'écran.

À faire valider par l'avocat en même temps que le mandat : la formulation de la
mention, et la durée de conservation d'une candidature refusée.

## Honoraires locataire (écran 7, 3 septembre 2026)

Deux postes, et deux seulement, parce que la loi les plafonne séparément
(décret n° 2014-890) : visite + constitution du dossier + rédaction du bail
d'un côté, état des lieux d'entrée de l'autre. Les montants viennent de
`fee_schedules` ; les **plafonds légaux** sont en dur (8 €/m² et 3 €/m² en zone
non tendue) et affichés à côté de chaque ligne — les mettre en base laisserait
croire qu'on peut les relever. La zone de tension applicable à Metz reste à
confirmer avec l'avocat : si Metz s'avérait en zone tendue, les plafonds
changent.

**Rien n'est encaissé aujourd'hui**, pour trois raisons cumulées : le barème
n'est pas validé juridiquement, aucun prestataire de paiement n'est branché, et
le bail ne peut pas être signé. L'écran énonce les trois.

**Aucun formulaire de carte n'a été construit**, contrairement à la maquette.
Les coordonnées bancaires ne transitent jamais par Bail : le prestataire les
collecte dans son propre cadre, ce qui nous tient hors du périmètre PCI-DSS.
L'API n'ouvre qu'une intention de paiement et renvoie de quoi la confirmer.

Le comparatif ne montre qu'un repère : le **plafond légal**, seule borne
vérifiable. Un repère « agence en ligne » a été écarté faute de donnée qui le
fonde — un chiffre inventé dans un comparatif qui nous met en valeur n'a pas sa
place.

## Contrainte fixe à respecter dès maintenant

Le bail généré par l'app doit être **verrouillé sur un modèle légal type** — la génération assistée par IA vérifie la cohérence des champs (noms, adresse, loyer, durée), elle n'invente pas de clauses ni ne rédige librement. C'est une contrainte de conception à respecter dès la construction du module bail, indépendamment de l'avancement du reste du juridique.

### Comment c'est tenu, au 3 septembre 2026

**Le contrôle est déterministe, pas confié à un modèle de langage.** C'est un
écart assumé à la lettre du brief, au service de son intention : vérifier que
880 € égale 880 €, qu'un dépôt ne dépasse pas un plafond légal ou qu'un nom
correspond à une pièce vérifiée sont des comparaisons. Une comparaison ne se
trompe pas ; un modèle interrogé sur la même question peut se tromper, et
personne ne saurait dire quand. Sur un acte qui engage deux parties pour trois
ans, l'incertitude n'apporte rien. Huit contrôles sont menés : intégrité du
modèle, type de bail, loyer, surface, identités, plafond du dépôt, durée légale,
complétude des champs.

**Rien n'est rédigé.** Le rendu remplace des marqueurs `{{ champ }}` dans un
texte verrouillé, et ne fait rien d'autre. L'écran surligne les valeurs
injectées pour que la promesse se vérifie à l'œil : ce qui est surligné vient
des dossiers, tout le reste vient du modèle. Un marqueur sans valeur reste
visible en clair plutôt que d'être effacé en silence — un acte au texte tronqué
serait plus difficile à repérer.

**Aucun bail ne peut partir en signature aujourd'hui.** Le modèle seedé est un
squelette sans clauses, `isActive = false`, et `lease.generationEnabled` est à
`false`. La chaîne refuse l'envoi et dit pourquoi. Elle a été vérifiée en état
passant sur un modèle temporairement publié, puis remise à l'état bloqué.

**Deux manques à combler avant le premier bail réel** :

- l'**adresse du bailleur** n'est collectée nulle part, alors qu'elle est
  obligatoire (article 3 de la loi de 1989) ; le contrôle la signale ;
- le champ verrouillé `clausesLegalesTexteValide` attend le texte de l'avocat.
  Dans un modèle réellement publié, ces clauses feront partie du corps et le
  marqueur n'existera plus.

## Adresse du bailleur — précision du 4 septembre 2026

L'article 3 de la loi n° 89-462 du 6 juillet 1989 impose que le contrat désigne
le **domicile du bailleur**. Sans lui, le locataire n'a pas d'adresse où
notifier un congé, une réclamation ou une mise en demeure : l'acte est
incomplet.

Elle est demandée dans l'espace propriétaire (« Mon compte »), et non à
l'inscription : trois champs de plus sur l'étape la plus fragile du parcours
feraient abandonner des comptes, pour une donnée qui ne sert qu'au bail.

Les trois éléments — voie, code postal, commune — sont exigés **ensemble**. Une
voie sans commune ne désigne aucun domicile ; l'accepter mettrait sur l'acte une
adresse à laquelle personne ne peut écrire. La règle tient dans une fonction
pure partagée (`isAddressComplete`), et son absence est signalée par le contrôle
de cohérence du bail comme n'importe quel autre champ manquant.

Ce que ça bloque, et ce que ça ne bloque pas : **la signature du bail**, oui —
un acte sans domicile du bailleur n'a pas à partir. La mise en ligne d'une
annonce, non : le bailleur n'y est pas encore engagé, et refuser une annonce
pour une donnée qui ne servira qu'au bail serait disproportionné. L'espace
propriétaire affiche un rappel plutôt qu'un barrage.

Le code postal est vérifié sur sa forme (cinq chiffres), pas sur son existence :
tenir un référentiel à jour serait une charge, et refuser à tort un code valide
empêcherait quelqu'un de signer son bail.

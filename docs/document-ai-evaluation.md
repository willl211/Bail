# Étape 5 — Évaluation de l’IA documentaire

## État au 16 septembre 2026

Le banc d’essai est développé et testé localement. **La campagne réelle OpenAI et
l’activation restent à faire : aucune clé API n’est configurée dans cet environnement.**
Les tests logiciels ne mesurent pas la qualité d’un modèle. L’admin conserve la
décision finale ; une extraction correcte ne prouve jamais l’authenticité d’une pièce.

Le programme emploie directement le connecteur, le prompt et le schéma du site.
Il ne lit ni la base ni les documents des utilisateurs. Les réponses attendues
servent uniquement à la notation locale et ne sont pas envoyées au modèle.

## Corpus initial

Les 14 documents sont intégralement fictifs et portent la mention SPECIMEN FICTIF.
Leur génération, les valeurs attendues et leurs empreintes sont versionnées dans
`backend/evaluation/corpus.ts`. Les fichiers produits restent dans `.cache`, hors Git.

| Cas | Ce qu’il vérifie |
|---|---|
| Bulletin standard | Identité, employeur, période et trois nets distincts |
| Prime | Variation du montant mensuel |
| Absence | Période partielle, sans reconstitution d’un mois complet |
| Net avant impôt absent | Abstention au lieu d’inventer une valeur |
| Cumul annuel et montant net social | Distinction avec les nets mensuels demandés |
| Instructions malveillantes dans le document | Ignorer les instructions présentes dans la pièce |
| Deux bulletins sur deux pages | Avertissement et lecture du premier bulletin |
| Scan PNG | Lecture d’une image |
| Image JPEG coupée | Champs non visibles laissés absents |
| Quittance | Reconnaître un document qui n’est pas un bulletin |
| Montants nuls — validation | Distinguer zéro d’une valeur absente |
| Accents et colonnes inversées — validation | Noms accentués et disposition différente |
| Photo inclinée — validation | Rotation et compression JPEG |
| Image illisible — validation | Abstention et avertissement |

Les dix premiers cas servent au développement, les quatre derniers à la validation.
Ces mises en page simplifiées constituent une première base de contrôle, pas un
échantillon représentatif de tous les logiciels de paie. Avant un usage étendu,
ajouter des bulletins fictifs plus réalistes, variés et indépendants des ajustements
du prompt. Les images peuvent dépendre des polices de la machine : conserver les
fichiers et les empreintes du rapport pour comparer deux campagnes.

## Génération sans frais

Depuis la racine du dépôt :

```powershell
npm.cmd run eval:documents --workspace backend
```

Sans `--live`, aucun appel OpenAI n’est effectué, même si une clé est configurée.
Le dossier horodaté `backend/.cache/document-evaluation/…-offline` contient les
PDF/images, `manifest.json`, `report.json` et `report.md`. Le rapport indique
explicitement l’absence de mesure et `DO_NOT_ACTIVATE`.

## Campagne réelle, uniquement sur les pièces fictives

Renseigner `OPENAI_API_KEY` dans `backend/.env`, sans la publier dans Git ni dans une
conversation. `DOCUMENT_ANALYSIS_MODEL` doit correspondre au modèle du fichier de
tarifs choisi. Le programme peut fonctionner avec le traitement du site désactivé :
garder `DOCUMENT_ANALYSIS_DRIVER=disabled` et `DOCUMENT_ANALYSIS_WORKER_ENABLED=false`
pendant cette évaluation indépendante.

```powershell
npm.cmd run eval:documents --workspace backend -- --live --repetitions 2 --max-calls 28 --budget-usd 1 --pricing evaluation/pricing.example.json
```

Les chemins d’options sont relatifs au dossier `backend`. Le barème d’exemple est
daté et utilise `gpt-5-mini` ; ce choix est un point de départ, pas une conclusion
sur le meilleur modèle. Vérifier sa disponibilité et ses tarifs avant la campagne.
Pour un autre modèle, fournir un autre fichier de tarifs avec les identifiants
facturés autorisés. Un barème de plus de 30 jours est refusé en mode réel.

Le programme limite les appels, n’effectue pas de relance cachée et réserve avant
chaque requête un coût maximal estimé à partir du contexte déclaré et de 4 000
tokens de sortie. Cette estimation dépend du barème : ce n’est pas un plafond
contractuel de facture. Configurer également les limites du projet fournisseur.

Le calcul utilise les tokens effectivement rapportés, distingue les entrées mises
en cache et inclut les tokens de raisonnement dans la sortie sans les compter deux
fois. Une réponse invalide peut coûter et reste comptabilisée. En cas de modèle,
tarification ou usage inconnus, aucun appel supplémentaire n’est lancé. Un rapport
est enregistré avant le premier appel puis après chaque résultat.

Code de sortie : `0` pour une génération hors ligne réussie ou une campagne éligible
à la revue humaine ; `1` pour une erreur de configuration/exécution ; `2` pour une
campagne réelle incomplète ou insuffisante.

## Mesures et décision

Le rapport expose classification, valeurs exactes, valeurs inventées ou manquantes,
citations présentes sur la bonne page, avertissements, durée et coût calculable.
Les taux de champs portent sur les réponses analysables ; les erreurs fournisseur
sont recensées séparément et empêchent une recommandation positive.

La recommandation `HUMAN_REVIEW_REQUIRED` exige :

- Deux répétitions au minimum de tout le corpus, validation comprise.
- Aucun appel en erreur ni coût inconnu.
- Classification correcte et absence de valeur inventée.
- 100 % d’exactitude sur les trois montants demandés.
- Au moins 95 % d’exactitude des champs et des citations.
- Tous les avertissements attendus présents.

La vérification des citations est textuelle, pas une expertise du document. Une
paraphrase OCR peut être signalée ; une citation textuellement correcte doit encore
être relue dans son contexte. Les petites tailles d’échantillon limitent fortement
la portée des pourcentages. Ne jamais assimiler ce résultat à une certification.

Examiner les échecs sur les cas de développement, ajuster si nécessaire le prompt
et sa version, puis mesurer à nouveau, avec des cas de validation indépendants.
Même un rapport positif n’active aucune configuration automatiquement.

## Activation et retour arrière

Après une vraie campagne et la revue humaine, activer d’abord en environnement de
test avec des documents fictifs, selon la [configuration du connecteur](payslip-analysis.md).
Vérifier le dépôt, la file de traitement, la relance admin et une décision humaine
prise pendant une analyse. L’analyse ne doit modifier ni le revenu déclaré ni la
validation de la pièce. La configuration d’activation est `DOCUMENT_ANALYSIS_DRIVER=openai`
avec `DOCUMENT_ANALYSIS_WORKER_ENABLED=true`, une clé et un modèle configurés.

Avant les données réelles, vérifier les modalités de traitement et l’information
des utilisateurs. `store: false` ne doit pas être présenté comme une garantie
générale d’absence de conservation par le fournisseur.

Retour arrière : désactiver le worker et remettre le driver à `disabled`, puis
redémarrer le backend. Les décisions restent dans le circuit humain.

## Autres justificatifs — périmètre défini, non activé

| Type | Lecture envisagée | Limite et décision humaine |
|---|---|---|
| Identité, passeport, identité du garant | Nom et validité explicitement indiqués, comparaison avec le déclaratif | Pas de reconnaissance biométrique ni de certification d’authenticité |
| Contrat de travail | Parties, employeur, type, dates, salaire explicitement qualifié brut/net | Clauses et situations particulières revues par l’admin |
| Avis d’imposition | Titulaires, année fiscale et revenus explicitement nommés | Distinguer foyer et individu ; aucune division automatique par douze |
| Justificatif de domicile | Nature de la pièce, titulaire, adresse, date | Hébergement et attestations traités séparément par un humain |
| Carte étudiante | Nom, établissement, année universitaire | Pas d’inférence sur des revenus ou la solvabilité |
| Revenus du garant | Identifier d’abord bulletin ou avis fiscal, puis appliquer le schéma adapté | Comparer au garant, pas au locataire |
| Autre pièce | Orientation vers le contrôle humain | Aucun score ni validation automatique |

Chaque type nécessite son propre schéma, prompt, corpus et seuils avant activation.
Ne pas extraire de numéro de sécurité sociale, IBAN ou numéro d’identité sans besoin
spécifique établi. Le dispositif existant pour les autres pièces n’est pas remplacé
par cette étape.

## Vérifications locales

Le 16 septembre : **37 tests réussis dans 3 suites** (évaluation, connecteur et
contrôles documentaires), TypeScript et lint backend réussis. Les tests de campagne
utilisent des réponses simulées : ce sont des contrôles logiciels, pas une mesure
OpenAI. La génération hors ligne est également vérifiée.

Références : [bonnes pratiques d’évaluation](https://developers.openai.com/api/docs/guides/evaluation-best-practices),
[modèle et tarifs de référence](https://developers.openai.com/api/docs/models/gpt-5-mini),
[usage dans la réponse API](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create),
[traitement des données](https://developers.openai.com/api/docs/guides/your-data).

# Signature des baux — étape 4

Développement du 15 septembre 2026. L'intégration utilise exclusivement DocuSign
sandbox. Les tests locaux remplacent les échanges REST par des réponses simulées ;
ils ne valident ni le compte externe, ni sa configuration Connect, ni la valeur
juridique du modèle. Le poste reste en `SIGNATURE_DRIVER=mock`.

## Comportement

- Le propriétaire envoie depuis l'écran du bail. La publication du modèle,
  l'activation de la génération, les champs et les diagnostics sont contrôlés.
  Aucun texte juridique n'est inventé et aucun modèle de démonstration n'est activé.
- Le texte verrouillé est mis en PDF avec une page de signatures. Les diagnostics
  obligatoires vérifiés sont joints depuis le stockage privé (PDF, JPEG ou PNG).
  L'ensemble est limité à 12 Mo avant encodage. Le PDF et les annexes sont figés en
  base avec les deux destinataires, l'empreinte SHA-256 et un identifiant de tentative.
- Chaque reprise utilise le même `transactionId`. Avant création, l'API recherche
  une enveloppe déjà associée. Une réponse perdue peut être récupérée et une
  notification anticipée peut rattacher l'enveloppe à la tentative persistée.
  Après six jours, une tentative sans réponse est bloquée pour rapprochement manuel :
  DocuSign ne conserve les identifiants de transaction que sept jours.
- DocuSign envoie ses liens de signature par e-mail. La plateforme ne les stocke pas
  et ne les réexpédie pas dans ses notifications.
- Connect est authentifié avec HMAC-SHA256 sur le corps HTTP brut. La notification
  déclenche une lecture de l'enveloppe et de ses destinataires dans l'API : leurs
  noms et e-mails doivent correspondre à l'instantané. Le statut signé nécessite
  les deux signatures individuelles et la finalisation de l'enveloppe. Les doublons
  n'ajoutent pas de notification et un événement tardif ne rouvre pas un état final.
- Le propriétaire, le locataire et les agents peuvent télécharger le PDF combiné
  contenant le bail, les annexes et le certificat de réalisation. L'API vérifie les
  droits, exige un bail finalisé et sert les octets du prestataire sans réécriture.
  Le simulateur refuse explicitement de fabriquer une preuve de signature.

## Branchement sandbox à faire

1. Créer un compte développeur DocuSign et une application avec une paire de clés RSA.
   Relever l'Integration Key, l'User ID du compte technique et l'Account ID.
2. Accorder le consentement JWT à cette application pour `signature impersonation`,
   avec une Redirect URI enregistrée. Conserver la clé privée côté serveur.
3. Renseigner dans l'environnement backend :

   ```dotenv
   SIGNATURE_DRIVER=docusign
   DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi
   DOCUSIGN_INTEGRATION_KEY=
   DOCUSIGN_USER_ID=
   DOCUSIGN_ACCOUNT_ID=
   DOCUSIGN_PRIVATE_KEY=
   DOCUSIGN_HMAC_SECRET=
   ```

   Le PEM accepte les retours à la ligne encodés `\n`. Les URLs de production sont
   refusées. Ne placer aucun de ces secrets dans les variables `NEXT_PUBLIC_*`.
4. Dans Connect, créer une configuration JSON SIM avec HMAC actif, orientée vers
   l'URL HTTPS publique `/api/v1/leases/signature/webhook`. Activer les événements
   `envelope-sent`, `envelope-delivered`, `recipient-completed`, `envelope-completed`,
   `envelope-declined`, `envelope-voided`, et les accusés de réception/reprises.
   Utiliser la clé correspondant à `X-Docusign-Signature-1` et inclure l'Account ID,
   l'Envelope ID, le Recipient ID et `generatedDateTime`. Ne pas joindre les PDF
   en base64 aux notifications : l'application les récupère par l'API protégée.
5. Redémarrer le backend et effectuer la recette suivante avec des adresses et
   documents de test. Les modèles réels restent bloqués jusqu'à validation juridique.

## Recette externe obligatoire

- Envoyer un bail fictif et ses diagnostics ; contrôler toutes les pages, les accents,
  les montants, la lisibilité des annexes et l'emplacement des deux signatures.
- Signer avec chacune des deux adresses de test. Après une signature, contrôler
  l'état partiel ; après finalisation, actualiser et télécharger le PDF avec certificat.
- Rejouer une notification, tester l'arrivée de `completed` avant les événements
  individuels, le refus d'une partie, l'annulation et l'expiration côté prestataire.
- Couper la réponse de création, reprendre la tentative et vérifier qu'une seule
  enveloppe existe chez DocuSign. Tester aussi un double clic simultané.
- Vérifier les refus sur corps HMAC altéré, signataire remplacé et compte extérieur.
- Vérifier qu'aucun honoraire ne devient payable avant finalisation confirmée.

## Limites et travail restant avant production

- Compte, consentement JWT, Connect HTTPS/HMAC et recette sandbox restent à réaliser.
- Le PDF signé est récupéré à la demande auprès de DocuSign : l'archivage durable
  indépendant du prestataire et sa politique de rétention restent à définir/implémenter.
  Les instantanés privés en base devront être couverts par cette politique.
- Le rendu PDF utilise Helvetica : les caractères non encodables sont refusés
  explicitement, sans suppression silencieuse. Étendre les polices si les modèles
  validés ou les identités l'exigent. Les diagnostics WebP doivent être redéposés
  dans un format accepté, sans conversion destructive d'un justificatif.
- L'annulation est disponible dans le contrat technique du driver, mais il n'existe
  pas encore d'action d'annulation/recréation ni de rapprochement manuel dans l'admin.
  Les tentatives anciennes restent bloquées ; les notifications Connect sont le
  mécanisme de synchronisation. Une procédure d'exploitation est nécessaire si
  toutes les reprises de notification échouent.
- Fournir et publier les modèles validés juridiquement, les mentions et annexes
  contractuelles supplémentaires retenues par le juriste. Le flux actuel joint les
  diagnostics obligatoires connus de l'application ; il ne prétend pas constituer
  à lui seul un dossier contractuel exhaustif.
- Le choix du niveau de signature et la recette production restent séparés du test
technique ; aucun passage automatique en production n'est prévu.

## Vérifications locales réalisées

Le 15 septembre : 289 tests d'intégration backend (21 suites), 169 tests unitaires
backend et 192 tests frontend réussis. Après la distinction des droits de paiement
des agents, les 12 tests ciblés de l'écran du bail passent également. Contrôles de
types et de style réussis ; compilations backend et frontend vérifiées. Les vues
signées et en finalisation ont été inspectées à 1440, 390 et 320 px, sans débordement
ni erreur JavaScript. Le PDF fictif préparé par le parcours a été rendu et inspecté.
Ces vérifications utilisent un prestataire simulé et ne remplacent pas la recette
DocuSign sandbox décrite ci-dessus.

## Références techniques

- [JWT pour un compte technique](https://www.docusign.com/blog/developers/the-trenches-authenticate-without-user-interaction-system-user).
- [Récupérer une enveloppe par transactionId](https://www.docusign.com/blog/developers/common-api-tasks-use-transactionid-to-find-the-envelope-you-created).
- [Vérification HMAC de Connect](https://www.docusign.com/blog/developers/manually-authenticating-hmac-signatures-docusign-connect-webhook-configurations).
- [API enveloppes et téléchargement combiné avec certificat](https://docusign.github.io/docusign-esign-node-client/module-api_EnvelopesApi.html).

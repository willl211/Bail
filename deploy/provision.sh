#!/usr/bin/env bash
#
# Prépare une instance Debian/Ubuntu vierge à recevoir Bail.
#
#   scp deploy/provision.sh ubuntu@ADRESSE-IP:/tmp/
#   ssh ubuntu@ADRESSE-IP 'sudo bash /tmp/provision.sh'
#
# `ubuntu` et non `root` : c'est le compte livré par OVH sur une image Ubuntu,
# et la connexion SSH en root y est fermée. Sur un hébergeur qui l'ouvrirait,
# les deux commandes marchent aussi en root, sans `sudo`.
#
# À exécuter **une seule fois**, sur une machine neuve. Il est cependant
# idempotent : le relancer ne casse rien, il constate ce qui est déjà en place.
#
# Ce qu'il fait, et rien d'autre :
#   - installe Docker depuis le dépôt officiel ;
#   - crée un utilisateur non privilégié pour faire tourner l'application ;
#   - ouvre le pare-feu sur SSH seul ;
#   - ajoute de la mémoire d'échange si la machine en manque pour compiler ;
#   - active les mises à jour de sécurité automatiques.
#
# Ce qu'il ne fait pas : installer Bail, écrire des secrets, toucher au DNS.
# Ces étapes demandent des valeurs qui n'ont pas à traverser un script.

set -euo pipefail

UTILISATEUR="${BAIL_USER:-bail}"

echo "==> Vérifications"

if [[ $EUID -ne 0 ]]; then
  echo "Ce script doit être lancé en root (ou via sudo)." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Distribution non reconnue : ce script vise Debian et Ubuntu." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Paquets de base"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg ufw unattended-upgrades

echo "==> Docker"
# Le dépôt officiel plutôt que celui de la distribution : Debian et Ubuntu
# livrent une version âgée, parfois sans le greffon Compose v2 dont le
# manifeste a besoin.
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  source /etc/os-release
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
else
  echo "    déjà installé : $(docker --version)"
fi

systemctl enable --now docker

echo "==> Journaux de Docker"
# Filet global : le manifeste borne déjà les journaux service par service, mais
# un conteneur lancé à la main hors manifeste remplirait le disque sans cette
# valeur par défaut. Un disque plein, c'est une base qui n'écrit plus.
if [[ ! -f /etc/docker/daemon.json ]]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
JSON
  systemctl restart docker
else
  echo "    /etc/docker/daemon.json existe déjà, laissé tel quel"
fi

echo "==> Utilisateur applicatif : ${UTILISATEUR}"
# L'application ne tourne pas en root. Le compte reçoit l'accès à Docker, ce
# qui équivaut de fait à root sur la machine — c'est assumé et connu, mais ça
# évite au moins de travailler en root au quotidien.
if ! id -u "$UTILISATEUR" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$UTILISATEUR"
  # La clé SSH est recopiée : sans elle, le nouveau compte serait inaccessible.
  #
  # Elle est cherchée à deux endroits, et l'ordre compte. Chez OVH, un VPS
  # Ubuntu n'ouvre pas de session root : la clé déposée à la commande atterrit
  # chez l'utilisateur `ubuntu`, et le script s'exécute par `sudo` depuis ce
  # compte. Ne regarder que `/root` laisserait le compte applicatif sans aucune
  # clé — verrouillé dès sa création.
  SOURCE_CLES=""
  if [[ -n "${SUDO_USER:-}" && -f "/home/${SUDO_USER}/.ssh/authorized_keys" ]]; then
    SOURCE_CLES="/home/${SUDO_USER}/.ssh/authorized_keys"
  elif [[ -f /root/.ssh/authorized_keys ]]; then
    SOURCE_CLES="/root/.ssh/authorized_keys"
  fi

  if [[ -n "$SOURCE_CLES" ]]; then
    install -d -m 700 -o "$UTILISATEUR" -g "$UTILISATEUR" "/home/${UTILISATEUR}/.ssh"
    install -m 600 -o "$UTILISATEUR" -g "$UTILISATEUR" \
      "$SOURCE_CLES" "/home/${UTILISATEUR}/.ssh/authorized_keys"
    echo "    clé SSH reprise de ${SOURCE_CLES}"
  else
    echo "    !! AUCUNE CLÉ SSH TROUVÉE."
    echo
    echo "       Cela arrive quand aucune clé n'a été choisie à la commande :"
    echo "       l'hébergeur envoie alors un mot de passe temporaire, et la"
    echo "       machine n'a aucune clé à recopier."
    echo
    echo "       Le compte ${UTILISATEUR} vient d'être créé sans clé : il est"
    echo "       pour l'instant inutilisable en SSH. Depuis votre poste :"
    echo
    echo "         type \$env:USERPROFILE\\.ssh\\id_ed25519.pub | ssh ${SUDO_USER:-root}@<adresse> \\"
    echo "           \"sudo install -d -m700 -o ${UTILISATEUR} -g ${UTILISATEUR} /home/${UTILISATEUR}/.ssh &&\\"
    echo "            sudo tee -a /home/${UTILISATEUR}/.ssh/authorized_keys >/dev/null &&\\"
    echo "            sudo chown ${UTILISATEUR}: /home/${UTILISATEUR}/.ssh/authorized_keys &&\\"
    echo "            sudo chmod 600 /home/${UTILISATEUR}/.ssh/authorized_keys\""
    echo
    echo "       Puis relancez ce script : il reprendra là où il en est."
  fi
else
  echo "    déjà présent"
fi
usermod -aG docker "$UTILISATEUR"

echo "==> Authentification SSH"
# Le mot de passe est coupé **uniquement** si une clé est en place et
# fonctionne. Une machine exposée avec authentification par mot de passe est
# scannée et attaquée dans les minutes qui suivent sa mise en ligne ; celle-ci
# portera les identifiants de la base et du stockage objet.
#
# La condition n'est pas de la prudence de façade : couper le mot de passe sans
# clé installée fermerait la machine à tout le monde. Et même dans ce cas, la
# console KVM de l'espace client reste une porte de retour — mais mieux vaut ne
# pas avoir à l'utiliser.
#
# Un fichier à part dans `sshd_config.d`, numéroté haut : les images cloud y
# déposent leurs propres réglages, et modifier `sshd_config` se ferait écraser
# par un fichier lu après lui.
if [[ -s "/home/${UTILISATEUR}/.ssh/authorized_keys" ]]; then
  cat > /etc/ssh/sshd_config.d/99-bail.conf <<'CONF'
# Posé par deploy/provision.sh. Pour revenir en arrière : supprimer ce fichier
# et relancer `systemctl reload ssh`.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  # Vérifié avant d'être appliqué : une configuration invalide empêcherait le
  # service de redémarrer, et donc toute reconnexion.
  if sshd -t 2>/dev/null; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
    echo "    mot de passe désactivé, clé seule (annuler : rm /etc/ssh/sshd_config.d/99-bail.conf)"
  else
    rm -f /etc/ssh/sshd_config.d/99-bail.conf
    echo "    !! configuration SSH refusée par sshd -t, rien n'a été changé"
  fi
else
  echo "    laissée telle quelle : pas de clé installée, la couper fermerait la machine"
fi

echo "==> Pare-feu"
# SSH **avant** d'activer : l'ordre inverse coupe la session en cours et rend
# la machine inaccessible.
#
# Rien d'autre n'est ouvert, et c'est volontaire. Le mode recette publie ses
# ports sur 127.0.0.1 et s'atteint par un tunnel SSH ; le jour où le proxy
# tournera, il faudra ouvrir 80 et 443 :
#
#     ufw allow 80/tcp && ufw allow 443/tcp
#
# À noter : Docker écrit ses propres règles et court-circuite UFW. Un port
# publié sur toutes les interfaces resterait joignable malgré un refus du
# pare-feu — c'est pourquoi la protection du mode recette repose sur la
# liaison à 127.0.0.1, pas sur ces règles.
ufw allow OpenSSH
ufw --force enable
ufw status verbose | sed 's/^/    /'

echo "==> Mises à jour de sécurité automatiques"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Mémoire d'échange"
# La compilation de l'image du front est le moment le plus gourmand du
# déploiement, et une machine à 4 Go peut s'y faire tuer par le noyau. Deux Go
# d'échange suffisent à l'absorber ; ils ne servent à rien le reste du temps.
#
# Volontairement **après** le pare-feu et non avant : c'est un confort, pas une
# nécessité, et certains systèmes de fichiers refusent `fallocate`. Un échec ici
# ne doit pas priver la machine de son pare-feu — d'où le repli sur `dd`, puis
# un simple avertissement si les deux échouent.
MEM_MO=$(( $(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 ))
if (( MEM_MO < 8000 )) && ! swapon --show | grep -q .; then
  # Toute la chaîne est dans la condition du `if` : `set -e` n'y interrompt pas
  # le script, et un hébergeur qui interdit l'échange laisse donc la machine
  # utilisable au lieu d'un script arrêté aux trois quarts.
  if { fallocate -l 2G /swapfile 2>/dev/null ||
       dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none 2>/dev/null; } &&
     chmod 600 /swapfile &&
     mkswap -q /swapfile &&
     swapon /swapfile; then
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "    2 Go ajoutés (${MEM_MO} Mo de mémoire vive)"
  else
    rm -f /swapfile
    echo "    !! échec : la machine n'aura pas d'échange (${MEM_MO} Mo de vive)."
    echo "       Si le noyau tue la compilation de l'image du front, construisez-la"
    echo "       ailleurs et poussez-la, plutôt que sur cette machine."
  fi
else
  echo "    inutile ou déjà en place"
fi

echo
echo "==> Terminé."
echo
echo "Suite :"
echo "  1. se reconnecter en ${UTILISATEUR} (le groupe docker n'est actif qu'à"
echo "     l'ouverture de session suivante) :"
echo "         ssh ${UTILISATEUR}@<adresse>"
echo "  2. cloner le dépôt, puis suivre docs/deployment.md"
echo
echo "Vérification rapide, en ${UTILISATEUR} : docker run --rm hello-world"

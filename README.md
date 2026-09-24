# DachGuard

Bot Discord + dashboard web pour ouvrir et fermer les salons du serveur de classe,
à la main ou selon l'horaire. Pensé pour un serveur qui accueille **plusieurs classes**
(3TIN et 4TIN) avec leurs rôles et leurs salons respectifs.

En ligne : `https://studio-dach.site/lock/` (Basic Auth) — en local : `http://localhost:3000/lock`.

## Ce que ça fait

- **Classes** — une classe = un nom, des rôles et des salons. Tout le reste s'appuie dessus :
  un clic ferme ou rouvre 3TIN sans toucher à 4TIN. Détection automatique des rôles et salons
  à partir de leurs noms (`3TIN`, `4TTI`, `(3ème)`…).
- **Verrouillage à la carte** — plusieurs salons × plusieurs rôles en une fois, en lecture seule
  ou en masquant complètement le salon (tickets), avec minuteur facultatif (« ferme 50 min »).
- **Planning hebdomadaire** — plusieurs jours par créneau, créneaux qui passent minuit
  (22h → 7h), vue calendrier de la semaine.
- **Rien ne se perd au redémarrage** — token, classes, créneaux, verrous en cours et
  permissions d'origine sont sur le disque. Au réveil, le bot recalcule ce qui devrait être
  fermé et rattrape ce qu'il a manqué.
- **Retour à l'état initial** — avant chaque verrou, les permissions du rôle sur le salon sont
  photographiées ; la réouverture les restitue exactement (et non « autorisé pour tout le monde »).
- **Pas de stickers** — quand la garde est active, tout message porteur d'un sticker est effacé
  dans la seconde, et son auteur reçoit un rappel qui disparaît ensuite. On peut épargner des
  salons (ou des catégories entières), des rôles, la modération et les autres bots.
- **Commandes Discord** — `/lock`, `/unlock`, `/statut`, réservées à ceux qui peuvent gérer les salons.
- **Depuis le téléphone** — MacroDroid (ou Tasker) ferme et rouvre une classe d'un appui sur une tuile
  des réglages rapides, un widget ou un tag NFC, avec une clé propre au téléphone. Voir plus bas.
- **Diagnostic** — « Vérifier les fuites » liste les rôles qui garderaient la parole malgré le
  verrou (autorisation explicite sur le salon, ou rôle administrateur).
- **Journal** — qui a fermé quoi, quand, et à quel titre (manuel, planning, minuteur, commande).

## Installation

```bash
npm install
node index.js          # PORT=3000 BASE_PATH=/lock par défaut
```

Au premier lancement, collez le token du bot dans **Réglages → Connexion**. Il est enregistré
dans `data/state.json` (fichier en 0600, ignoré par git) et réutilisé aux démarrages suivants.
Variante : la variable d'environnement `DISCORD_TOKEN` a priorité.

### Côté Discord

Permissions nécessaires : `Gérer les rôles`, `Gérer les salons`, `Voir les salons`, `Envoyer des messages`,
et `Gérer les messages` pour la garde anti-stickers (sans elle, le bot voit les stickers mais ne peut pas
les effacer — le dashboard le signale).
Le rôle du bot doit être **au-dessus** des rôles qu'il doit verrouiller (le dashboard signale
ceux qui sont hors de portée). Pour les commandes slash, invitez-le avec le scope
`applications.commands` :

```
https://discord.com/api/oauth2/authorize?client_id=TON_CLIENT_ID&permissions=268462096&scope=bot%20applications.commands
```

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/store.js` | état persistant (`data/state.json`), écriture atomique, journal |
| `src/permissions.js` | traduction « verrouiller » → overwrites Discord, et l'inverse |
| `src/bot.js` | connexion, verrouillage/déverrouillage, diagnostic, commandes slash |
| `src/groups.js` | les classes et leur détection automatique |
| `src/stickers.js` | la garde anti-stickers : qui a le droit, et ce qu'on efface |
| `src/telephone.js` | l'accès téléphone : clé, freinage des mauvaises clés, réponses en une ligne |
| `src/scheduler.js` | créneaux hebdomadaires + réconciliation |
| `src/server.js` | API HTTP et service du dashboard |
| `public/` | dashboard (sans framework) |

### Comment le planning s'applique

Pas de `cron` : toutes les 30 secondes, le bot compare **l'état voulu** (les créneaux actifs
qui couvrent l'instant présent, fuseau `Europe/Brussels`) à **l'état réel** et corrige la
différence. Un redémarrage à 23h pendant un créneau 22h → 7h re-verrouille immédiatement ;
un créneau supprimé pendant qu'il était actif rouvre tout seul.

### Comment les stickers sont bloqués

Discord n'a pas de permission « interdire les stickers » : la seule qui existe,
`Utiliser des stickers externes`, ne couvre que ceux venant d'autres serveurs. DachGuard applique
donc la règle à la réception : à chaque message, s'il porte un sticker et que rien ne l'épargne,
le message part. L'ordre des exceptions est fixe :

1. la garde est-elle activée ? sinon on ne touche à rien ;
2. le salon — ou sa catégorie, ou le salon parent d'un fil — est-il dans la liste des exceptions ?
3. l'auteur peut-il « Gérer les messages » (et la modération est-elle tolérée) ?
4. porte-t-il un des rôles autorisés ?

Sinon : suppression, une ligne au journal (qui, où, quel sticker) et un rappel à l'auteur, au plus
un toutes les 30 secondes par personne et par salon pour ne pas ajouter du bruit au bruit.
Aucun intent privilégié n'est nécessaire : les stickers voyagent hors du « message content ».

Le complément se fait côté Discord : retirez `Utiliser des stickers externes` au rôle `@everyone`
dans les paramètres du serveur, et les stickers des autres serveurs n'arriveront même plus jusqu'au
bot. Le dashboard rappelle de le faire tant que c'est en attente.

## Piloter depuis le téléphone (MacroDroid)

Le dashboard est derrière le mot de passe du portail. Le téléphone, lui, passe par
`/lock/hook/…`, que nginx laisse passer sans ce mot de passe : c'est **une clé propre au
téléphone** qui garde la porte. Elle ne permet que les six actions ci-dessous, n'ouvre pas le
dashboard, et se change ou se désactive depuis **Réglages → Téléphone (MacroDroid)**, qui
affiche aussi les adresses prêtes à copier.

| Méthode | Adresse | Effet |
|---|---|---|
| GET  | `/lock/hook/statut` | « 3TIN fermée · 4TIN ouverte — prochaine réouverture 15:40 (Cours 3TIN) » |
| GET  | `/lock/hook/classes` | les noms de classes connus |
| POST | `/lock/hook/fermer/<classe>` | ferme la classe (`?minutes=50` : rouvre seule après 50 min ; `&message=…`) |
| POST | `/lock/hook/ouvrir/<classe>` | rouvre la classe (et met le créneau planifié en cours en pause) |
| POST | `/lock/hook/tout-fermer` | ferme tout sauf les salons protégés |
| POST | `/lock/hook/tout-ouvrir` | rouvre tout ce que DachGuard a fermé |

- La clé va dans l'en-tête **`X-DachGuard-Cle`** (ou `Authorization: Bearer …`). `?cle=` marche
  aussi, mais finit alors dans les journaux nginx.
- `<classe>` se tape comme on veut : `3tin`, `3TIN`, `3 TIN`.
- La réponse est **une ligne de texte** faite pour une notification ; `?format=json` pour du JSON.
- Les actions n'acceptent que **POST** : l'aperçu d'un lien collé dans Discord ou une messagerie
  fait un GET, et ne doit jamais fermer une classe.
- Dix mauvaises clés en 15 minutes depuis la même adresse : cette adresse est refusée 15 minutes.
- Au journal, ces actions apparaissent avec la source `téléphone`.

### Recette MacroDroid

Une macro par geste. Exemple : une tuile des réglages rapides « 3TIN » qui ferme quand on
l'allume et rouvre quand on l'éteint.

1. **Déclencheur** → *Appareil / Réglages rapides* (*Quick Settings Tile*) → une tuile libre,
   libellé `3TIN`, type **bascule** ; cocher « activée » **et** « désactivée ».
2. **Action** → *Si… (If)* → condition *Déclencheur déclenché* = la tuile, état « activée » :
   - *Connectivité → Requête HTTP* : méthode **POST**, URL `https://studio-dach.site/lock/hook/fermer/3tin`,
     onglet *En-têtes* : `X-DachGuard-Cle` = la clé copiée du dashboard ;
     « Enregistrer la réponse dans » une variable texte locale `reponse`.
   - *Sinon* : la même requête vers `…/hook/ouvrir/3tin`.
3. **Action** → *Notification* (ou *Toast*) : texte `{lv=reponse}`.

Les libellés exacts varient d'une version de MacroDroid à l'autre ; plus simple encore, deux
macros séparées (tuile activée → fermer, tuile désactivée → ouvrir) font le même travail.

Autres déclencheurs utiles : un **widget** sur l'écran d'accueil (*Raccourci de lancement*) pour
« Tout fermer », un **tag NFC** collé sur le bureau de la classe, ou le **statut** en
*Requête HTTP GET* pour savoir d'un coup d'œil ce qui est fermé. En cas d'échec, MacroDroid
reçoit le code HTTP (401 : clé refusée, 404 : classe inconnue, 400 : bot hors ligne ou
Discord a refusé) et la réponse explique pourquoi en une ligne.

## Tests

```bash
node test/demo.js        # dashboard rempli, sans Discord (port 3999)
node test/render-check.js  # passe toutes les vues sur un état réel, sans navigateur
node test/sticker-check.js # la garde anti-stickers : décision, suppression, journal, anti-spam
node test/telephone-check.js # l'accès MacroDroid : clé, POST obligatoire, freinage, réponses
```

## Déploiement (VPS studio-dach.site)

```bash
ssh songon@217.154.117.102
cd ~/DachGuard/BotDiscord-Lock && git pull && npm install --omit=dev
pm2 restart dachguard && pm2 logs dachguard --lines 30
```

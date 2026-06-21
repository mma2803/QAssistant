# Comment fonctionne le DOM-replay (QAssistant)

Ce document explique, de bout en bout, ce qu'est le « DOM-replay » dans QAssistant :
comment une session de test est **enregistrée** dans l'extension Chrome, **stockée**,
puis **rejouée** dans le dashboard. Il s'adresse à quelqu'un qui découvre le projet.

> En une phrase : le DOM-replay **n'est pas une vidéo**. C'est l'enregistrement de la
> **structure de la page (le DOM) et de ses changements dans le temps**, sous forme de
> données JSON, que l'on **reconstruit** ensuite pour rejouer la session.

---

## 1. L'idée de base : enregistrer le DOM, pas l'écran

Trois façons d'« enregistrer » une session web :

| Approche | Ce qui est stocké | Poids | Inspectable ? |
|----------|-------------------|-------|---------------|
| Vidéo d'écran | des pixels (frames) | lourd (Mo) | non |
| Screenshots | des images figées | moyen | non |
| **DOM-replay (rrweb)** | **le HTML initial + les mutations** | **léger (Ko, JSON)** | **oui** |

QAssistant utilise la **3ᵉ** approche, via la librairie open-source **rrweb**
(« record and replay the web »).

Au lieu de filmer, rrweb fait deux choses :

1. **Un snapshot initial** : il sérialise tout l'arbre DOM de la page au démarrage
   (HTML, CSS, état des champs…) en un objet JSON.
2. **Un flux de mutations** : ensuite, il observe en continu **tout ce qui change** et
   l'enregistre comme une suite d'**événements horodatés** :
   - nœud ajouté / supprimé / modifié (via `MutationObserver`)
   - mouvements de souris, clics, scroll, saisies clavier
   - navigations

Résultat : une **liste d'événements JSON** du type « voici la page au départ, puis à
t=1230 ms la souris est ici, à t=1500 ms ce bouton a été cliqué, à t=1600 ms ce texte est
apparu… ».

---

## 2. Le parcours complet

```
   NAVIGATEUR (page testée)                 BACKEND / STOCKAGE              DASHBOARD
 ┌───────────────────────────┐          ┌──────────────────────┐     ┌─────────────────┐
 │ content/recorder.ts        │          │  API NestJS          │     │ SessionDetail   │
 │  rrweb.record()            │          │                      │     │  Page           │
 │   → events JSON            │          │  GET /upload-urls    │     │                 │
 │                            │  batch   │  POST /artifacts     │     │ GET .../replay  │
 │ background/recording.ts    │ ───────► │                      │     │  → events[]     │
 │  bufferise, découpe en     │  upload  │  stocke en GCS :     │     │                 │
 │  "dom_chunks", gzip        │ ───────► │   dom/0.json.gz      │ ──► │ rrweb-player    │
 │                            │          │   dom/1.json.gz      │     │  reconstruit le │
 │ (+ screenshots JPEG)       │          │   shots/0.webp ...   │     │  DOM + rejoue   │
 └───────────────────────────┘          └──────────────────────┘     └─────────────────┘
```

### Étape A — Capture (extension Chrome)

- **`apps/extension/src/content/recorder.ts`** s'injecte dans la page testée et lance
  `rrweb.record(...)`. C'est lui qui produit le flux d'événements.
- **`apps/extension/src/background/recording.ts`** (le service worker) reçoit ces
  événements, les **met en mémoire tampon**, puis les **découpe en lots** (« chunks ») :
  - toutes les ~5 secondes, **ou**
  - dès que ~200 événements sont accumulés.
- Chaque lot est **sérialisé en JSON**, **compressé en gzip**, et uploadé.

### Étape B — Stockage

- Chaque lot devient un **artefact de type `dom_chunk`**, numéroté (`seq` 0, 1, 2…).
- Il est rangé dans GCS (en local : l'émulateur fake-gcs) sous un chemin
  cloisonné par tenant / projet / session :
  ```
  <tenantId>/<projectId>/<sessionId>/dom/0.json.gz
  <tenantId>/<projectId>/<sessionId>/dom/1.json.gz
  ```
- Une ligne est aussi écrite en base (table `artifacts`) avec le `gcs_path`, la taille,
  la compression, etc.

> L'upload se fait via une **URL signée write-only** : l'extension peut **écrire** son
> propre fichier, mais ne peut ni lire, ni lister, ni supprimer. L'identité (tenant/uid)
> est **estampillée côté serveur**, jamais affirmée par le client.

### Étape C — Lecture / replay (dashboard)

- La page **`apps/dashboard/src/pages/SessionDetailPage.tsx`** appelle
  `GET /dashboard/sessions/{id}/replay`.
- Côté API, **`getReplay`** télécharge tous les `dom_chunk`, les **dézippe**, parse le
  JSON, et **reconcatène tous les événements dans l'ordre** (seq 0, puis 1, puis 2…) en un
  seul tableau `events[]`.
- Ce tableau est renvoyé au composant **`ReplayPlayer.tsx`**, qui charge **`rrweb-player`**
  et l'instancie avec les événements.
- `rrweb-player` **reconstruit une vraie page HTML dans une iframe** à partir du snapshot,
  puis **rejoue les mutations** chronologiquement. On obtient un lecteur avec
  play / pause / avance, où la page « revit ».

> ⚠️ `rrweb-player` a besoin de sa **feuille de style** (`rrweb-player/dist/style.css`).
> Sans elle, le lecteur s'affiche cassé (contrôleur figé, iframe mal dimensionnée).
> Cet import est requis dans `ReplayPlayer.tsx`.

---

## 3. Et les screenshots, alors ?

Les screenshots sont un artefact **séparé et complémentaire**, **pas** la source du replay.

- Toutes les ~10 secondes (si activé), l'extension prend une **photo JPEG du viewport**
  (`chrome.tabs.captureVisibleTab`).
- Stockées comme artefacts `screenshot` (`shots/0.webp`, `shots/1.webp`…).
- Rôle : **preuve visuelle figée** — ce que l'œil voyait réellement, y compris les choses
  que le DOM-replay ne capture pas toujours fidèlement (images, `<canvas>`, contenu
  cross-origin).
- Elles sont affichées en vignettes dans le dashboard, **indépendamment** du player.

| | DOM-replay (rrweb) | Screenshots |
|---|---|---|
| Nature | événements JSON (snapshot + mutations) | images JPEG du viewport |
| Rejoué comme | DOM reconstruit dans une iframe | vignettes statiques |
| Rôle | rejouer l'interaction fidèlement | preuve visuelle ponctuelle |
| Poids | très léger (Ko) | plus lourd (~100 Ko/image) |

---

## 4. Confidentialité : le masquage

Avant l'upload, rrweb **masque les données sensibles** (exigence de la spec) :

- les champs **mot de passe** et champs de type token/secret (`maskAllInputs`),
- les **sélecteurs configurés par projet** (texte masqué / sous-arbres bloqués).

Le masquage est appliqué **à la capture**, donc la valeur sensible **n'est jamais uploadée**.
⚠️ Les **screenshots**, eux, sont des images entières : ils sont traités comme sensibles et
**ne sont pas considérés comme entièrement caviardés**.

---

## 5. Les flags (Alt+Shift+F) — un complément, pas une obligation

Pendant l'enregistrement, le testeur peut appuyer sur **`Alt+Shift+F`** (sur Mac :
**`Option ⌥ + Shift ⇧ + F`**) pour **marquer** un élément ou un état comme important.

- Le code (`recorder.ts`) résout alors un **vrai sélecteur CSS** de l'élément ciblé et
  l'enregistre comme un **flag** (table `flags`), avec l'instant (offset) dans le replay.
- Ces flags apparaissent dans la section **« Flags & selections »** du dashboard.

> Important : les **événements rrweb** identifient les éléments par des **IDs de nœuds
> internes**, pas par des sélecteurs CSS lisibles. Les vrais sélecteurs CSS ne sont produits
> **que** par le hotkey de flag. C'est pour ça que, sans flag, la section
> « Flags & selections » est vide — **ce n'est pas un bug**.

Les flags ne sont **pas requis** pour générer un test : ils servent d'**indices de qualité**
à la génération (« mets une assertion sur cet état »).

---

## 6. À quoi ça sert ensuite : la génération de test

Le flux `dom_chunk` (les actions réelles) est la **matière première** de la génération
Playwright. Le worker de codegen assemble un prompt à partir de :

1. les **DOM chunks** (source principale — clics, saisies, navigation),
2. la **description / le ticket Jira** de la session (l'intention),
3. le **contexte screenshots** (nombre/noms, pour inférer des assertions avant/après),
4. les **flags** s'il y en a (indices d'assertions ciblées — optionnel).

C'est précisément parce que rrweb sait **quel élément** a été manipulé (et pas juste « un
clic à tel pixel ») qu'on peut générer un test automatisé — chose **impossible** à partir
d'une simple vidéo.

---

## 7. Fichiers clés (pour aller lire le code)

| Rôle | Fichier |
|------|---------|
| Capture rrweb (in-page) | `apps/extension/src/content/recorder.ts` |
| Bufferisation / chunk / gzip / upload | `apps/extension/src/background/recording.ts` |
| Upload (URL signée + register) | `apps/extension/src/background/upload.ts` |
| Lecture + concat des chunks (API) | `apps/api/src/dashboard/dashboard.service.ts` (`getReplay`) |
| Décompression gzip | `apps/api/src/storage/gcs-reader.service.ts` (`decodeArtifactText`) |
| Player rrweb (UI) | `apps/dashboard/src/components/ReplayPlayer.tsx` |
| Page de session | `apps/dashboard/src/pages/SessionDetailPage.tsx` |
| Spec de référence | `openspec/changes/qassistant-mvp/specs/session-capture/spec.md` |

---

## Glossaire

- **rrweb** : librairie qui enregistre (record) et rejoue (replay) le web sous forme de
  DOM + mutations, au lieu d'une vidéo.
- **Snapshot** : photographie JSON complète du DOM à un instant donné (le point de départ).
- **Mutation / event** : un changement enregistré (nœud, attribut, souris, clic…) horodaté.
- **dom_chunk** : un lot d'événements rrweb, gzippé, uploadé comme un artefact numéroté.
- **Flag** : marqueur posé par le testeur (Alt+Shift+F) sur un sélecteur/état important.

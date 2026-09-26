# rafaat-website

Jouw project voor de AI-training. Wat hier staat, wordt live gezet op
**https://rafaat.sdai.nl**.

> In deze map staat een **statische kopie (mirror) van ralebate.nl**: alle
> pagina's, afbeeldingen, CSS, JS en PDF's zijn één keer opgehaald (snapshot
> 26-09-2026) en staan nu als gewone bestanden in deze repo. Er is dus geen
> PHP, MySQL of WordPress meer nodig om de site te tonen.

## Wat staat waar

| Pad | Inhoud |
| --- | --- |
| `index.html` | homepagina (kopie van ralebate.nl) |
| `diensten/` `over-ons/` `contact/` `nieuws/` `algemene-voorwaarden/` `privacybeleid/` | de overige pagina's, elk met een eigen `index.html` |
| `wp-content/` | afbeeldingen, thema-CSS/JS, fonts en de PDF's |
| `server.js` | statische webserver op `0.0.0.0:3000` |
| `starter.html` | de oude startpagina van de workshop (bewaard) |
| `tools/mirror-site.js` | haalt ralebate.nl opnieuw op (mirror maken) |
| `tools/check-links.js` | controleert of elke pagina + asset HTTP 200 geeft |

## Hoe het werkt
- Alles in deze map draait in jouw container onder `/workspace/rafaat-website`.
- Er draait automatisch een dev-server op **poort 3000** (zie `server.js`), die
  nginx doorzet naar `https://rafaat.sdai.nl`.
- De **browser-IDE** staat op `https://ide-rafaat.sdai.nl`; de site is daar te
  bekijken via `https://ide-rafaat.sdai.nl/proxy/3000/`.

### Waarom relatieve links?
De pagina's verwijzen niet naar `/wp-content/...` maar naar `wp-content/...`
(of `../wp-content/...` vanaf een subpagina). Daardoor werkt de site op beide
manieren identiek:

- op `https://rafaat.sdai.nl/` (de site staat in de root), en
- via de IDE-proxy `https://ide-rafaat.sdai.nl/proxy/3000/`.

Met root-relatieve links zou de proxy de assets op
`https://ide-rafaat.sdai.nl/wp-content/...` zoeken: de HTML laadt dan wel, maar
de site verschijnt zonder opmaak en afbeeldingen. Daarom zet
`tools/mirror-site.js` na het ophalen alles om naar relatieve paden.

De server doet daarnaast twee dingen die de mirror nodig heeft:

- een map-URL zonder slash (`/diensten`) krijgt een **301** naar `/diensten/`,
  zodat de relatieve links in die pagina blijven kloppen;
- een `/proxy/<poort>`-prefix in het pad wordt genegeerd, zodat de site ook
  werkt wanneer een proxy dat prefix (onverwacht) niet zou strippen.

## Starten / stoppen van de server
De container start de server automatisch. Wil je hem zelf draaien:

```bash
npm run dev          # = node server.js  (poort 3000)
```

Gebruik je een eigen framework (Vite, Next, Express, ...)? Zorg dat het op
`0.0.0.0:3000` luistert, en zet zo nodig de auto-server uit met
`sudo supervisorctl stop appserver`.

Staat de site niet online, kijk dan eerst of poort 3000 vrij is en of er geen
oud `node server.js`-proces blijft hangen:

```bash
sudo supervisorctl status appserver
sudo pkill -x -f 'node server.js'      # oude/verweesde processen
sudo supervisorctl start appserver
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```


## Mirror verversen
De site is een momentopname. Opnieuw ophalen kan altijd:

```bash
npm run mirror           # veilig: schrijft naar ./tmp-mirror, overschrijft niks
npm run mirror:refresh   # ververst de site in de root (gebruikt --force)
node tools/mirror-site.js /tmp/ralebate-site    # of naar een eigen map
```

De crawler:

- gebruikt een echte browser user-agent en houdt cookies bij;
- wacht 1,2 seconde per verzoek en probeert het opnieuw met oplopende backoff als
  Imunify360 (botbeveiliging van de host) een "Even geduld..."-pagina terugstuurt;
- slaat dynamische WordPress-endpoints over (`wp-json/`, `feed/`, `xmlrpc.php`);
- haalt ook alle CSS, JS, afbeeldingen, fonts en PDF's op en zet alle URL's om
  naar relatieve paden.

## Controleren of alles klopt
```bash
node tools/check-links.js                                    # lokaal, root
node tools/check-links.js https://rafaat.sdai.nl             # publiek
node tools/check-links.js http://127.0.0.1:3000 /proxy/3000  # via de IDE-proxy
```

De checker loopt alle pagina's na en test alles wat de browser echt laadt:
`src`/`srcset`/`poster`, stylesheets, favicons, `url(...)` in CSS (ook in de
CSS-bestanden zelf) en de interne navigatielinks. Exit-code 1 als er iets
ontbreekt, dus bruikbaar als automatische check.

Laatste run: **12/12 pagina's, 364 links/assets - alles HTTP 200**, zowel op de
root als via `/proxy/3000/`.

## Je werk opslaan (git push)
De container heeft schrijfrechten op deze repo via een deploy-key:

```bash
git add -A
git commit -m "beschrijf je wijziging"
git push
```

Repo: `git@github.com:sayfjawad/rafaat-website.git`

## Bekende beperkingen
- Het contactformulier (Gravity Forms) is zichtbaar, maar kan geen berichten
  versturen: dat vereist WordPress/PHP op de server.
- `wp-json/`, `xmlrpc.php`, `feed/` en oEmbed-links staan nog als onzichtbare
  `<link>`-tags in de HTML (WordPress-standaard). De browser laadt die nooit;
  ze geven daarom lokaal 404 en de checker slaat ze over als "plumbing".
- De afbeelding `wp-content/uploads/2021/04/xtreme_trail_logo.jpg` bestaat niet
  meer op ralebate.nl zelf; hij staat alleen nog in de schema.org-metadata en
  wordt nergens getoond.
- De teksten en afbeeldingen zijn eigendom van Ralebate. De kopie bevat nog de
  originele meta-tags en oEmbed-links naar ralebate.nl.

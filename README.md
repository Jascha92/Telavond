# Telavond

Het teltafelspel van afdeling Verkiezingen Den Haag. Sorteer 100 stembiljetten zo snel en foutloos mogelijk en zet je score op het gedeelde scorebord.

## Wat zit erin

| Bestand | Wat het doet |
|---|---|
| `public/index.html` | Het spel zelf (alles in één bestand) |
| `server.js` | Kleine server: levert het spel en bewaart scores in Upstash |
| `package.json` | Vertelt Render hoe de server start |
| `render.yaml` | Instellingen voor Render (optioneel, zie stap 3) |
| `.env.example` | Voorbeeld van de twee geheime sleutels |

De server gebruikt geen extra pakketten, alleen Node.js 20 of hoger.

## Je hebt drie diensten nodig

1. **GitHub**: hier staan de bestanden.
2. **Upstash**: de database voor het scorebord.
3. **Render**: draait de server en geeft het spel een webadres.

Alle drie hebben een gratis versie die voor dit spel genoeg is.

---

## Stap 1. Bestanden op GitHub zetten

1. Log in op [github.com](https://github.com) en klik op **New repository**.
2. Noem de repository `telavond`. Kies **Private** als alleen jij de code mag zien.
3. Klik op **Create repository**.
4. Klik op **uploading an existing file** en sleep alle bestanden en de map `public` uit deze zip erin.
   Let op: `.gitignore` en `.env.example` beginnen met een punt en zijn op je computer soms verborgen. Ze zijn handig, maar niet verplicht.
5. Klik op **Commit changes**.

## Stap 2. Database maken in Upstash

1. Log in op [upstash.com](https://upstash.com) en open **Redis**.
2. Klik op **Create database**. Geef hem een naam, bijvoorbeeld `telavond`, en kies als regio **Frankfurt (eu-central-1)**. Die regio ligt het dichtst bij Den Haag.
3. Open de database en zoek het blok **REST API**. Daar staan twee waarden die je in stap 3 nodig hebt:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

Het token is geheim. Zet het nooit in GitHub, alleen in Render.

## Stap 3. Server starten op Render

1. Log in op [render.com](https://render.com) met je GitHub-account.
2. Klik op **New** en kies **Web Service**. Kies de repository `telavond`.
3. Controleer de instellingen:
   - **Runtime**: Node
   - **Build Command**: mag leeg blijven, of `echo geen build nodig`
   - **Start Command**: `node server.js`
   - **Instance type**: Free
4. Voeg bij **Environment Variables** twee variabelen toe en plak de waarden uit Upstash:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
5. Klik op **Create Web Service**. Na een paar minuten staat er een adres als `https://telavond.onrender.com`. Dat is het spel.

Je kunt ook **New → Blueprint** kiezen. Render leest dan `render.yaml` en vraagt alleen nog de twee sleutels.

## Stap 4. Testen

1. Open het adres van Render.
2. Onder het scorebord moet staan: *Scores van de hele afdeling. Ververst elke 30 seconden.*
   Staat er dat het scorebord niet bereikbaar is? Controleer dan de twee sleutels in Render.
3. Speel een ronde, vul je naam in en klik op **Op het scorebord**.

## Goed om te weten

- **Opstarten duurt even.** De gratis versie van Render valt na een tijdje zonder bezoekers in slaap. De eerste bezoeker moet dan ongeveer een minuut wachten. Daarna is het spel snel.
- **Wijzigingen.** Pas je een bestand aan op GitHub, dan zet Render de nieuwe versie automatisch online.
- **Namen en pincodes.** De eerste die een naam gebruikt, claimt hem op zijn apparaat. Iemand anders kan die naam dan niet gebruiken. Met een pincode koppel je dezelfde naam aan een ander apparaat. Pincodes worden versleuteld opgeslagen. Per naam kun je maximaal 5 keer per uur een pincode proberen.
- **Valsspelen.** De server weigert scores die volgens de spelregels niet kunnen, en beperkt het aantal inzendingen. Iemand met technische kennis kan nog steeds een nepscore insturen die net binnen de regels valt. Voor een afdelingsspel is dat meestal prima.

## Scorebord beheren

Alle gegevens staan in Upstash onder sleutels die beginnen met `telavond:`.

- **Hele scorebord opnieuw beginnen**, bijvoorbeeld voor een nieuwe competitie: zet in Render een extra variabele `SCORE_PREFIX` met een nieuwe waarde, zoals `telavond2026`. De oude scores blijven bewaard, maar het bord begint leeg. Ook namen en pincodes beginnen dan opnieuw.
- **Eén speler verwijderen**: open in Upstash de **CLI** en typ (met de naam in kleine letters):
  ```
  ZREM telavond:bord jascha
  DEL telavond:speler:jascha telavond:tokens:jascha
  ```

## Lokaal testen (optioneel)

Met Node.js 20 of hoger op je computer:

```
cp .env.example .env      # vul hier je Upstash-sleutels in
node --env-file=.env server.js
```

Open daarna `http://localhost:3000`.

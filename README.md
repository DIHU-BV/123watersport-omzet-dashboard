# 123watersport · Omzetdashboard (frontend)

Statisch dashboard op GitHub Pages dat de `dash_*`-tabellen uit Supabase leest,
achter Supabase-login. Data wordt elk uur gevuld door
[123watersport-omzet-ingest](https://github.com/DIHU-BV/123watersport-omzet-ingest).

## Bekijken
GitHub Pages-URL → inloggen met een Supabase-gebruiker (jij + klant).

## Inloggen mogelijk maken
Voeg gebruikers toe in **Supabase → Authentication → Users → Add user**
(e-mail + wachtwoord, "Auto Confirm" aan). Alleen ingelogde gebruikers kunnen door
RLS de data lezen.

## Techniek
- `index.html` + `styles.css` + `app.js` (vanilla JS), `config.js` (publieke Supabase-URL + publishable key)
- supabase-js + Chart.js via CDN
- Bedragen incl./excl. btw (schakelaar); periodevergelijking t.o.v. de vorige periode

Pagina's: **Overzicht** (live). Volgende: omzet-per-product, retouren, conversie.

# REKNIR - Utvecklingsplan

## Nuläge (v1.3.2 - Februari 2026)
✅ Komplett bokföringssystem med dubbel bokföring
✅ Kundfakturor med PDF och betalningshantering
✅ Leverantörsfakturor med bilagor och betalning
✅ Personalutlägg med godkännandeflöde och kvittouppladdning
✅ Verifikationer med automatisk numrering och sökfiltrering
✅ Momsrapportering med XML-export till Skatteverket
✅ SIE4 import/export med förhandsvisning och validering
✅ BAS-kontoplan (BAS 2024, 45 konton)
✅ Kund- och leverantörsregister
✅ Konteringsmallar med formelstöd
✅ Räkenskapsår-stöd med kontoplan per år
✅ Automatisk kopiering av kontoplan mellan år
✅ Företagsinställningar med logotypuppladdning
✅ Automatisk VAT-nummer beräkning
✅ Standardkonton
✅ Balansräkning och resultaträkning
✅ Månatlig statistik och rapporter
✅ Backup och restore med GUI (kalendervy, uppladdning, server-restore)
✅ PDF-export av rapporter (Balansrapport, Resultaträkning, Huvudbok — momsrapport saknas)
✅ Sorterbara kolumner i listor
✅ Strukturerad betalningsinformation på företag och faktura
✅ Arkiverade PDF:er för bokföringscompliance
✅ Hantering av olänkade bilagor

---

## Fas 1: Förbättringar & Stabilisering (v1.1-1.2)
**Prioritet: HÖG | Komplexitet: LÅG-MEDEL**

### 1.1 UX & Användbarhet
- [x] **Dashboard med verkliga siffror**
  - Dagens/månadens intäkter och kostnader
  - Förfallna fakturor
  - Väntande utlägg för godkännande
  - Likvida medel (banksaldo)
  - Graf över kassaflöde

- [ ] **Förbättrad sökning & filtrering**
  - Globalsök över fakturor, verifikationer, kunder
  - Sparade filter/vyer
  - [x] Sortering på alla kolumner
  - [x] Sökfiltrering på verifikationer
  - Datumintervall-väljare

- [ ] **Batch-operationer**
  - Markera flera fakturor som betalda samtidigt
  - Exportera flera fakturor till PDF
  - Bulk-import av leverantörsfakturor

- [ ] **Notifikationer**
  - Förfallna fakturor
  - Utlägg som väntar på godkännande
  - Lågt saldo på bankkonto
  - Kommande momsredovisning

### 1.2 Rapporter & Export
- [x] **Momsrapportering**
  - Automatisk periodindelning (månad/kvartal)
  - Jämförelse mellan perioder
  - XML-export till Skatteverket
- [ ] **PDF-export av rapporter**
  - [ ] Momsrapport som PDF
  - [x] Balansräkning som PDF
  - [x] Resultaträkning som PDF
  - [x] Huvudbok som PDF
- [ ] **Excel-export**
  - Verifikationslista
  - Fakturalistor
  - Kontoutdrag

### 1.3 Data & Säkerhet
- [x] **Backup-funktionalitet** (v1.3.0)
  - [x] Automatiska backuper (cron-baserat) *(enbart databas, ej bilagor)*
  - [x] Manuell backup/restore via GUI
  - [x] Export av hela databasen (databas + bilagor i .tar.gz)
  - [x] Kalenderbaserad backup-väljare
  - [x] Restore från server eller filuppladdning
  - [x] CLI-stöd (`backup create`, `backup list`, `backup restore`)
  - [x] Metadata per backup (version, schema, storlek)

- [ ] **Audit log** (v1.3.1)
  - Logga alla ändringar
  - Visa ändringshistorik per post
  - Spårbarhet för revision

- [ ] **Datavalidering** (v1.3.2)
  - Varningar för obalanserade verifikationer
  - Kontroll av momssatser
  - Validering vid periodavslut

---

## Fas 2: Automatisering & Integration (v2.0)
**Prioritet: MEDEL | Komplexitet: MEDEL-HÖG**

### 2.1 Bankintegration
- [ ] **Öppna Banken API**
  - Hämta banktransaktioner automatiskt
  - Automatisk avstämning
  - Föreslå bokföring baserat på historik

- [ ] **Bank reconciliation**
  - Matcha banktransaktioner mot fakturor
  - Hantera differenser
  - Rapportera avstämningsresultat

### 2.2 E-fakturahantering
- [ ] **Peppol/BIS Billing**
  - Skicka e-fakturor
  - Ta emot e-fakturor
  - Automatisk parsning och registrering

- [ ] **E-postutskick**
  - Skicka fakturor via e-post
  - Påminnelser för förfallna fakturor
  - Betalningsbekräftelser

### 2.3 OCR & AI
- [x] **AI-assistent med Ollama** (v1.3.4)
  - Chattbaserad bokföringsassistent med lokal LLM
  - Läser och analyserar bokföringsdata via verktyg
  - Föreslår konteringar och öppnar formulär med förpopulerade fält
  - Admin-konfigurerbar (modellval, systemprompt)

- [ ] **OCR för leverantörsfakturor**
  - Automatisk läsning av fakturor
  - Extrahera belopp, datum, leverantör
  - Föreslå kontering

- [ ] **Smart konteringsförslag**
  - ML-baserade förslag baserat på historik
  - Lär av tidigare bokföringar
  - Autokomplettering av beskrivningar

### 2.4 Återkommande transaktioner
- [ ] **Återkommande fakturor**
  - Skapa fakturaserier (månad/år)
  - Automatisk generering och utskick
  - Hantera prenumerationer

- [ ] **Återkommande utgifter**
  - Registrera fasta kostnader (hyra, el, etc.)
  - Automatisk bokföring
  - Påminnelser om förfallodatum

---

## Fas 3: Företagstillväxt (v3.0)
**Prioritet: MEDEL | Komplexitet: MEDEL**

### 3.1 Användarhantering
- [x] **Multi-user support** (implementerat)
  - Flera användare per företag
  - Roller och behörigheter (Admin, Regular User)
  - JWT-baserad autentisering

- [ ] **Godkännandeflöden**
  - Konfiguerbara godkännandesteg
  - Attestering av utlägg och fakturor
  - E-postsignering av dokument

### 3.2 Multi-company
- [x] **Flera företag per användare** (implementerat)
  - Växla mellan företag
  - [ ] Konsoliderade rapporter
  - [ ] Delade kunder/leverantörer

### 3.3 Projektredovisning
- [ ] **Projekt & uppdrag**
  - Skapa projekt med budget
  - Koppla kostnader och intäkter till projekt
  - Projektrapporter och lönsamhet

- [ ] **Tidrapportering**
  - Registrera arbetad tid
  - Fakturera baserat på tid
  - Integrering med projekt

### 3.4 Lager & Produkter
- [ ] **Produktregister**
  - Artikelnummer och beskrivningar
  - Priser och momssatser
  - Snabbare fakturering

- [ ] **Lagerhantering (basic)**
  - In- och utleveranser
  - Lagersaldo
  - Lagervärdering

---

## Fas 4: Avancerade funktioner (v4.0)
**Prioritet: LÅG | Komplexitet: HÖG**

### 4.1 Lön & Personal
- [ ] **Grundläggande lönehantering**
  - Löneutbetalningar
  - Skatteavdrag
  - Arbetsgivaravgifter

- [ ] **Semesterhantering**
  - Semesterlöneskuld
  - Periodisering
  - Upplupen semesterlön

### 4.2 Avancerad ekonomistyrning
- [ ] **Budgetering**
  - Skapa budgetar per konto/projekt
  - Jämförelse budget vs utfall
  - Prognoser

- [ ] **Kassaflödesanalys**
  - Framtida kassaflöde baserat på fakturor
  - Likviditetsprognos
  - Betalningsplanering

- [ ] **Nyckeltal & KPI:er**
  - Soliditet, likviditet, lönsamhet
  - Rörelseresultat
  - Anpassningsbara dashboards

### 4.3 Årsbokslut
- [ ] **Periodavslut**
  - Låsa perioder
  - Avstämningsrutiner
  - Period-checklistor

- [ ] **Årsbokslut**
  - Avskrivningar
  - Periodiseringar
  - Bokslutsdispositioner

- [ ] **Skattedeklarationer**
  - Förenklad eller fullständig deklaration
  - K-rapporter
  - Export till Skatteverket

### 4.4 Analyser & BI
- [ ] **Avancerad analys**
  - Drill-down i rapporter
  - Jämförelse mellan år
  - Trendanalyser

- [ ] **Grafiska rapporter**
  - Interaktiva dashboards
  - Exporterbara grafer
  - Custom reports

---

## Tekniska förbättringar

### Performance
- [ ] **Caching (Redis)**
  - Cachea rapporter och aggregeringar
  - Session-hantering
  - Rate limiting

- [ ] **Databasoptimering**
  - Index på ofta använda fält
  - Query-optimering
  - Partitionering av stora tabeller

- [ ] **Frontend-optimering**
  - Lazy loading av komponenter
  - Virtual scrolling för stora listor
  - Service worker för offline-funktionalitet

### Arkitektur
- [ ] **Bakgrundsjobb (Celery)**
  - PDF-generering i bakgrunden
  - Schemalagda jobb (rapporter, påminnelser)
  - E-postutskick

- [ ] **Message queue**
  - Asynkron kommunikation
  - Event-driven arkitektur
  - Skalbarhet

- [ ] **Microservices (optional)**
  - Separera PDF-generering
  - Separera rapportgenerering
  - API gateway

### DevOps
- [ ] **CI/CD pipeline**
  - Automatiska tester
  - Automated deployment
  - Docker orchestration (Kubernetes?)

- [ ] **Monitoring**
  - Application monitoring (Sentry)
  - Performance monitoring (New Relic/DataDog)
  - Uptime monitoring

- [ ] **Logging**
  - Centraliserad loggning (ELK stack)
  - Structured logging
  - Log rotation

---

## Prioriterad Roadmap

### Q1 2025 - Stabilisering (v1.1)
1. ~~Dashboard med verkliga siffror~~ ✅
2. Förbättrad sökning & filtrering (delvis ✅ - sortering + verifikationssök)
3. PDF-export av rapporter (delvis ✅ - Balansrapport, Resultaträkning, Huvudbok; kvar: Momsrapport)
4. ~~Backup-funktionalitet~~ ✅ (v1.3.0)
5. Audit log (v1.3.1)

### Q2 2025 - Användbarhet (v1.2)
1. Batch-operationer
2. Notifikationer
3. Excel-export
4. Datavalidering (v1.3.2)
5. Förbättrad momsrapportering

### Q3 2025 - Automatisering (v2.0)
1. Återkommande fakturor
2. E-postutskick av fakturor
3. OCR för leverantörsfakturor
4. Bankintegration (basic)

### Q4 2025 - Tillväxt (v2.5)
1. ~~Multi-user support~~ ✅ (implementerat)
2. ~~Roller och behörigheter~~ ✅ (implementerat)
3. Projekt & uppdrag
4. Produktregister

### 2026 - Expansion
- ~~Multi-company~~ ✅ (implementerat)
- Lön & personal (basic)
- Budgetering
- Årsbokslut

---

## Quick Wins (Kan göras nästan omedelbart)

### UI/UX Förbättringar
- [ ] Loading states för alla API-anrop
- [ ] Bättre felmeddelanden
- [x] Confirmation dialogs innan radering
- [ ] Tooltips för alla ikoner
- [ ] Keyboard shortcuts (Ctrl+S för spara, etc.)

### Datakvalitet
- [ ] Default värden för nya poster
- [ ] Validera OCR-nummer
- [ ] Validera organisationsnummer
- [x] Automatisk beräkning av förfallodatum

### Rapporter
- [ ] Årsöversikt på dashboard
- [ ] Kundreskontra
- [ ] Leverantörsreskontra
- [x] Huvudbok per konto (inkl. PDF-export)

### Export
- [ ] CSV-export för alla listor
- [ ] Fakturabilaga som ZIP
- [ ] Kvittosamling som PDF

---

## Teknisk skuld att adressera

1. **Tester**
   - [x] Enhetstester för services (grundläggande)
   - [x] Integrationstester för API (grundläggande)
   - [ ] E2E-tester för kritiska flöden

2. **Dokumentation**
   - API-dokumentation (Swagger/OpenAPI)
   - Utvecklardokumentation
   - Användarmanual

3. **Säkerhet**
   - Input sanitization
   - SQL injection prevention (redan ORM, men dubbelkolla)
   - XSS prevention
   - CSRF protection
   - Rate limiting

4. **Error handling**
   - Bättre error boundaries i React
   - Retry logic för API-anrop
   - Graceful degradation

---

## Community & Open Source

### Om projektet ska bli open source:
- [ ] Välj licens (GPL, MIT, Apache?)
- [ ] Contributing guidelines
- [ ] Code of conduct
- [ ] Issue templates
- [ ] PR templates
- [ ] Changelog

### Community building:
- [ ] Discord/Slack server
- [ ] Forum för support
- [ ] Wiki för dokumentation
- [ ] Video tutorials

---

## Konkurrensanalys

### Jämför med:
- **Fortnox** - Marknadsledare i Sverige
- **Visma eEkonomi** - Stor aktör
- **Bokio** - Gratis alternativ
- **Billy** - Dansk, modern UI

### Reknirs konkurrensfördel:
- ✅ Open source (potential)
- ✅ Gratis self-hosted
- ✅ Fullständig kontroll över data
- ✅ Anpassningsbar
- ✅ Modern tech stack
- ✅ API-first design

### Vad som saknas jämfört med konkurrenter:
- ❌ Bankintegration
- ❌ E-faktura
- ❌ Mobil app
- ❌ Lön
- ❌ Skatteverket-integration
- ❌ Support & onboarding

---

**Senast uppdaterad:** 2026-04-14
**Version:** 1.3.4
**Status:** Funktionell MVP - lämplig för testning och utveckling, ej för produktionsdrift ännu

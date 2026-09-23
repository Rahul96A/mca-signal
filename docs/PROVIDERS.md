# Data providers — verification notes & integration contract

Verified on **2026-09-23**. Re-verify before production use: government portals and vendor APIs change.

## 1. Official Government Data — data.gov.in (OGD Platform India)

| Item | Finding |
|---|---|
| Endpoint | `GET https://api.data.gov.in/resource/4dbe5667-7b6b-41d7-82af-211562424d9a?api-key=KEY&format=json` |
| Dataset | "Registrars of Companies (RoC)-wise Company Master Data", Ministry of Corporate Affairs |
| Size / freshness | 3,674,314 records; `updated_date` 2026-07-22 (returned in every response → stored as `published_at`) |
| Coverage | Companies **and LLPs** (LLPs carry their LLPIN in the `CIN` field, e.g. `ABD-0345`) |
| Fields | `CIN, CompanyName, CompanyROCcode, CompanyCategory, CompanySubCategory, CompanyClass, AuthorizedCapital, PaidupCapital, CompanyRegistrationdate_date, Registered_Office_Address, Listingstatus, CompanyStatus, CompanyStateCode, CompanyIndian/Foreign Company, nic_code, CompanyIndustrialClassification` |
| Filtering | `filters[FIELD]=value` — **exact, case-sensitive** keyword match only (`filters[CompanyName]=COVEY RETAIL` → 0 results; full upper-case name → 1). No fuzzy / prefix search. |
| Paging | `offset` + `limit` |
| Auth | API key required (free registration at data.gov.in). Passed as a query parameter → used server-side only; redacted from logs. |
| Licence | Government Open Data License – India (GODL) |
| **Not included** | Directors, filings, financial statements, charges, name history |

An older catalog resource (`ec58dab7-…`, "Company Master Data", upper-case field names, `active: "0"`, last updated 2024-12-13) is inactive and not used.

**Consequences for the design**

* Fuzzy name search cannot be delegated to the API → the worker bulk-imports master data (`npm run worker`, resumable per state via `DATA_GOV_SYNC_STATES`) and search runs locally with `pg_trgm`.
* On-demand lookups by CIN/LLPIN use the exact `filters[CIN]` filter.
* Sections the dataset lacks are reported as **"not available from configured sources"** — never shown as empty or estimated.

## 2. MCA portal (mca.gov.in, MCA21 V3)

* There is **no public, documented MCA API**. Master data and "View Public Documents" are web pages protected by CAPTCHA and/or login, and document access is fee-based.
* This application does **not** scrape MCA pages or bypass CAPTCHA, authentication, rate limits or paid-document restrictions.
* Filing rows link to the official *View Public Documents* service for users to obtain documents themselves.

## 3. Third-Party Aggregated Data (licensed)

Directors, filings, financial statements and charges are only available programmatically from licensed aggregators (e.g. Sandbox.co.in, Probe42, Signzy, Surepass, IndiaInfoCorp — each with its own commercial terms). Verify that your licence permits storage and display before enabling one.

### 3a. `MCA_PROVIDER=attestr` (recommended for directors & charges)

Verified from Attestr's public docs (docs.attestr.com) on 2026-09-23.

* `POST https://api.attestr.com/api/v2/public/corpx/business/master`, header `Authorization: Basic <token>`,
  body `{"reg": "<CIN|LLPIN>", "charges": true, "efilings": true}`.
  Returns master data, `directorsAndSignatories` (DIN, names, `appointmentDate`, `designation`, `roleCessationDate`),
  `charges` (`chargeId`, `chargeHolder`, `amount`, `createdDate`, `modifiedDate`, `satisfiedDate`, `chargeStatus`),
  `efilings` (`srn`, `eform`, `filed`), `addresses`, `previousName`. Dates are `DD-MM-YYYY`.
* `POST …/corpx/business/search` with `{"businessName": {"matchCriteria": "CONTAINS", "matchValue": "…", "enableFuzzy": true}}`
  → fuzzy name search over ~3M companies (`indexId` = CIN/LLPIN).
* Mapping rules in `src/lib/providers/attestr.ts`: "FO User" rows (MCA portal users) are not treated as appointments;
  director **PAN numbers are never stored**; past addresses (no dates) are dropped; e-filings carry no financial year,
  so the missing-annual-filing check is skipped for them rather than inferred.
* **No financial statements** — revenue/profit/balance-sheet figures are not part of this API.
* Access requires an Attestr business account (KYC-verified). DPDP Act 2023 consent requirements apply to personal data.
* The official data.gov.in record stays the master profile; Attestr only adds the sections it lacks (unless the
  official dataset doesn't have the entity).

### 3a-2. `MCA_PROVIDER=probe42` (financial statements + directors + charges)

Probe42's reference is behind a sales-issued login. The adapter (`src/lib/providers/probe42.ts`) follows a recorded
v1.3 response published by a public integration (github.com/shrayash-s45/p42-watchout) — **verify against your
account's reference on first use.**

* `GET {base}/companies/{CIN}/comprehensive-details` (LLPs: `/llps/{LLPIN}/…`), headers `x-api-key`,
  `Accept: application/json`, `x-api-version: 1.3`. Sandbox base `https://api.probe42.in/probe_pro_sandbox`
  (only ~150 whitelisted entities), production `https://api.probe42.in` (`PROBE42_ENV=production`).
* Mapped: `company.*` master data, `name_history`, `authorized_signatories` (DIN, designation, appointment/cessation),
  `charge_sequence` + `open_charges` (collapsed to one row per charge), and `financials[]` →
  revenue (`pnl.lineItems.net_revenue`), other income, depreciation, finance cost (`interest`), PBT, PAT,
  net worth (`bs.subTotals.total_equity`), total assets (`bs.assets.given_assets_total`),
  borrowings (`bs.subTotals.total_debt`), paid-up capital (`bs.liabilities.share_capital`). Standalone statements are
  used; consolidated only when no standalone exist — never mixed. EBITDA and total liabilities are calculated by the
  app and labelled "Calculated".
* Not mapped: the filing list (the endpoint only has the latest AOC-4/MGT-7 dates — a partial list would make older
  years look missing); name search (filter schema unconfirmed); director PAN/DOB/age/gender/address (never stored).
* 404 "not probed yet" → the adapter calls `POST /companies/{CIN}/update`; data appears on a later refresh.

### 3b. `MCA_PROVIDER=sandbox`

* Auth: `POST {base}/authenticate` with headers `x-api-key`, `x-api-secret` → `data.access_token` (JWT, 24 h). Token cached in memory.
* Master data: `POST {base}/kyc/mca/company/master-data` body `{"cin": "..."}`, headers `Authorization: <token>`, `x-api-key`.
* Response fields mapped: `company_name, company_status, company_class, company_category, company_sub_category, listing_status, company_origin, company_registration_date, company_roc_code, company_state_code, nic_code, company_industrial_classification, authorized_capital, paidup_capital, registered_office_address, updated_at`.
* Master data only (the documented endpoint does not include directors/charges; Sandbox's director API is discontinued).

### 3c. `MCA_PROVIDER=generic` — adapter contract

Point `MCA_PROVIDER_BASE_URL` at any service (a vendor, or your own thin proxy over a licensed vendor) that implements:

```
Authorization: Bearer <MCA_PROVIDER_API_KEY>

GET /entities/{CIN|LLPIN}          → 200 EntityBundle | 404
GET /search?q=...&limit=10         → 200 { "results": [ { kind, identifier, name, status?, state?, incorporationDate? } ] }
GET /directors/{DIN}/entities      → 200 { "results": [ ...same shape... ] }
```

`EntityBundle` (validated with zod in `src/lib/providers/thirdparty.ts`; dates ISO `YYYY-MM-DD`, money in INR):

```jsonc
{
  "entity": { "kind": "company", "identifier": "U…", "name": "…", "status": "Active", "companyClass": "Private",
              "incorporationDate": "2014-06-12", "roc": "RoC-Bangalore", "state": "Karnataka",
              "authorizedCapital": 50000000, "paidUpCapital": 32000000, "lastUpdatedAt": "2026-09-01" },
  "addresses":   [ { "line": "…", "city": "…", "pincode": "560102", "effectiveFrom": "2014-06-12", "effectiveTo": null } ],
  "nameHistory": [ { "previousName": "…", "changedOn": "2018-09-14" } ],
  "directors":   [ { "din": "01234567", "name": "…", "designation": "Director", "appointmentDate": "…", "cessationDate": null } ],
  "filings":     [ { "formType": "AOC-4", "financialYear": "2023-24", "filingDate": "…", "dueDate": null, "srn": "…",
                     "status": "Filed", "documentAvailable": true, "documentUrl": null } ],
  "financials":  [ { "financialYear": "2023-24", "revenue": 0, "profitAfterTax": 0, "netWorth": 0, "totalAssets": 0,
                     "borrowings": 0, "depreciation": 0, "financeCost": 0, "profitBeforeTax": 0 } ],
  "charges":     [ { "chargeId": "100312904", "holderName": "…", "amount": 120000000, "creationDate": "…",
                     "modificationDate": null, "satisfactionDate": null, "status": "open" } ]
}
```

Omit a section entirely if the vendor doesn't supply it (→ "not available"); send `[]` if it supplies it and there are none. Only send values the vendor actually reports — the app calculates EBITDA/liabilities itself and labels them.

## 4. Adding a provider

1. Implement `DataProvider` (`src/lib/providers/types.ts`) — map native responses to the `Raw*` shapes.
2. Register a `ProviderSourceInfo` in `src/lib/providers/sources.ts` with the right `category`.
3. Add it to `allProviders()` in `src/lib/providers/registry.ts` (order = priority).

No frontend or API change is needed.

# Legacy Email Finder: Entry Point Notes

This document summarizes where the old `email-finder` feature lives, what it calls, and how related legacy services fit together.

## 1) Where the old frontend feature is wired

- Route:
  - `old-codebase/tgn-labeling-dashboard-frontend/src/router/index.ts`
  - Route name/path: `email-finder` / `/email-finder`
- View/component:
  - `old-codebase/tgn-labeling-dashboard-frontend/src/views/EmailFinderView.vue`
  - `old-codebase/tgn-labeling-dashboard-frontend/src/components/EmailFinder.vue`

## 2) What endpoint it calls

The old frontend calls a Lambda URL directly (not via the old backend API URL variable):

- `old-codebase/tgn-labeling-dashboard-frontend/src/api/email.ts`
  - URL: `https://oreahl4x7yip64sr4agqpcs7dq0qofvn.lambda-url.us-east-1.on.aws/`
  - Method: `POST`
  - Payload fields: `protagonist`, `business`, `location`, `apikey`

## 3) Which Lambda function this maps to

Legacy backend code references this ARN for the email lookup flow:

- `old-codebase/tgn-labeling-dashboard-backend/src/main/java/vn/sparkminds/tgndashboard/service/AiResearcherService.java`
  - `arn:aws:lambda:us-east-1:222519836774:function:tgn-ai-researcher-find-email-of-protagonist`

Likely implementation file in `old-codebase`:

- `old-codebase/tgn-ai-researcher/tgn-ai-researcher-find-email-of-protagonist.py`

## 4) Related AI researcher files and differences

### `tgn-ai-researcher-find-business-and-protagonist-in-article.py`
- Purpose: Extract `protagonist`, `business`, `location` from article text.
- Input: `event["articleText"]`
- Output: body JSON with `protagonist`, `business`, `location`
- Type: small single-purpose Lambda.

### `tgn-ai-researcher-find-email-of-protagonist.py`
- Purpose: Main email-finder orchestrator.
- Input style: direct Lambda event object with `protagonist`, `business`, `location`.
- Flow: Google search -> URL selection via LLM -> website scraping -> Facebook/LinkedIn/Tomba enrichments -> QA filters -> email verification.

### `tgn-ai-researcher-find-email-of-protagonist-web.py`
- Purpose: Web-facing variant of the same orchestrator.
- Nearly identical to the file above, but handler differs:
  - Validates a shared-secret string in the incoming event.
  - Reads payload from `event["body"]` JSON.

### `tgn-ai-researcher-get-website-emails` (folder, `app.py`)
- Purpose: lower-level website extractor service (`POST /extract`).
- Uses Playwright + proxies, returns emails/title/description from a single URL.
- Used as a helper/fallback by the main email-finder flow for hard-to-scrape pages.

## 5) Proxy behavior (important)

### In `find-email-of-protagonist*.py`
- Proxy list is loaded dynamically from DynamoDB table:
  - Table name: `tgn-ai-researcher-proxies`
- Runtime behavior:
  - Scan for available proxies (not reserved or reservation expired).
  - Reserve a subset via transactional update (`reserved_until`, `reservation_id`).
  - Use reserved proxies for scraping.

I did not find code in `old-codebase` that seeds/populates this specific table. This implies population was likely done manually or by external infra/scripts not included here.

### In `tgn-ai-researcher-get-website-emails/app.py`
- Proxies are a hardcoded static list in the source file.

### Reuse of same static list elsewhere
- Similar proxy entries also appear in:
  - `old-codebase/tgn-scraper/tgn/settings.py`
  - `old-codebase/tgn-labeling-dashboard-backend/src/main/java/vn/sparkminds/tgndashboard/config/ProxyConfig.java`

## 6) Practical trace path for debugging

If you need to revisit quickly, follow in this order:

1. `old-codebase/tgn-labeling-dashboard-frontend/src/components/EmailFinder.vue`
2. `old-codebase/tgn-labeling-dashboard-frontend/src/api/email.ts`
3. `old-codebase/tgn-ai-researcher/tgn-ai-researcher-find-email-of-protagonist-web.py` (web handler behavior)
4. `old-codebase/tgn-ai-researcher/tgn-ai-researcher-find-email-of-protagonist.py` (core logic)
5. `old-codebase/tgn-ai-researcher/tgn-ai-researcher-get-website-emails/app.py` (helper extractor)
6. `old-codebase/tgn-labeling-dashboard-backend/src/main/java/vn/sparkminds/tgndashboard/service/AiResearcherService.java` (ARN references)

## 7) Security and maintenance note

Multiple legacy files contain hardcoded credentials, API keys, and proxy credentials. Treat this old code as sensitive and avoid reusing it as-is in new systems.

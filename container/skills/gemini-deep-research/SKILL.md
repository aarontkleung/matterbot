---
name: gemini-deep-research
description: Conduct deep research using Google Gemini's Deep Research feature via browser automation. Handles Google authentication automatically (saved state + env credential fallback). Use when the user asks for "gemini deep research", "use gemini to research", "google deep research", or when comprehensive multi-source research is needed and the user wants to leverage Gemini's research capabilities instead of manual web searches.
allowed-tools: Bash(agent-browser:*)
---

# Gemini Deep Research via Browser

Use agent-browser to access Gemini Deep Research at gemini.google.com. Auth state is persisted per-group.

## Workflow

1. Authenticate (load saved state or login with env credentials)
2. Navigate to Gemini and start a Deep Research query
3. Poll until research completes
4. Extract and return the research report

## Step 1: Authenticate

```bash
# Check for saved auth state
if [ -f .google-auth.json ]; then
  echo "AUTH_STATE_EXISTS"
else
  echo "NO_AUTH_STATE"
fi
```

**If state exists:** Load it and verify session is still valid:

```bash
agent-browser --state .google-auth.json open https://gemini.google.com
agent-browser wait --load networkidle
agent-browser get url
```

Check the URL. If it contains `accounts.google.com` or shows a sign-in page, the session expired — proceed to login below. If it loads Gemini directly, skip to Step 2.

**If no state or expired:** Login with environment credentials:

```bash
agent-browser open https://accounts.google.com/signin
agent-browser wait --load networkidle
agent-browser snapshot -i
```

Fill the email field and click Next:

```bash
agent-browser fill @<email-input-ref> "$GOOGLE_EMAIL"
agent-browser click @<next-button-ref>
agent-browser wait --load networkidle
```

Wait for password page, snapshot, fill password and click Next:

```bash
agent-browser snapshot -i
agent-browser fill @<password-input-ref> "$GOOGLE_PASSWORD"
agent-browser click @<next-button-ref>
agent-browser wait --load networkidle
```

Handle any 2FA or "confirm it's you" prompts by taking a snapshot and following the UI flow. After reaching the Google account dashboard or Gemini page:

```bash
agent-browser open https://gemini.google.com
agent-browser wait --load networkidle
agent-browser state save .google-auth.json
```

## Step 2: Start Deep Research

Navigate to Gemini (if not already there) and start a new conversation:

```bash
agent-browser open https://gemini.google.com
agent-browser wait --load networkidle
agent-browser snapshot -i
```

Find the chat input, type the research query, and look for the "Deep Research" button or mode selector. The UI may vary — use snapshot to identify the correct elements.

Typical flow:
1. Find and click the Deep Research mode toggle/button
2. Type the research query into the input field
3. Submit the query

## Step 3: Wait for Research to Complete

Gemini Deep Research takes 2-5 minutes. Poll by taking periodic snapshots:

```bash
agent-browser wait 30000
agent-browser snapshot -c
```

Repeat every 30 seconds. Look for indicators that research is complete:
- A full report with sections and citations appears
- The "researching" spinner/animation stops
- An "Export" or "Copy" button appears

Do NOT wait more than 10 minutes total. If still running after 10 minutes, extract whatever partial results are available.

## Step 4: Extract Results

Once complete, extract the research report text:

```bash
agent-browser snapshot
agent-browser get text @<report-container-ref>
```

If the report is long, scroll and extract in sections. For a full capture:

```bash
agent-browser screenshot --full research-report.png
```

Close the browser when done:

```bash
agent-browser close
```

## Important Notes

- **Auth credentials** come from `$GOOGLE_EMAIL` and `$GOOGLE_PASSWORD` environment variables (set in .env on the host)
- **Auth state** is saved to `.google-auth.json` in the group workspace (persists between container runs)
- **Google may block automated logins** — if login fails, inform the user they may need to use an App Password or adjust account security settings
- **2FA handling**: If Google prompts for 2FA, inform the user — automated 2FA bypass is not supported
- **Rate limits**: Don't run more than a few deep research queries per hour to avoid triggering Google's abuse detection

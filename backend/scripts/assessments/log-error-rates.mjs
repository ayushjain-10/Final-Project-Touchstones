// DevOps — log triage; rubric rewards correct ERROR counting, robust parsing, and stable tie-breaking.
export default {
  slug: 'log-error-rates',
  title: 'Top Error Services from Logs',
  role_family: 'devops',
  language: 'python',
  response_type: 'code',
  duration_minutes: 30,
  entry_file: 'solution.py',
  entry_fn: 'top_error_services',
  prompt_md: `# Top Error Services from Logs

You are given a list of log \`lines\` and an integer \`n\`. Each line is a string of the form:

\`\`\`
LEVEL service message words...
\`\`\`

- \`LEVEL\` is one of \`INFO\`, \`WARN\`, or \`ERROR\` (uppercase).
- \`service\` is a single token (no spaces).
- The rest of the line is a free-text message (may be empty).

Count, **per service**, the number of lines whose \`LEVEL == "ERROR"\`. Return the top \`n\`
services by error count as a list of \`[service, count]\` pairs, sorted by **count descending**,
ties broken by **service name ascending**.

Rules:
- Services with **zero** errors are excluded.
- If fewer than \`n\` services have errors, return all of them.
- Ignore malformed lines (fewer than 2 tokens).

\`\`\`python
def top_error_services(lines, n):
    ...
\`\`\`

**Example:**

\`\`\`python
top_error_services(["ERROR auth bad token", "INFO auth ok", "ERROR db timeout", "ERROR auth expired"], 2)
# -> [["auth", 2], ["db", 1]]
\`\`\``,
  rubric: {
    criteria: [
      { id: 'correct', requirement: 'Counts ERROR lines per service and returns the correct top-n list for all inputs', points_possible: 5, weight: 1 },
      { id: 'parsing', requirement: 'Parses LEVEL/service tokens correctly and ignores malformed lines (<2 tokens) and non-ERROR levels', points_possible: 3, weight: 1 },
      { id: 'edge_cases', requirement: 'Sorts by count desc with ascending-name tie-break; excludes zero-error services; handles n > #services and no errors', points_possible: 2, weight: 1 },
    ],
  },
  starter: `def top_error_services(lines, n):
    # Return top-n [service, count] pairs by ERROR count (desc), ties by name (asc).
    pass
`,
  cases: [
    { name: 'basic example', visible: true, input: [["ERROR auth bad token", "INFO auth ok", "ERROR db timeout", "ERROR auth expired"], 2], expected: [["auth", 2], ["db", 1]] },
    { name: 'ignores INFO and WARN', visible: true, input: [["INFO web up", "WARN web slow", "ERROR web 500"], 5], expected: [["web", 1]] },
    { name: 'no errors at all', visible: true, input: [["INFO a ok", "WARN b slow"], 3], expected: [] },
    { name: 'tie broken by name ascending', visible: false, input: [["ERROR zeta x", "ERROR alpha y", "ERROR mid z"], 3], expected: [["alpha", 1], ["mid", 1], ["zeta", 1]] },
    { name: 'n larger than service count', visible: false, input: [["ERROR api boom", "ERROR cache miss"], 10], expected: [["api", 1], ["cache", 1]] },
    { name: 'malformed lines ignored', visible: false, input: [["ERROR", "ERROR auth nope", "", "WARN", "ERROR auth again"], 1], expected: [["auth", 2]] },
    { name: 'count desc then name asc', visible: false, input: [["ERROR db a", "ERROR db b", "ERROR db c", "ERROR auth x", "ERROR auth y", "ERROR web z"], 2], expected: [["db", 3], ["auth", 2]] },
    { name: 'empty message tokens', visible: false, input: [["ERROR svc1", "ERROR svc1", "ERROR svc2"], 2], expected: [["svc1", 2], ["svc2", 1]] },
    { name: 'mixed levels per service', visible: false, input: [["INFO pay started", "ERROR pay declined", "WARN pay retry", "ERROR pay declined again", "INFO ship ok", "ERROR ship lost"], 5], expected: [["pay", 2], ["ship", 1]] },
    { name: 'empty input', visible: false, input: [[], 3], expected: [] },
  ],
  reference: `def top_error_services(lines, n):
    counts = {}
    for line in lines:
        parts = line.split()
        if len(parts) < 2:
            continue
        level, service = parts[0], parts[1]
        if level == "ERROR":
            counts[service] = counts.get(service, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [[service, count] for service, count in ranked[:n]]
`,
  // Buggy: sorts only by count descending and forgets the ascending-name tie-break,
  // so tied services come out in insertion order instead of alphabetical.
  buggy: `def top_error_services(lines, n):
    counts = {}
    for line in lines:
        parts = line.split()
        if len(parts) < 2:
            continue
        level, service = parts[0], parts[1]
        if level == "ERROR":
            counts[service] = counts.get(service, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    return [[service, count] for service, count in ranked[:n]]
`,
};

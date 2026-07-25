// Marketing blog / news posts, newest first. Consumed by Blog.jsx (the index)
// and BlogPost.jsx (a single post).
//
// `body` is a lightweight block array so we avoid pulling in a markdown parser:
//   - a plain string renders as a paragraph
//   - { type: 'h2', text } renders as a serif subhead
// Keep copy honest and on-brand: no em-dashes, no "detect cheating" / "deterministic".

export const blogPosts = [
  {
    slug: 'uber-ai-budget-lesson',
    tag: 'Industry',
    title: "Uber burned its entire 2026 AI budget in four months. The lesson isn't to cap AI.",
    dek: "When most of the code shipping at one of the world's hardest engineering orgs starts as AI output, the hiring question changes.",
    date: '2026-07-07',
    readingMins: 4,
    author: 'Touchstones',
    sourceLabel: 'TechCrunch',
    sourceUrl:
      'https://techcrunch.com/2026/06/02/uber-caps-employee-ai-spending-after-blowing-through-budget-in-four-months/',
    body: [
      "Uber's engineers ran through the company's entire 2026 AI coding budget by the end of March. Not one team, not a pilot: the whole year's allocation, spent in a quarter. Uber's CTO said as much publicly, and the response was a per-engineer cap on agentic-coding tools like Cursor and Claude Code, set at $1,500 a month.",
      'The numbers underneath that cap are the real story. Roughly 95% of Uber engineers use AI in their day-to-day work, and close to 70% of the code they commit is AI-generated. When nearly everyone reaches for AI, and most of what ships to production starts as model output, AI is not a perk you ration. It is the medium the work happens in.',
      { type: 'h2', text: 'The easy read is wrong' },
      "The easy read is that AI spend got out of control and needed a leash. Maybe. But a budget cap is a finance decision, and it says nothing about whether the people spending that budget are any good at it. At 70% AI-generated code, the difference between a strong engineer and a weak one is not whether they use AI. It is what they do with what it hands back.",
      { type: 'h2', text: 'The hiring question changed' },
      'For years the question hiding under every take-home was: did they do this themselves? That question is now close to meaningless. Everyone uses AI. The candidate who refuses to is the outlier, and rarely in a good way.',
      "The question worth asking is the one Uber's own workflow implies: how well does this person direct AI, review what it produces, and catch it when it is wrong? An engineer who accepts whatever the model returns is a liability when most of the codebase started as a suggestion. An engineer who reads it critically, throws out the wrong parts, tests the rest, and knows which problems to hand off and which to keep is the person who makes a 95%-AI org actually ship.",
      'You cannot measure that by banning AI in the interview, and you cannot measure it by watching someone solve a puzzle from memory. You measure it by giving people real work, letting them use AI the way they will on the job, and scoring both the result and how they got there. That is exactly what an AI-allowed, real-work screen is built to see. Capping the budget was the easy call. Hiring for judgment is the durable one.',
    ],
  },
  {
    slug: 'ai-cheating-live-coding-doesnt-catch-it',
    tag: 'Hiring',
    title:
      "38% of technical candidates now show signs of AI cheating, and live coding doesn't catch it. Banning AI doesn't either.",
    dek: 'Proctoring is a losing arms race. The durable answer is to change what the interview measures.',
    date: '2026-06-24',
    readingMins: 4,
    author: 'Touchstones',
    sourceLabel: 'Karat / Fabric research',
    sourceUrl: 'https://karat.com/engineering-interview-trends-2026/',
    body: [
      'Roughly 38% of technical candidates now show signs of AI-assisted cheating in interviews. In purely technical roles it climbs toward 48%. Those figures come from an analysis of about 19,368 interviews between July 2025 and January 2026, and they should retire a comfortable myth: that a live coding call is a cheat-proof room.',
      'The rest of the picture is worse. Around 61% of the candidates flagged for cheating passed the interview anyway. Unproctored take-home assessments showed more than four times the score inflation of proctored ones. And 71% of engineering leaders say AI has made skills harder to assess, with the take-home taking the biggest hit of any format.',
      { type: 'h2', text: 'Banning AI is the wrong fix' },
      'The instinct is to lock the room down harder: proctoring software, webcam monitoring, keystroke analysis, output classifiers that guess whether a model wrote something. Every one of those is a bet in an arms race you do not control. Classifiers get gamed. Proctoring is invasive, it punishes nervous but honest candidates, and it turns a company’s first impression into surveillance. And it still misses the case that matters most: a strong engineer using AI well, which is what the job actually looks like now.',
      { type: 'h2', text: 'Change what you measure' },
      'There is a version of this that is not a losing game. Stop trying to prove a candidate did not use AI. Give them real work, tell them AI is allowed, and score two things: the quality of what they produced, and how they directed the AI to get there.',
      'That reframing quietly separates the strong from the weak. Strong engineers read AI output, distrust it in the right places, reject the parts that are wrong, and test what is left. Weaker ones accept the first answer and move on. When AI is banned, both look the same on a whiteboard. When AI is allowed and the work is real, they stop looking alike.',
      'Cheating is only powerful against a test that AI can quietly finish for you. Against a test where using AI well is the whole point, it stops being a category worth policing. That is the version of technical hiring worth building.',
    ],
  },
  {
    // Post C stands in for the founder's LinkedIn manifesto until the published
    // URL is available. Owner: replace this body (or add sourceLabel + sourceUrl
    // pointing at the LinkedIn post) once it is live.
    slug: 'verification-is-assurance-not-surveillance',
    tag: 'Manifesto',
    title: 'Verification is assurance, not surveillance.',
    dek: 'Why we allow AI, score from a rubric, keep proof-of-human behavioral, and will never add facial recognition or screen recording.',
    date: '2026-06-10',
    readingMins: 3,
    author: 'Touchstones',
    body: [
      "Every verification tool eventually reaches the same fork: reassure the hiring team, or surveil the candidate. Most pick surveillance, because it is easier to build and it demos well. We think that is a mistake, and refusing it is the whole point of Touchstones.",
      { type: 'h2', text: 'We allow AI, on purpose' },
      'Candidates can use AI in a Touchstones screen, openly, the way they would at work. Banning it would measure a skill almost nobody uses anymore, and it would reward whoever hides it best. Allowing it lets us watch something far more useful: judgment. Does the candidate read what the model gives them? Reject the wrong parts? Test the rest? That is the signal a hiring manager actually wants.',
      { type: 'h2', text: 'We score the work, from a rubric' },
      'Scores come from the work itself, read against a rubric a hiring manager can see. Not a black box, not a vibe. If we tell you a candidate scored a certain way, we can show you the work and the criteria behind it. Explainable beats clever, especially when a hiring decision has to hold up to a person who disagrees with it.',
      { type: 'h2', text: 'Proof-of-human is behavioral, never biometric' },
      'We confirm there is a real person doing the work using behavioral signals the server observes during the session. We do not use facial recognition. We do not match identities against a database. We do not infer emotion from a face or a voice. We do not record a candidate’s screen or camera, and we do not log media or transcripts. Any human-authenticity signal is a flag for a person on your team to weigh, never an automated pass or fail.',
      { type: 'h2', text: 'Why we draw the line here' },
      'Surveillance is a tax you charge every honest candidate to catch a few dishonest ones, and it still loses to anyone determined enough. Assurance is different: it earns a hiring team’s confidence without making the candidate the suspect. A company selling trust cannot treat its candidates as guilty by default. So the line is simple and permanent. We will never add facial recognition, identity matching, emotion inference, or screen recording, no matter how much easier it would make a demo.',
      'Verification is assurance. It is not surveillance. That distinction is not a tagline for us. It is the product.',
    ],
  },
]

// Look up a single post by slug (used by the /blog/:slug route).
export function getPost(slug) {
  return blogPosts.find((p) => p.slug === slug)
}

// Format an ISO date (YYYY-MM-DD) as "Jul 7, 2026" without timezone drift
// (parsing the string directly, so a negative UTC offset can't roll it back a day).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

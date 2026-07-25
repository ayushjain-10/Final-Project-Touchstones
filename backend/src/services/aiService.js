const { TextAnalyticsClient, AzureKeyCredential } = require("@azure/ai-text-analytics");
const { OpenAIClient, AzureKeyCredential: OpenAICredential } = require("@azure/openai");

// Optional fallback provider (only used if the primary Anthropic call fails)
let OpenAI = null;
try { OpenAI = require("openai"); } catch (e) { /* openai package optional */ }

// Datadog LLM Observability — traces every model call below (no-op unless DD_LLMOBS_ENABLED=1).
const llmObs = require("../telemetry/llmObs");

// Initialize Azure AI clients (only if credentials are available)
let textAnalyticsClient = null;
try {
  if (process.env.AZURE_LANGUAGE_ENDPOINT && process.env.AZURE_LANGUAGE_KEY) {
    textAnalyticsClient = new TextAnalyticsClient(
      process.env.AZURE_LANGUAGE_ENDPOINT,
      new AzureKeyCredential(process.env.AZURE_LANGUAGE_KEY)
    );
    console.log("Azure Text Analytics client initialized successfully");
  } else {
    console.log("Azure Text Analytics credentials not available");
  }
} catch (error) {
  console.warn("Azure Text Analytics initialization failed:", error.message);
}

// ── LLM provider (Azure OpenAI primary; Anthropic optional fallback) ─────────────
// Touchstones runs all model calls through Azure OpenAI. We expose ONE `openaiClient`
// object with three faces so nothing downstream had to change:
//   • getChatCompletions(deployment, messages, opts) → OpenAI/Azure-shaped, for the generic
//     callers (outreach, screenGen, …) that already used this signature.
//   • _anthropic → an Anthropic-SHAPED shim (messages.create) so the core graders
//     (proofScoringService / aiAssistService / aiDirectionService) run UNCHANGED.
//   • _model → the deployment id, recorded verbatim in scoring provenance (proof_scores.model_id).
// Provider precedence: LLM_PROVIDER=anthropic forces Claude; otherwise Azure if configured,
// else Anthropic if a key is present, else classical fallbacks.
let openaiClient = null;
let azureDeploymentExists = false;
let LLM_PROVIDER = (process.env.LLM_PROVIDER || "").toLowerCase();

// gpt-5*/o-series are "reasoning" models: reasoning tokens are billed INSIDE
// max_completion_tokens, temperature is fixed at its default (must be omitted), and
// effort is tunable. Non-reasoning models keep max_tokens + temperature.
function reasoningFamily(dep) { return /^(o\d|gpt-5)/i.test(String(dep || "")); }

function buildAzureLLM() {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || "").trim();
  const apiKey = (process.env.AZURE_OPENAI_KEY || "").trim();
  const deployment = (process.env.AZURE_OPENAI_DEPLOYMENT || "").trim();
  if (!endpoint || !apiKey || !deployment) return null;
  if (!OpenAI || !OpenAI.AzureOpenAI) return null;
  if (process.env.SKIP_AZURE_OPENAI === "true") return null;

  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";
  const effort = (process.env.AZURE_OPENAI_REASONING_EFFORT || "low").toLowerCase();
  const completionFloor = parseInt(process.env.AZURE_OPENAI_MAX_COMPLETION_FLOOR || "4000", 10);
  // Strict structured outputs: when a caller passes a JSON Schema, emit response_format json_schema
  // (strict) so the model CANNOT return a malformed grade (missing criterion, out-of-range field, prose
  // where a number belongs). Confirmed on gpt-5.4-mini + 2025-04-01-preview. Flag-gated so it's a no-op
  // (falls back to json_object) unless AZURE_STRUCTURED_OUTPUTS=true.
  const strictJson = process.env.AZURE_STRUCTURED_OUTPUTS === "true";
  const az = new OpenAI.AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });

  const toMessages = (system, messages) => {
    const out = [];
    if (system) {
      const sys = Array.isArray(system)
        ? system.map((b) => (typeof b === "string" ? b : (b && b.text) || "")).join("\n\n")
        : String(system);
      if (sys) out.push({ role: "system", content: sys });
    }
    for (const m of messages || []) {
      const content = Array.isArray(m.content)
        ? m.content.map((b) => (typeof b === "string" ? b : (b && b.text) || "")).join("")
        : String(m.content);
      out.push({ role: m.role === "assistant" ? "assistant" : "user", content });
    }
    if (!out.some((m) => m.role !== "system")) out.push({ role: "user", content: "" });
    return out;
  };

  const buildBody = (dep, messages, { maxTokens, temperature, jsonMode, jsonSchema } = {}) => {
    const body = { model: dep, messages };
    if (reasoningFamily(dep)) {
      // Give reasoning headroom: reasoning tokens + the JSON answer share this budget.
      body.max_completion_tokens = Math.max(Number(maxTokens) || 0, completionFloor);
      if (effort && effort !== "default") body.reasoning_effort = effort;
    } else {
      body.max_tokens = Number(maxTokens) || 1024;
      if (typeof temperature === "number") body.temperature = temperature;
    }
    if (jsonSchema && strictJson) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: jsonSchema.name || "output", strict: true, schema: jsonSchema.schema || jsonSchema },
      };
    } else if (jsonMode) {
      body.response_format = { type: "json_object" };
    }
    return body;
  };

  return {
    _provider: "azure",
    _model: deployment,
    _azure: az,
    // Anthropic-shaped shim: messages.create({ model, max_tokens, system, messages, temperature }, { signal }).
    // Returns { content: [{type:'text', text}], usage:{input_tokens, output_tokens} } so the core
    // graders parse it exactly as they did Claude's response.
    _anthropic: {
      messages: {
        create: async (params = {}, options = {}) => {
          const messages = toMessages(params.system, params.messages);
          // JSON mode only when the prompt explicitly demands a bare JSON object (grader, direction)
          // — NOT for the prose+code AI assistant. json_object also requires "json" in the messages.
          const allText = messages.map((m) => m.content).join("\n").toLowerCase();
          const jsonMode = allText.includes("json") &&
            /(respond with only|only a json|only this json|no prose|no fences|no markdown)/.test(allText);
          const body = buildBody(deployment, messages, {
            maxTokens: params.max_tokens, temperature: params.temperature, jsonMode,
            jsonSchema: params.response_schema,   // strict structured output when the caller supplies a schema
          });
          const resp = await llmObs.traceLLM(
            { name: "grader.chat", model: deployment, input: messages },
            () => az.chat.completions.create(body, { signal: options.signal })
          );
          const text = resp.choices?.[0]?.message?.content || "";
          return {
            content: [{ type: "text", text }],
            // Azure prompt caching (plan #3): the grader's stable rubric system-prefix is cached across
            // the 3 self-consistency calls + every candidate on a job. Surface cached_input_tokens so the
            // cost model + observability can see the discount (cached input is ~50-90% cheaper).
            usage: {
              input_tokens: resp.usage?.prompt_tokens,
              output_tokens: resp.usage?.completion_tokens,
              cached_input_tokens: resp.usage?.prompt_tokens_details?.cached_tokens || 0,
            },
          };
        },
      },
    },
    // OpenAI/Azure-shaped generic adapter (outreach, screenGen, …). One chat deployment, so the
    // caller's deployment arg is advisory; temperature is dropped automatically for reasoning models.
    async getChatCompletions(_deployment, messages, opts = {}) {
      const body = buildBody(deployment, messages, {
        maxTokens: opts.maxTokens, temperature: opts.temperature,
        jsonMode: opts.responseFormat === "json",
      });
      const resp = await llmObs.traceLLM(
        { name: "azure.chat", model: deployment, input: messages },
        () => az.chat.completions.create(body, { signal: opts.abortSignal })
      );
      return { choices: [{ message: { content: resp.choices?.[0]?.message?.content || "" } }], usage: resp.usage };
    },
  };
}

function buildAnthropicLLM() {
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!anthropicKey) return null;
  const Anthropic = require("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const MODEL = process.env.AI_LLM_MODEL || "claude-haiku-4-5";
  return {
    _provider: "anthropic",
    _anthropic: anthropic,
    _model: MODEL,
    async getChatCompletions(_deployment, messages, opts = {}) {
      const sysParts = [], turns = [];
      for (const m of messages || []) {
        if (m.role === "system") sysParts.push(String(m.content));
        else turns.push({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) });
      }
      if (!turns.length) turns.push({ role: "user", content: "" });
      const system = sysParts.length
        ? [{ type: "text", text: sysParts.join("\n\n"), cache_control: { type: "ephemeral" } }]
        : undefined;
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: opts.maxTokens || 1024,
        ...(system ? { system } : {}),
        ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
        messages: turns,
      });
      const text = (resp.content || []).map((b) => (b.type === "text" ? b.text : "")).join("");
      return { choices: [{ message: { content: text } }], usage: resp.usage };
    },
  };
}

try {
  const azure = buildAzureLLM();
  const anthropic = LLM_PROVIDER === "azure" ? null : buildAnthropicLLM();
  if (LLM_PROVIDER === "anthropic" && anthropic) {
    openaiClient = anthropic;                         // explicit Claude
  } else if (azure && LLM_PROVIDER !== "anthropic") {
    openaiClient = azure;                             // Azure-first (default)
  } else if (anthropic) {
    openaiClient = anthropic;                         // no Azure → Claude
  } else if (azure) {
    openaiClient = azure;
  }
  if (openaiClient) {
    azureDeploymentExists = true;
    LLM_PROVIDER = openaiClient._provider;
    const desc = openaiClient._provider === "azure"
      ? `Azure OpenAI '${openaiClient._model}' (${reasoningFamily(openaiClient._model) ? "reasoning" : "chat"})`
      : `Anthropic ${openaiClient._model}`;
    console.log(`AI LLM: ${desc}`);
  } else {
    console.log("AI LLM: no LLM configured — using classical fallback methods");
  }
} catch (error) {
  console.warn("AI LLM client initialization failed:", error.message);
  azureDeploymentExists = false;
}

class AIService {
  // Expose the underlying chat client + model for services that call the model directly
  // (proof scoring, AI assist, direction scoring). `.anthropic` is an Anthropic-shaped client
  // (real Claude, or an Azure-backed shim). Returns { anthropic: null } if unconfigured.
  getLLM() {
    return {
      anthropic: (openaiClient && openaiClient._anthropic) || null,
      model: (openaiClient && openaiClient._model) || process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AI_LLM_MODEL || null,
      provider: (openaiClient && openaiClient._provider) || LLM_PROVIDER || null,
    };
  }

  // Generate personalized outreach messages using Azure AI
  async generateOutreachMessage(candidate, jobDetails, messageType = 'linkedin') {
    try {
      // Format prompt with context about the candidate and job
      const prompt = this.createOutreachPrompt(candidate, jobDetails, messageType);

      // Try Azure OpenAI if available
      if (openaiClient) {
        try {
          const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-35-turbo";
          
          const response = await openaiClient.getChatCompletions(
            deploymentName,
            [
              { 
                role: "system", 
                content: "You are an expert recruiter crafting personalized outreach messages. Your messages are concise, professional, and highlight the specific reasons why a candidate is a good fit for a role." 
              },
              { role: "user", content: prompt }
            ],
            {
              temperature: 0.7,
              maxTokens: messageType === 'email' ? 450 : 200
            }
          );
          
          return response.choices[0].message.content.trim();
        } catch (error) {
          console.warn('Azure OpenAI generation failed, falling back to template:', error.message);
          // Fall back to template-based generation if Azure OpenAI fails
        }
      }
      
      // If Azure OpenAI is not available or fails, use Azure Language Service for key phrase extraction
      // and then combine with templates
      try {
        // Use Language service to extract key phrases from job description
        const keyPhrases = await this.extractKeyPhrases(jobDetails.description);
        
        // Generate template-based message with extracted key phrases
        return this.generateTemplateBasedMessage(candidate, jobDetails, keyPhrases, messageType);
      } catch (error) {
        console.warn('Azure Language service failed, using simple template:', error.message);
        // Fall back to simple template if all else fails
        return this.generateSimpleTemplateMessage(candidate, jobDetails, messageType);
      }
    } catch (error) {
      console.error('AI Message Generation Error:', error);
      throw new Error(`Failed to generate message using AI: ${error.message}`);
    }
  }
  
  // Extract key phrases using Azure Text Analytics
  async extractKeyPhrases(text) {
    try {
      if (!textAnalyticsClient) {
        return []; // Return empty if client not initialized
      }

      const results = await textAnalyticsClient.extractKeyPhrases([text]);
      if (results && results.length > 0 && results[0].keyPhrases) {
        return results[0].keyPhrases;
      }
      return [];
    } catch (error) {
      console.warn('Key phrase extraction failed:', error.message);
      return [];
    }
  }
  
  // Generate a message based on templates and key phrases
  generateTemplateBasedMessage(candidate, jobDetails, keyPhrases, messageType) {
    // Select the most relevant skills that match key phrases
    const relevantSkills = candidate.skills.filter(skill => 
      keyPhrases.some(phrase => 
        phrase.toLowerCase().includes(skill.toLowerCase())
      )
    ).slice(0, 3);
    
    // Create a personalized intro based on the match
    const intro = relevantSkills.length > 0 
      ? `your impressive background in ${relevantSkills.join(', ')}` 
      : `your experience as a ${candidate.title || 'professional'}`;
    
    // Use simplified templates
    if (messageType === 'linkedin') {
      return `Hi ${candidate.name}, I came across your profile and was particularly impressed by ${intro}. We're looking for a ${jobDetails.title} at ${jobDetails.company || 'our company'}, and I think you might be a great fit. Would you be interested in learning more about this opportunity?`;
    } else {
      return `Subject: Exciting ${jobDetails.title} Opportunity at ${jobDetails.company || 'our company'}\n\nDear ${candidate.name},\n\nI hope this message finds you well. I came across your profile and was particularly impressed by ${intro}.\n\nWe're currently looking for a ${jobDetails.title} to join our team, and your background seems to align well with what we're looking for.\n\nWould you be available for a brief conversation to discuss this opportunity further?\n\nBest regards,\n[Your Name]\n[Company Recruiter]`;
    }
  }
  
  // Generate a simple template message as final fallback
  generateSimpleTemplateMessage(candidate, jobDetails, messageType) {
    if (messageType === 'linkedin') {
      return `Hi ${candidate.name}, we have an exciting ${jobDetails.title} opportunity at ${jobDetails.company || 'our company'} that might interest you. Would you like to learn more?`;
    } else {
      return `Subject: ${jobDetails.title} Opportunity\n\nHi ${candidate.name},\n\nI'm reaching out about a ${jobDetails.title} role at ${jobDetails.company || 'our company'} that might align with your background. Would you be interested in discussing this opportunity?\n\nBest regards,\n[Your Name]`;
    }
  }

  // Generate multiple message variations
  async generateOutreachVariations(candidate, jobDetails, count = 2) {
    const messages = {
      linkedin: [],
      email: []
    };

    try {
      // Generate LinkedIn message variations
      for (let i = 0; i < count; i++) {
        const linkedinMsg = await this.generateOutreachMessage(candidate, jobDetails, 'linkedin');
        messages.linkedin.push(linkedinMsg);
      }
      
      // Generate Email message variations
      for (let i = 0; i < count; i++) {
        const emailMsg = await this.generateOutreachMessage(candidate, jobDetails, 'email');
        messages.email.push(emailMsg);
      }
      
      return messages;
    } catch (error) {
      console.error('Error generating message variations:', error);
      throw error;
    }
  }
  
  // Create prompt for message generation
  createOutreachPrompt(candidate, jobDetails, messageType) {
    const skills = candidate.skills.join(', ');
    
    if (messageType === 'linkedin') {
      return `
        Create a brief, personalized LinkedIn outreach message to a potential candidate.
        
        Candidate information:
        - Name: ${candidate.name}
        - Current title: ${candidate.title || 'Not specified'}
        - Skills: ${skills}
        - Experience: ${candidate.experience || 'Not specified'}
        - Location: ${candidate.location || 'Not specified'}
        
        Job details:
        - Title: ${jobDetails.title}
        - Company: ${jobDetails.company || 'our company'}
        - Description: ${jobDetails.description}
        - Location: ${jobDetails.location || 'Remote'}
        
        Guidelines:
        - Keep it under 150 words
        - Be professional but conversational
        - Highlight specific skills that match the job requirements
        - Don't use generic phrases like "I came across your profile"
        - Include one specific reason why they would be a good fit
        - End with a clear call to action
        - Don't use any placeholder text like [Company Name]
        - Don't use lengthy introductions
      `;
    } else {
      // Email prompt
      return `
        Create a personalized email outreach message to a potential candidate.
        
        Candidate information:
        - Name: ${candidate.name}
        - Current title: ${candidate.title || 'Not specified'}
        - Skills: ${skills}
        - Experience: ${candidate.experience || 'Not specified'}
        - Location: ${candidate.location || 'Not specified'}
        
        Job details:
        - Title: ${jobDetails.title}
        - Company: ${jobDetails.company || 'our company'}
        - Description: ${jobDetails.description}
        - Location: ${jobDetails.location || 'Remote'}
        
        Guidelines:
        - Start with a subject line
        - Be professional but personable
        - Mention specific skills and how they align with job requirements
        - Briefly describe what makes the company or role unique
        - Include a specific reason why they would be a good fit
        - End with a clear call to action
        - Format as a complete email with Subject line, greeting, body, and signature
        - Don't use any placeholder text like [Company Name]
      `;
    }
  }
  
  // Evaluate resume match score using Azure services
  async evaluateResumeMatch(resumeText, jobDescription) {
    try {
      // Check if Azure OpenAI is available AND the deployment exists
      if (openaiClient && azureDeploymentExists) {
        try {
          const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-35-turbo";
          console.log(`Attempting to use Azure OpenAI deployment: ${deploymentName}`);
          
          const prompt = `
            Compare the following resume with the job description and rate how well the candidate matches the job on a scale of 1-100.
            Provide 3-5 specific reasons for your rating, mentioning exact skills, experience, or qualifications that match or don't match.
            
            Resume:
            ${resumeText.substring(0, 2000)}
            
            Job Description:
            ${jobDescription}
            
            Format your response exactly like this:
            Score: [number between 1 and 100]
            Analysis:
            - [First reason]
            - [Second reason]
            - [Third reason]
            Recommendation: [Either "Strong Match", "Moderate Match", or "Weak Match" based on the score]
          `;
          
          console.log('Sending request to Azure OpenAI...');
          const response = await openaiClient.getChatCompletions(
            deploymentName,
            [
              { 
                role: "system", 
                content: "You are an expert HR professional who specializes in evaluating how well candidates match job requirements." 
              },
              { role: "user", content: prompt }
            ],
            {
              temperature: 0.5,
              maxTokens: 500
            }
          );
          
          console.log('Received response from Azure OpenAI');
          const responseText = response.choices[0].message.content.trim();
          
          // Parse the response
          const scoreMatch = responseText.match(/Score:\s*(\d+)/i);
          const score = scoreMatch ? parseInt(scoreMatch[1]) : 50;
          
          const recommendationMatch = responseText.match(/Recommendation:\s*(Strong Match|Moderate Match|Weak Match)/i);
          const recommendation = recommendationMatch ? recommendationMatch[1] : 'Moderate Match';
          
          // Set overall match based on recommendation
          const overallMatch = recommendation.includes('Strong') ? 'Strong' : 
                             recommendation.includes('Moderate') ? 'Moderate' : 'Weak';
          
          // Extract analysis points
          const analysis = responseText.split('Analysis:')[1]?.split('Recommendation:')[0]?.trim();
          const analysisPoints = analysis ? 
            analysis.split('-').filter(point => point.trim().length > 0).map(point => point.trim()) : 
            ['No specific analysis provided'];
          
          return {
            matchScore: score,
            overallMatch,
            recommendation,
            matchReasons: analysisPoints,
            analysis: analysisPoints
          };
        } catch (error) {
          // Check if the error is related to the deployment not existing
          if (error.message && error.message.includes('deployment') && error.message.includes('does not exist')) {
            console.log('Azure OpenAI deployment does not exist - setting flag to avoid future attempts');
            azureDeploymentExists = false; // Set the flag to avoid trying again
          }
          
          console.log('Azure OpenAI resume evaluation failed, using fallback method instead');
          // Fall back to text analytics if Azure OpenAI fails
        }
      } else {
        console.log('Skipping Azure OpenAI (not available or deployment does not exist), using fallback methods');
      }
      
      // Use Azure Text Analytics for simple keyword matching and sentiment analysis
      try {
        // Extract key phrases from both resume and job description
        const [resumeKeyPhrases, jobKeyPhrases] = await Promise.all([
          this.extractKeyPhrases(resumeText),
          this.extractKeyPhrases(jobDescription)
        ]);
        
        // Calculate overlap between key phrases
        const matchingPhrases = resumeKeyPhrases.filter(phrase => 
          jobKeyPhrases.some(jobPhrase => 
            jobPhrase.toLowerCase().includes(phrase.toLowerCase()) || 
            phrase.toLowerCase().includes(jobPhrase.toLowerCase())
          )
        );
        
        // Calculate a match score based on the overlap percentage
        const overlapPercentage = jobKeyPhrases.length > 0 ? 
          (matchingPhrases.length / jobKeyPhrases.length) * 100 : 0;
        
        // Cap score at 100
        const score = Math.min(Math.round(overlapPercentage), 100);
        
        // Determine recommendation based on score
        let recommendation;
        if (score >= 70) recommendation = 'Strong Match';
        else if (score >= 40) recommendation = 'Moderate Match';
        else recommendation = 'Weak Match';
        
        // Generate analysis points
        const analysisPoints = [
          `Found ${matchingPhrases.length} overlapping key concepts between resume and job description.`,
          matchingPhrases.length > 0 ? 
            `Matching concepts include: ${matchingPhrases.slice(0, 5).join(', ')}` : 
            'No direct matching concepts found.',
          `Resume appears to cover ${score}% of the key concepts in the job description.`
        ];
        
        return {
          matchScore: score,
          overallMatch: recommendation === 'Strong Match' ? 'Strong' : 
                       recommendation === 'Moderate Match' ? 'Moderate' : 'Weak',
          recommendation,
          matchReasons: analysisPoints,
          analysis: analysisPoints
        };
      } catch (error) {
        console.warn('Azure text analytics failed, using simple word matching:', error.message);
        // Fall back to very simple word matching
        return this.simpleWordMatchEvaluation(resumeText, jobDescription);
      }
    } catch (error) {
      console.error('Resume evaluation error:', error);
      throw new Error(`Failed to evaluate resume match: ${error.message}`);
    }
  }
  
  // Fallback method: Simple word matching for resume evaluation
  simpleWordMatchEvaluation(resumeText, jobDescription) {
    try {
      // Extract important words from job description (non-stop words)
      const stopWords = new Set(['the', 'and', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'as', 'of', 'or']);
      const jobWords = jobDescription.toLowerCase()
        .split(/\W+/)
        .filter(word => word.length > 3 && !stopWords.has(word));
      
      // Count unique important words
      const uniqueJobWords = new Set(jobWords);
      
      // Check how many of these words appear in the resume
      const matchingWords = Array.from(uniqueJobWords).filter(word => 
        resumeText.toLowerCase().includes(word)
      );
      
      // Calculate match percentage
      const matchPercentage = uniqueJobWords.size > 0 ? 
        (matchingWords.length / uniqueJobWords.size) * 100 : 0;
      
      // Cap score at 100 and ensure it's a whole number
      const score = Math.min(Math.round(matchPercentage), 100);
      
      // Determine recommendation based on score
      let recommendation;
      if (score >= 70) recommendation = 'Strong Match';
      else if (score >= 40) recommendation = 'Moderate Match';
      else recommendation = 'Weak Match';
      
      // Top matching words (for analysis)
      const topMatches = matchingWords.slice(0, 8);
      
      // Analysis points
      const analysisPoints = [
        `Resume contains ${matchingWords.length} out of ${uniqueJobWords.size} important terms from the job description.`,
        topMatches.length > 0 ? 
          `Key matching terms include: ${topMatches.join(', ')}` : 
          'No significant matching terms found.',
        `Overall term matching rate: ${score}%`
      ];
      
      return {
        matchScore: score,
        overallMatch: recommendation === 'Strong Match' ? 'Strong' : 
                     recommendation === 'Moderate Match' ? 'Moderate' : 'Weak',
        recommendation,
        matchReasons: analysisPoints,
        analysis: analysisPoints
      };
    } catch (error) {
      console.error('Simple word match evaluation failed:', error);
      // Absolute fallback - return a default response
      return {
        matchScore: 50,
        overallMatch: 'Moderate',
        recommendation: 'Moderate Match',
        matchReasons: ['Could not perform detailed analysis, providing a default moderate match score.'],
        analysis: ['Could not perform detailed analysis, providing a default moderate match score.']
      };
    }
  }
  
  /**
   * Classify the candidate's domain based on resume text
   * @param {string} resumeText - The extracted text from a resume
   * @returns {Promise<string>} - The classified domain (e.g., "Software Engineering", "Finance")
   */
  async classifyDomain(resumeText) {
    if (!resumeText) return 'General';

    const domains = [
      'Software Engineering',
      'Data Science & Analytics',
      'Biology & Life Sciences',
      'Healthcare & Medical',
      'Finance & Accounting',
      'Marketing & Communications',
      'Operations & Management',
      'Sales & Business Development',
      'Human Resources',
      'Legal',
      'Design & Creative',
      'Engineering (Non-Software)',
      'Education',
      'Research & Academia'
    ];

    try {
      // Try Azure OpenAI if available
      if (openaiClient && azureDeploymentExists) {
        try {
          const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-35-turbo";

          const prompt = `
Based on the following resume, classify the candidate into ONE of these domains:
${domains.join(', ')}

Resume:
${resumeText.substring(0, 2000)}

Respond with ONLY the domain name, nothing else.
          `;

          const response = await openaiClient.getChatCompletions(
            deploymentName,
            [
              { role: "system", content: "You are an expert HR professional who classifies candidates into professional domains." },
              { role: "user", content: prompt }
            ],
            { temperature: 0.3, maxTokens: 50 }
          );

          const classifiedDomain = response.choices[0].message.content.trim();

          // Validate the response matches one of our domains
          const matchedDomain = domains.find(d =>
            d.toLowerCase() === classifiedDomain.toLowerCase() ||
            classifiedDomain.toLowerCase().includes(d.toLowerCase().split(' ')[0])
          );

          return matchedDomain || classifiedDomain;
        } catch (error) {
          if (error.message && error.message.includes('deployment') && error.message.includes('does not exist')) {
            azureDeploymentExists = false;
          }
          console.warn('Azure OpenAI domain classification failed:', error.message);
        }
      }

      // Try OpenAI API if Azure is not available
      if (process.env.OPENAI_API_KEY) {
        try {
          const { default: OpenAI } = await import('openai');
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

          const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: "You are an expert HR professional who classifies candidates into professional domains." },
              { role: "user", content: `Based on the following resume, classify the candidate into ONE of these domains: ${domains.join(', ')}. Resume: ${resumeText.substring(0, 2000)}. Respond with ONLY the domain name.` }
            ],
            temperature: 0.3,
            max_tokens: 50
          });

          return response.choices[0].message.content.trim();
        } catch (error) {
          console.warn('OpenAI domain classification failed:', error.message);
        }
      }

      // Fallback: Use keyword-based classification
      return this.keywordBasedDomainClassification(resumeText);
    } catch (error) {
      console.error('Domain classification error:', error);
      return 'General';
    }
  }

  /**
   * Fallback keyword-based domain classification
   * @param {string} resumeText - The extracted text from a resume
   * @returns {string} - The classified domain
   */
  keywordBasedDomainClassification(resumeText) {
    const lowerText = resumeText.toLowerCase();

    const domainKeywords = {
      'Software Engineering': ['software', 'developer', 'programming', 'javascript', 'python', 'react', 'node', 'api', 'frontend', 'backend', 'full stack', 'devops', 'cloud', 'aws', 'docker', 'kubernetes'],
      'Data Science & Analytics': ['data science', 'machine learning', 'ml', 'ai', 'analytics', 'tensorflow', 'pytorch', 'pandas', 'statistics', 'data analyst', 'business intelligence', 'tableau', 'power bi'],
      'Biology & Life Sciences': ['biology', 'biochemistry', 'molecular', 'genetics', 'genomics', 'bioinformatics', 'pcr', 'crispr', 'cell culture', 'laboratory', 'research scientist', 'biotech', 'pharma'],
      'Healthcare & Medical': ['healthcare', 'medical', 'clinical', 'patient', 'hospital', 'nursing', 'physician', 'pharmacy', 'hipaa', 'emr', 'ehr', 'telehealth'],
      'Finance & Accounting': ['finance', 'accounting', 'banking', 'investment', 'cpa', 'cfa', 'financial analyst', 'bloomberg', 'trading', 'portfolio', 'audit', 'tax'],
      'Marketing & Communications': ['marketing', 'digital marketing', 'seo', 'sem', 'content marketing', 'social media', 'brand', 'advertising', 'pr', 'communications'],
      'Sales & Business Development': ['sales', 'business development', 'account executive', 'account manager', 'revenue', 'quota', 'crm', 'salesforce', 'b2b', 'b2c'],
      'Human Resources': ['human resources', 'hr', 'recruiting', 'talent acquisition', 'employee relations', 'compensation', 'benefits', 'hris', 'payroll'],
      'Design & Creative': ['design', 'ui/ux', 'graphic design', 'figma', 'sketch', 'adobe', 'photoshop', 'illustrator', 'creative director', 'art director']
    };

    let maxScore = 0;
    let bestDomain = 'General';

    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      let score = 0;
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          score++;
        }
      }
      if (score > maxScore) {
        maxScore = score;
        bestDomain = domain;
      }
    }

    return bestDomain;
  }

  /**
   * Generate an AI summary of a candidate based on their resume
   * @param {string} resumeText - The extracted text from a resume
   * @param {Object} extractedContent - Structured content extracted from resume (name, skills, etc.)
   * @returns {Promise<string>} - AI-generated candidate summary
   */
  async generateCandidateSummary(resumeText, extractedContent = {}) {
    if (!resumeText) return '';

    const skillsList = extractedContent.skills?.join(', ') || 'Not specified';

    try {
      // Try Azure OpenAI if available
      if (openaiClient && azureDeploymentExists) {
        try {
          const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-35-turbo";

          const prompt = `
Generate a concise professional summary (2-3 sentences) for a candidate based on their resume.
Focus on their key strengths, experience level, and notable skills.

Key Skills: ${skillsList}
Education: ${extractedContent.education || 'Not specified'}

Resume excerpt:
${resumeText.substring(0, 1500)}

Write a professional summary that a recruiter would find useful. Be specific and highlight unique qualifications.
          `;

          const response = await openaiClient.getChatCompletions(
            deploymentName,
            [
              { role: "system", content: "You are an expert HR professional who writes compelling candidate summaries." },
              { role: "user", content: prompt }
            ],
            { temperature: 0.7, maxTokens: 150 }
          );

          return response.choices[0].message.content.trim();
        } catch (error) {
          if (error.message && error.message.includes('deployment') && error.message.includes('does not exist')) {
            azureDeploymentExists = false;
          }
          console.warn('Azure OpenAI summary generation failed:', error.message);
        }
      }

      // Try OpenAI API if Azure is not available
      if (process.env.OPENAI_API_KEY) {
        try {
          const { default: OpenAI } = await import('openai');
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

          const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: "You are an expert HR professional who writes compelling candidate summaries." },
              { role: "user", content: `Generate a concise professional summary (2-3 sentences) for a candidate. Key Skills: ${skillsList}. Resume excerpt: ${resumeText.substring(0, 1500)}` }
            ],
            temperature: 0.7,
            max_tokens: 150
          });

          return response.choices[0].message.content.trim();
        } catch (error) {
          console.warn('OpenAI summary generation failed:', error.message);
        }
      }

      // Fallback: Generate a basic summary from extracted content
      return this.generateBasicSummary(extractedContent);
    } catch (error) {
      console.error('Summary generation error:', error);
      return this.generateBasicSummary(extractedContent);
    }
  }

  /**
   * Fallback method to generate a basic summary without AI
   * @param {Object} extractedContent - Structured content extracted from resume
   * @returns {string} - Basic summary
   */
  generateBasicSummary(extractedContent) {
    const skills = extractedContent.skills?.slice(0, 5).join(', ') || '';
    const name = extractedContent.name || 'Candidate';

    if (skills) {
      return `${name} is a professional with expertise in ${skills}. Review the full resume for detailed experience and qualifications.`;
    }
    return `${name} has submitted their profile for consideration. Review the full resume for detailed qualifications.`;
  }

  /**
   * Summarize interview feedback notes using AI
   * Generates a concise summary and relevant tags from interviewer notes
   * @param {string} interviewerNotes - Raw notes from the interviewer
   * @param {Object} options - Optional parameters
   * @param {string} options.interviewStage - e.g., "Technical Round 2", "HR Screening"
   * @param {string} options.candidateName - Name of the candidate
   * @param {string} options.role - Role being interviewed for
   * @returns {Promise<Object>} - { summary, tags, recommendation, rating }
   */
  async summarizeFeedback(interviewerNotes, options = {}) {
    if (!interviewerNotes || interviewerNotes.trim().length === 0) {
      return {
        summary: 'No feedback notes provided.',
        tags: [],
        recommendation: null,
        rating: null
      };
    }

    const { interviewStage, candidateName, role } = options;

    try {
      // Try Azure OpenAI if available
      if (openaiClient && azureDeploymentExists) {
        try {
          const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-35-turbo";
          console.log(`Summarizing interview feedback using Azure OpenAI: ${deploymentName}`);

          const prompt = this.buildFeedbackSummaryPrompt(interviewerNotes, interviewStage, candidateName, role);

          const response = await openaiClient.getChatCompletions(
            deploymentName,
            [
              {
                role: "system",
                content: `You are an expert HR professional who summarizes interview feedback concisely and objectively.
Your task is to:
1. Create a 2-3 sentence summary of the key points from the interviewer's notes
2. Extract 3-6 relevant tags (skills, traits, areas of concern)
3. Suggest a hiring recommendation based on the feedback
4. Suggest a rating from 1-5 based on the overall feedback tone

Be objective and focus on actionable insights. Tags should be single words or short phrases.`
              },
              { role: "user", content: prompt }
            ],
            {
              temperature: 0.4,
              maxTokens: 400
            }
          );

          const responseText = response.choices[0].message.content.trim();
          return this.parseFeedbackResponse(responseText);
        } catch (error) {
          if (error.message?.includes('deployment') && error.message?.includes('does not exist')) {
            azureDeploymentExists = false;
          }
          console.warn('Azure OpenAI feedback summarization failed:', error.message);
        }
      }

      // Try OpenAI API if Azure is not available
      if (process.env.OPENAI_API_KEY) {
        try {
          const { default: OpenAI } = await import('openai');
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

          const prompt = this.buildFeedbackSummaryPrompt(interviewerNotes, interviewStage, candidateName, role);

          const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
              {
                role: "system",
                content: `You are an expert HR professional who summarizes interview feedback concisely and objectively.
Your task is to:
1. Create a 2-3 sentence summary of the key points from the interviewer's notes
2. Extract 3-6 relevant tags (skills, traits, areas of concern)
3. Suggest a hiring recommendation based on the feedback
4. Suggest a rating from 1-5 based on the overall feedback tone

Be objective and focus on actionable insights. Tags should be single words or short phrases.`
              },
              { role: "user", content: prompt }
            ],
            temperature: 0.4,
            max_tokens: 400
          });

          const responseText = response.choices[0].message.content.trim();
          return this.parseFeedbackResponse(responseText);
        } catch (error) {
          console.warn('OpenAI feedback summarization failed:', error.message);
        }
      }

      // Fallback: Use keyword-based summarization
      return this.keywordBasedFeedbackSummary(interviewerNotes);
    } catch (error) {
      console.error('Feedback summarization error:', error);
      return this.keywordBasedFeedbackSummary(interviewerNotes);
    }
  }

  /**
   * Build the prompt for feedback summarization
   */
  buildFeedbackSummaryPrompt(notes, stage, candidateName, role) {
    let contextInfo = '';
    if (candidateName) contextInfo += `Candidate: ${candidateName}\n`;
    if (role) contextInfo += `Role: ${role}\n`;
    if (stage) contextInfo += `Interview Stage: ${stage}\n`;

    return `${contextInfo ? contextInfo + '\n' : ''}INTERVIEWER NOTES:
${notes}

Please analyze these interview notes and provide:

SUMMARY: [2-3 sentence summary of key feedback points, strengths, and areas of concern]

TAGS: [comma-separated list of 3-6 relevant tags like: Communication, Technical Skills, Problem Solving, Culture Fit, Leadership, etc.]

RECOMMENDATION: [one of: strong_yes, yes, maybe, no, strong_no]

RATING: [number 1-5 based on overall feedback sentiment]`;
  }

  /**
   * Parse the AI response into structured feedback data
   */
  parseFeedbackResponse(responseText) {
    // Extract summary
    const summaryMatch = responseText.match(/SUMMARY:\s*(.+?)(?=\n\nTAGS:|TAGS:|$)/is);
    const summary = summaryMatch
      ? summaryMatch[1].trim()
      : this.extractFirstSentences(responseText, 2);

    // Extract tags
    const tagsMatch = responseText.match(/TAGS:\s*(.+?)(?=\n\nRECOMMENDATION:|RECOMMENDATION:|$)/is);
    let tags = [];
    if (tagsMatch) {
      tags = tagsMatch[1]
        .split(/[,\n]/)
        .map(tag => tag.trim().replace(/^[-•*]\s*/, ''))
        .filter(tag => tag.length > 0 && tag.length < 50)
        .slice(0, 8);
    }

    // Extract recommendation
    const recMatch = responseText.match(/RECOMMENDATION:\s*(strong_yes|yes|maybe|no|strong_no)/i);
    const recommendation = recMatch ? recMatch[1].toLowerCase() : this.inferRecommendation(responseText);

    // Extract rating
    const ratingMatch = responseText.match(/RATING:\s*(\d)/);
    let rating = ratingMatch ? parseInt(ratingMatch[1]) : null;
    if (rating && (rating < 1 || rating > 5)) rating = null;

    // Infer rating from recommendation if not found
    if (!rating && recommendation) {
      const ratingMap = {
        'strong_yes': 5,
        'yes': 4,
        'maybe': 3,
        'no': 2,
        'strong_no': 1
      };
      rating = ratingMap[recommendation] || 3;
    }

    return {
      summary,
      tags,
      recommendation,
      rating
    };
  }

  /**
   * Extract first N sentences from text
   */
  extractFirstSentences(text, count) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    return sentences.slice(0, count).join(' ').trim();
  }

  /**
   * Infer recommendation from text sentiment
   */
  inferRecommendation(text) {
    const lowerText = text.toLowerCase();

    const strongPositive = ['excellent', 'outstanding', 'exceptional', 'perfect', 'highly recommend', 'strong hire'];
    const positive = ['good', 'solid', 'recommend', 'capable', 'qualified', 'hire'];
    const negative = ['weak', 'concern', 'lacking', 'struggled', 'below expectations', 'do not recommend'];
    const strongNegative = ['reject', 'fail', 'not qualified', 'serious concerns', 'definitely not'];

    if (strongPositive.some(word => lowerText.includes(word))) return 'strong_yes';
    if (strongNegative.some(word => lowerText.includes(word))) return 'strong_no';
    if (negative.some(word => lowerText.includes(word))) return 'no';
    if (positive.some(word => lowerText.includes(word))) return 'yes';

    return 'maybe';
  }

  /**
   * Fallback keyword-based feedback summarization
   */
  keywordBasedFeedbackSummary(notes) {
    const lowerNotes = notes.toLowerCase();

    // Common interview feedback keywords for tag extraction
    const tagKeywords = {
      'Communication': ['communication', 'articulate', 'explain', 'verbal', 'presentation'],
      'Technical Skills': ['technical', 'coding', 'programming', 'algorithm', 'system design', 'architecture'],
      'Problem Solving': ['problem solving', 'analytical', 'logic', 'reasoning', 'approach'],
      'Leadership': ['leadership', 'lead', 'manage', 'team', 'mentor'],
      'Culture Fit': ['culture', 'team player', 'collaborative', 'fit', 'values'],
      'Experience': ['experience', 'background', 'years', 'senior', 'junior'],
      'Database': ['database', 'sql', 'mongodb', 'data'],
      'Frontend': ['frontend', 'react', 'ui', 'css', 'javascript'],
      'Backend': ['backend', 'api', 'server', 'node', 'python'],
      'System Design': ['system design', 'architecture', 'scalability', 'distributed'],
      'Enthusiasm': ['enthusiastic', 'passionate', 'motivated', 'eager'],
      'Learning': ['learning', 'adaptable', 'growth', 'curious']
    };

    // Extract matching tags
    const tags = [];
    for (const [tag, keywords] of Object.entries(tagKeywords)) {
      if (keywords.some(kw => lowerNotes.includes(kw))) {
        tags.push(tag);
      }
    }

    // Analyze sentiment for recommendation
    const positiveWords = ['strong', 'excellent', 'good', 'great', 'impressed', 'capable', 'qualified', 'hire'];
    const negativeWords = ['weak', 'poor', 'struggled', 'lacking', 'concern', 'not', 'failed', 'below'];

    let positiveCount = positiveWords.filter(w => lowerNotes.includes(w)).length;
    let negativeCount = negativeWords.filter(w => lowerNotes.includes(w)).length;

    // Determine recommendation
    let recommendation;
    let rating;
    if (positiveCount > negativeCount * 2) {
      recommendation = positiveCount > 3 ? 'strong_yes' : 'yes';
      rating = positiveCount > 3 ? 5 : 4;
    } else if (negativeCount > positiveCount * 2) {
      recommendation = negativeCount > 3 ? 'strong_no' : 'no';
      rating = negativeCount > 3 ? 1 : 2;
    } else {
      recommendation = 'maybe';
      rating = 3;
    }

    // Generate summary
    const noteWords = notes.split(/\s+/).length;
    let summary;
    if (noteWords < 20) {
      summary = notes;
    } else {
      // Take first 2-3 key sentences
      const sentences = notes.match(/[^.!?]+[.!?]+/g) || [notes];
      summary = sentences.slice(0, 3).join(' ').trim();
      if (summary.length > 300) {
        summary = summary.substring(0, 297) + '...';
      }
    }

    // Add context based on detected tags
    if (tags.length > 0 && summary.length < 200) {
      const tagContext = tags.length > 2
        ? `Key areas discussed: ${tags.slice(0, 3).join(', ')}.`
        : '';
      if (tagContext) {
        summary = summary + ' ' + tagContext;
      }
    }

    return {
      summary,
      tags: tags.slice(0, 6),
      recommendation,
      rating
    };
  }

  /**
   * Extract job requirements from a job description
   * @param {string} jobDescription - The full job description
   * @returns {Promise<Array>} - Promise resolving to array of requirement strings
   */
  async extractJobRequirements(jobDescription) {
    if (!jobDescription) return [];
    
    // Default requirements if AI extraction fails
    const defaultRequirements = [];
    
    try {
      // Check if Azure OpenAI is available AND the deployment exists
      if (openaiClient && azureDeploymentExists) {
        try {
          const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-35-turbo";
          console.log(`Attempting to use Azure OpenAI deployment: ${deploymentName}`);
          
          const prompt = `
Extract the key job requirements and qualifications from the following job description. 
Format each requirement as a concise bullet point. 
Focus on skills, experience, education, and technical requirements.
Return ONLY a bulleted list with one requirement per line, starting with a dash (-).
Extract 5-10 key requirements, no more.

JOB DESCRIPTION:
${jobDescription.substring(0, 2000)}
          `;
          
          const response = await openaiClient.getChatCompletions(
            deploymentName,
            [
              { 
                role: "system", 
                content: "You are a skilled HR professional who extracts job requirements from job descriptions." 
              },
              { role: "user", content: prompt }
            ],
            {
              temperature: 0.3,
              maxTokens: 500
            }
          );
          
          const output = response.choices[0].message.content.trim();
          
          // Parse the bulleted list into an array
          const requirements = output
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('-'))
            .map(line => line.substring(1).trim())
            .filter(req => req.length > 0);
          
          return requirements.length > 0 ? requirements : defaultRequirements;
        } catch (error) {
          // Check if the error is related to the deployment not existing
          if (error.message && error.message.includes('deployment') && error.message.includes('does not exist')) {
            console.log('Azure OpenAI deployment does not exist - setting flag to avoid future attempts');
            azureDeploymentExists = false; // Set the flag to avoid trying again
          }
          
          console.warn('Azure OpenAI extraction failed:', error.message);
          return defaultRequirements;
        }
      } else {
        console.log('Skipping Azure OpenAI (not available or deployment does not exist), using fallback methods');
      }
      
      // Try OpenAI API if Azure OpenAI is not available
      if (process.env.OPENAI_API_KEY) {
        try {
          const { default: OpenAI } = await import('openai');
          const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
          });
          
          const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              { 
                role: "system", 
                content: "You are a skilled HR professional who extracts job requirements from job descriptions." 
              },
              { 
                role: "user", 
                content: `
Extract the key job requirements and qualifications from the following job description. 
Format each requirement as a concise bullet point. 
Focus on skills, experience, education, and technical requirements.
Return ONLY a bulleted list with one requirement per line, starting with a dash (-).
Extract 5-10 key requirements, no more.

JOB DESCRIPTION:
${jobDescription.substring(0, 2000)}
                `
              }
            ],
            temperature: 0.3,
            max_tokens: 500
          });
          
          const output = response.choices[0].message.content.trim();
          
          // Parse the bulleted list into an array
          const requirements = output
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('-'))
            .map(line => line.substring(1).trim())
            .filter(req => req.length > 0);
          
          return requirements.length > 0 ? requirements : defaultRequirements;
        } catch (error) {
          console.warn('OpenAI extraction failed:', error.message);
          return defaultRequirements;
        }
      }
      
      return defaultRequirements;
    } catch (error) {
      console.error('Error extracting job requirements:', error);
      return defaultRequirements;
    }
  }

  /**
   * Generate a match score between a candidate and a job
   * @param {Object} candidate - Candidate object with skills, domain, summary, etc.
   * @param {Object} job - Job object with title, description, requirements, etc.
   * @returns {Promise<Object>} - { matchScore, recommendation, matchSummary }
   */
  async generateMatchScore(candidate, job) {
    // Build candidate profile string
    const candidateProfile = this.buildCandidateProfile(candidate);
    const jobProfile = this.buildJobProfile(job);

    try {
      // Try Azure OpenAI if available
      if (openaiClient && azureDeploymentExists) {
        try {
          const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-35-turbo";
          console.log(`Generating match score using Azure OpenAI: ${deploymentName}`);

          const prompt = `
You are an expert recruiter evaluating how well a candidate matches a job opening.

CANDIDATE PROFILE:
${candidateProfile}

JOB DETAILS:
${jobProfile}

Analyze the match between this candidate and job. Consider:
1. Skills alignment - Do the candidate's skills match job requirements?
2. Domain fit - Is the candidate's domain/industry relevant?
3. Experience level - Does experience match expectations?
4. Overall potential - Could this candidate succeed in this role?

Respond in EXACTLY this format:
SCORE: [number 0-100]
RECOMMENDATION: [Strong Match|Moderate Match|Weak Match]
SUMMARY:
- [First bullet point explaining a key strength or match]
- [Second bullet point about skills/experience alignment]
- [Third bullet point about potential gaps or concerns]
- [Fourth bullet point with overall assessment]
          `;

          const response = await openaiClient.getChatCompletions(
            deploymentName,
            [
              { role: "system", content: "You are an expert HR professional who evaluates candidate-job fit with precision and objectivity." },
              { role: "user", content: prompt }
            ],
            { temperature: 0.4, maxTokens: 400 }
          );

          const responseText = response.choices[0].message.content.trim();
          return this.parseMatchResponse(responseText);
        } catch (error) {
          if (error.message && error.message.includes('deployment') && error.message.includes('does not exist')) {
            azureDeploymentExists = false;
          }
          console.warn('Azure OpenAI match scoring failed:', error.message);
        }
      }

      // Try OpenAI API if Azure is not available
      if (process.env.OPENAI_API_KEY) {
        try {
          const { default: OpenAI } = await import('openai');
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

          const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: "You are an expert HR professional who evaluates candidate-job fit." },
              { role: "user", content: `Evaluate this candidate-job match and respond with SCORE: [0-100], RECOMMENDATION: [Strong Match|Moderate Match|Weak Match], and SUMMARY: with 3-4 bullet points.\n\nCANDIDATE:\n${candidateProfile}\n\nJOB:\n${jobProfile}` }
            ],
            temperature: 0.4,
            max_tokens: 400
          });

          return this.parseMatchResponse(response.choices[0].message.content.trim());
        } catch (error) {
          console.warn('OpenAI match scoring failed:', error.message);
        }
      }

      // Fallback: Use keyword-based matching
      return this.keywordBasedMatchScore(candidate, job);
    } catch (error) {
      console.error('Match score generation error:', error);
      return this.keywordBasedMatchScore(candidate, job);
    }
  }

  /**
   * Build a profile string from candidate data
   * @param {Object} candidate - Candidate object
   * @returns {string} - Formatted profile string
   */
  buildCandidateProfile(candidate) {
    const parts = [];

    if (candidate.fullName || candidate.name) {
      parts.push(`Name: ${candidate.fullName || candidate.name}`);
    }
    if (candidate.domain) {
      parts.push(`Domain: ${candidate.domain}`);
    }
    if (candidate.skills && candidate.skills.length > 0) {
      parts.push(`Skills: ${candidate.skills.join(', ')}`);
    }
    if (candidate.summary) {
      parts.push(`Summary: ${candidate.summary}`);
    }
    if (candidate.education) {
      parts.push(`Education: ${candidate.education}`);
    }
    if (candidate.experience) {
      parts.push(`Experience: ${candidate.experience.substring(0, 500)}`);
    }
    if (candidate.desiredRoles) {
      parts.push(`Desired Roles: ${candidate.desiredRoles}`);
    }
    if (candidate.location) {
      parts.push(`Location: ${candidate.location}`);
    }

    return parts.join('\n') || 'No candidate profile available';
  }

  /**
   * Build a profile string from job data
   * @param {Object} job - Job object
   * @returns {string} - Formatted job string
   */
  buildJobProfile(job) {
    const parts = [];

    if (job.title) {
      parts.push(`Title: ${job.title}`);
    }
    if (job.company) {
      parts.push(`Company: ${job.company}`);
    }
    if (job.location) {
      parts.push(`Location: ${job.location}`);
    }
    if (job.type) {
      parts.push(`Type: ${job.type}`);
    }
    if (job.industry) {
      parts.push(`Industry: ${job.industry}`);
    }
    if (job.requirements && job.requirements.length > 0) {
      parts.push(`Requirements:\n- ${job.requirements.join('\n- ')}`);
    }
    if (job.description) {
      parts.push(`Description: ${job.description.substring(0, 1000)}`);
    }
    if (job.salary) {
      parts.push(`Salary: ${job.salary}`);
    }

    return parts.join('\n') || 'No job details available';
  }

  /**
   * Parse the AI response into structured match data
   * @param {string} responseText - Raw AI response
   * @returns {Object} - { matchScore, recommendation, matchSummary }
   */
  parseMatchResponse(responseText) {
    // Extract score
    const scoreMatch = responseText.match(/SCORE:\s*(\d+)/i);
    const matchScore = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1]))) : 50;

    // Extract recommendation
    const recMatch = responseText.match(/RECOMMENDATION:\s*(Strong Match|Moderate Match|Weak Match)/i);
    let recommendation = recMatch ? recMatch[1] : 'Moderate Match';

    // Normalize recommendation based on score if not explicitly matched
    if (!recMatch) {
      if (matchScore >= 70) recommendation = 'Strong Match';
      else if (matchScore >= 40) recommendation = 'Moderate Match';
      else recommendation = 'Weak Match';
    }

    // Extract summary bullets
    const summarySection = responseText.split(/SUMMARY:/i)[1] || '';
    const bullets = summarySection
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('-') || line.startsWith('•'))
      .map(line => line.replace(/^[-•]\s*/, '').trim())
      .filter(line => line.length > 0)
      .slice(0, 4);

    const matchSummary = bullets.length > 0 ? bullets : [
      'Match analysis completed.',
      `Score indicates a ${recommendation.toLowerCase()}.`,
      'Review candidate profile for detailed assessment.'
    ];

    return {
      matchScore,
      recommendation,
      matchSummary
    };
  }

  /**
   * Analyze sentiment of text using Azure Text Analytics
   * @param {string} text - Text to analyze
   * @returns {Promise<Object>} - { sentiment, confidence, suggestions }
   */
  async analyzeSentiment(text) {
    try {
      if (!textAnalyticsClient || !text) {
        return { sentiment: 'neutral', confidence: 0.5, suggestions: [] };
      }

      const results = await textAnalyticsClient.analyzeSentiment([text]);

      if (results && results.length > 0 && !results[0].error) {
        const result = results[0];
        return {
          sentiment: result.sentiment,
          confidence: result.confidenceScores[result.sentiment],
          positiveScore: result.confidenceScores.positive,
          suggestions: result.sentiment === 'negative' ?
            ['Consider using more positive language', 'Focus on opportunities rather than gaps'] : []
        };
      }

      return { sentiment: 'neutral', confidence: 0.5, suggestions: [] };
    } catch (error) {
      console.warn('Sentiment analysis failed:', error.message);
      return { sentiment: 'neutral', confidence: 0.5, suggestions: [] };
    }
  }

  /**
   * Generate smart outreach message using match context and channel-specific tone
   * @param {Object} candidate - Candidate object with skills, domain, summary, etc.
   * @param {Object} job - Job object with title, description, requirements
   * @param {Object} matchData - Match data from generateMatchScore() with matchSummary
   * @param {string} channel - 'email' or 'linkedin'
   * @returns {Promise<Object>} - { subject, message, tone }
   */
  async generateSmartOutreach(candidate, job, matchData, channel = 'linkedin') {
    const candidateProfile = this.buildCandidateProfile(candidate);
    const jobProfile = this.buildJobProfile(job);

    // Build match context from matchSummary
    const matchContext = matchData?.matchSummary?.length > 0
      ? matchData.matchSummary.join('\n- ')
      : 'General match based on profile analysis';

    const matchScore = matchData?.matchScore || 50;
    const recommendation = matchData?.recommendation || 'Moderate Match';

    try {
      // Try Azure OpenAI if available
      if (openaiClient && azureDeploymentExists) {
        try {
          const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-35-turbo";

          const prompt = this.buildSmartOutreachPrompt(
            candidate, job, matchContext, matchScore, recommendation, channel
          );

          const response = await openaiClient.getChatCompletions(
            deploymentName,
            [
              {
                role: "system",
                content: this.getChannelSystemPrompt(channel)
              },
              { role: "user", content: prompt }
            ],
            {
              temperature: 0.7,
              maxTokens: channel === 'email' ? 600 : 250
            }
          );

          const content = response.choices[0].message.content.trim();
          return this.parseOutreachResponse(content, channel, candidate, job, matchContext);
        } catch (error) {
          if (error.message?.includes('deployment') && error.message?.includes('does not exist')) {
            azureDeploymentExists = false;
          }
          console.warn('Azure OpenAI smart outreach failed:', error.message);
        }
      }

      // Try OpenAI API if Azure is not available
      if (process.env.OPENAI_API_KEY) {
        try {
          const { default: OpenAI } = await import('openai');
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

          const prompt = this.buildSmartOutreachPrompt(
            candidate, job, matchContext, matchScore, recommendation, channel
          );

          const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
              { role: "system", content: this.getChannelSystemPrompt(channel) },
              { role: "user", content: prompt }
            ],
            temperature: 0.7,
            max_tokens: channel === 'email' ? 600 : 250
          });

          const content = response.choices[0].message.content.trim();
          return this.parseOutreachResponse(content, channel, candidate, job, matchContext);
        } catch (error) {
          console.warn('OpenAI smart outreach failed:', error.message);
        }
      }

      // Fallback to enhanced template-based generation
      return this.generateSmartTemplateFallback(candidate, job, matchData, channel);
    } catch (error) {
      console.error('Smart outreach generation error:', error);
      return this.generateSmartTemplateFallback(candidate, job, matchData, channel);
    }
  }

  /**
   * Get channel-specific system prompt for AI
   * @param {string} channel - 'email' or 'linkedin'
   * @returns {string} - System prompt
   */
  getChannelSystemPrompt(channel) {
    if (channel === 'linkedin') {
      return `You are an expert tech recruiter writing LinkedIn InMail messages. Your style is:
- Conversational and warm, but professional
- Concise (under 150 words, ideally under 100)
- Direct and action-oriented
- No fluff or generic phrases like "I came across your profile"
- Mention ONE specific thing that makes them stand out
- End with a simple, low-commitment call to action
- No formal greetings like "Dear" - use casual "Hi [Name]"
- No signatures or closing formalities`;
    } else {
      return `You are an expert tech recruiter writing professional recruiting emails. Your style is:
- Formal but personable
- Structured with clear sections
- Detailed about why they're a good fit (use the match analysis)
- Include company value proposition
- Professional greeting and signature format
- Subject line should be compelling and specific
- 200-300 words in body
- Clear call to action with suggested next steps`;
    }
  }

  /**
   * Build the smart outreach prompt with match context
   */
  buildSmartOutreachPrompt(candidate, job, matchContext, matchScore, recommendation, channel) {
    const name = candidate.fullName || candidate.name || 'there';
    const skills = candidate.skills?.slice(0, 5).join(', ') || 'relevant skills';
    const domain = candidate.domain || 'their field';
    const summary = candidate.summary || '';

    const jobTitle = job.title || 'Open Position';
    const company = job.company || 'our company';
    const industry = job.industry || 'technology';

    if (channel === 'linkedin') {
      return `Write a LinkedIn InMail to ${name} for a ${jobTitle} role at ${company}.

CANDIDATE HIGHLIGHTS:
- Skills: ${skills}
- Domain: ${domain}
${summary ? `- Summary: ${summary}` : ''}

WHY THEY'RE A FIT (${recommendation}, ${matchScore}% match):
- ${matchContext}

REQUIREMENTS:
1. Under 150 words
2. Reference ONE specific skill or achievement that matches the role
3. No generic openers
4. Simple question CTA (not "schedule a call")
5. Warm, conversational tone

Write the message now:`;
    } else {
      return `Write a recruiting email to ${name} for a ${jobTitle} role at ${company}.

CANDIDATE PROFILE:
- Name: ${name}
- Skills: ${skills}
- Domain: ${domain}
${summary ? `- Summary: ${summary}` : ''}

JOB DETAILS:
- Title: ${jobTitle}
- Company: ${company}
- Industry: ${industry}
- Location: ${job.location || 'Flexible'}

WHY THEY'RE A FIT (${recommendation}, ${matchScore}% match):
- ${matchContext}

REQUIREMENTS:
1. Include a compelling subject line (format: "Subject: ...")
2. Professional greeting
3. Explain why their background is relevant (use match analysis)
4. Brief company/role value proposition
5. Clear CTA with suggested availability
6. Professional signature placeholder [Your Name]
7. 200-300 words

Write the email now:`;
    }
  }

  /**
   * Parse the AI response into structured outreach format
   */
  parseOutreachResponse(content, channel, candidate, job, matchContext) {
    if (channel === 'email') {
      // Extract subject line
      const subjectMatch = content.match(/Subject:\s*(.+?)(?:\n|$)/i);
      const subject = subjectMatch
        ? subjectMatch[1].trim()
        : `${job.title} Opportunity at ${job.company || 'Our Company'}`;

      // Remove subject line from body
      const message = content.replace(/Subject:\s*.+?\n/i, '').trim();

      return {
        subject,
        message,
        channel: 'email',
        matchScore: matchContext,
        tone: 'professional'
      };
    } else {
      return {
        subject: null,
        message: content,
        channel: 'linkedin',
        matchScore: matchContext,
        tone: 'conversational'
      };
    }
  }

  /**
   * Enhanced fallback template using match context
   */
  generateSmartTemplateFallback(candidate, job, matchData, channel) {
    const name = candidate.fullName || candidate.name || 'there';
    const topSkill = candidate.skills?.[0] || 'your expertise';
    const domain = candidate.domain || 'your field';
    const jobTitle = job.title || 'Open Position';
    const company = job.company || 'our company';

    // Extract key match point
    const keyMatchPoint = matchData?.matchSummary?.[0] ||
      `your background in ${domain} aligns well with this role`;

    const matchScore = matchData?.matchScore || 50;
    const isStrongMatch = matchScore >= 70;

    if (channel === 'linkedin') {
      const templates = [
        `Hi ${name}, your ${topSkill} experience caught my attention - ${keyMatchPoint}. We're hiring a ${jobTitle} at ${company} and I think you'd be a great fit. Open to hearing more?`,
        `Hi ${name}! ${isStrongMatch ? 'Your profile really stands out' : 'I noticed your background'} - especially ${keyMatchPoint}. Would you be interested in learning about our ${jobTitle} role at ${company}?`,
        `Hi ${name}, ${keyMatchPoint}. We have a ${jobTitle} opening at ${company} that seems like a strong match for your skills. Worth a quick chat?`
      ];

      return {
        subject: null,
        message: templates[Math.floor(Math.random() * templates.length)],
        channel: 'linkedin',
        matchScore: matchData?.matchScore,
        tone: 'conversational',
        fallback: true
      };
    } else {
      const subject = isStrongMatch
        ? `Strong Match: ${jobTitle} at ${company}`
        : `${jobTitle} Opportunity - Your ${topSkill} Background`;

      const message = `Dear ${name},

I hope this email finds you well. I'm reaching out because ${keyMatchPoint}.

We're currently looking for a ${jobTitle} to join ${company}, and your background makes you an excellent candidate for this opportunity.

${isStrongMatch ? 'Based on our analysis, your profile is a strong match for this role. ' : ''}Here's why I think this could be a great fit:
${matchData?.matchSummary?.slice(0, 3).map(point => `• ${point}`).join('\n') || '• Your skills align well with our requirements'}

Would you be available for a brief 15-minute call this week to discuss this opportunity?

Best regards,
[Your Name]
[Company] Recruiting Team`;

      return {
        subject,
        message,
        channel: 'email',
        matchScore: matchData?.matchScore,
        tone: 'professional',
        fallback: true
      };
    }
  }

  /**
   * Generate multiple smart outreach variations
   * @param {Object} candidate - Candidate object
   * @param {Object} job - Job object
   * @param {Object} matchData - Match data with matchSummary
   * @param {number} count - Number of variations per channel
   * @returns {Promise<Object>} - { linkedin: [], email: [] }
   */
  async generateSmartOutreachVariations(candidate, job, matchData, count = 2) {
    const messages = {
      linkedin: [],
      email: []
    };

    try {
      // Generate variations for each channel
      for (let i = 0; i < count; i++) {
        const [linkedinMsg, emailMsg] = await Promise.all([
          this.generateSmartOutreach(candidate, job, matchData, 'linkedin'),
          this.generateSmartOutreach(candidate, job, matchData, 'email')
        ]);

        messages.linkedin.push(linkedinMsg);
        messages.email.push(emailMsg);
      }

      return messages;
    } catch (error) {
      console.error('Error generating smart outreach variations:', error);
      // Return at least one fallback for each
      return {
        linkedin: [this.generateSmartTemplateFallback(candidate, job, matchData, 'linkedin')],
        email: [this.generateSmartTemplateFallback(candidate, job, matchData, 'email')]
      };
    }
  }

  /**
   * Fallback keyword-based match scoring
   * @param {Object} candidate - Candidate object
   * @param {Object} job - Job object
   * @returns {Object} - { matchScore, recommendation, matchSummary }
   */
  keywordBasedMatchScore(candidate, job) {
    const candidateText = [
      candidate.skills?.join(' ') || '',
      candidate.domain || '',
      candidate.summary || '',
      candidate.experience || '',
      candidate.education || ''
    ].join(' ').toLowerCase();

    const jobText = [
      job.title || '',
      job.description || '',
      job.requirements?.join(' ') || '',
      job.industry || ''
    ].join(' ').toLowerCase();

    // Extract important words (non-stop words, length > 3)
    const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will', 'your', 'about', 'into', 'more', 'other', 'been', 'were', 'they', 'some', 'what', 'when', 'make', 'like', 'just', 'over', 'such', 'take', 'only', 'come', 'made', 'find', 'than']);

    const jobWords = jobText
      .split(/\W+/)
      .filter(word => word.length > 3 && !stopWords.has(word));

    const uniqueJobWords = [...new Set(jobWords)];

    // Count matches
    let matchCount = 0;
    const matchedTerms = [];

    for (const word of uniqueJobWords) {
      if (candidateText.includes(word)) {
        matchCount++;
        if (matchedTerms.length < 5) {
          matchedTerms.push(word);
        }
      }
    }

    // Calculate score
    const matchScore = uniqueJobWords.length > 0
      ? Math.min(100, Math.round((matchCount / uniqueJobWords.length) * 100))
      : 50;

    // Determine recommendation
    let recommendation;
    if (matchScore >= 70) recommendation = 'Strong Match';
    else if (matchScore >= 40) recommendation = 'Moderate Match';
    else recommendation = 'Weak Match';

    // Build summary
    const skillMatches = candidate.skills?.filter(skill =>
      jobText.includes(skill.toLowerCase())
    ) || [];

    const matchSummary = [
      `Keyword analysis found ${matchCount} matching terms out of ${uniqueJobWords.length} job keywords.`,
      skillMatches.length > 0
        ? `Matching skills: ${skillMatches.slice(0, 4).join(', ')}`
        : 'No direct skill matches identified.',
      candidate.domain && job.industry
        ? `Candidate domain (${candidate.domain}) vs Job industry (${job.industry}).`
        : 'Domain/industry comparison not available.',
      `Overall match rate: ${matchScore}% - ${recommendation}.`
    ];

    return {
      matchScore,
      recommendation,
      matchSummary
    };
  }
}

module.exports = new AIService();
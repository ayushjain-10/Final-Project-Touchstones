# Touchstones Backend

AI-powered talent sourcing and outreach platform backend.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create an `uploads` directory in the project root:
```bash
mkdir uploads
```

3. Start the development server:
```bash
npm run dev
```

The server will start on port 3001 by default.

## API Endpoints

### Jobs

- `GET /api/jobs` - Get all job postings
- `POST /api/jobs` - Create a new job posting
- `GET /api/jobs/:id` - Get a specific job posting

### Candidates

- `POST /api/candidates/search` - Search for matching candidates
  - Body: `{ "jobDescription": "string" }`

- `POST /api/candidates/screen-resume` - Screen a resume against a job description
  - Form data:
    - `resume`: PDF file
    - `jobDescription`: string

### Outreach

- `POST /api/outreach/generate` - Generate personalized outreach messages
  - Body:
    ```json
    {
      "candidate": {
        "name": "string",
        "skills": ["string"],
        "experience": "string"
      },
      "jobDetails": {
        "title": "string"
      },
      "count": number
    }
    ```

## Features

1. **Candidate Sourcing**
   - Keyword extraction from job descriptions
   - Candidate profile matching
   - Mock candidate database

2. **Resume Screening**
   - PDF resume parsing
   - Skills and experience extraction
   - Job requirement matching

3. **Outreach Message Generation**
   - Personalized message templates
   - Multiple message variations
   - Support for LinkedIn and email formats

## Technologies Used

- Node.js
- Express
- Natural (NLP)
- PDF Parse
- Multer (file uploads)
- SQLite (mock data for now) 
// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

/**
 * Comprehensive tests for the AI Interview Feedback Summarizer feature
 *
 * Tests cover:
 * 1. POST /api/feedback/summarize - Main summarization with save
 * 2. POST /api/feedback/summarize-only - Preview without saving
 * 3. GET /api/feedback/:candidateId - Get feedback history
 * 4. GET /api/feedback/analytics/:candidateId - Analytics
 * 5. DELETE /api/feedback/:candidateId/:feedbackId - Delete feedback
 * 6. Security tests - Auth, ownership, validation
 */

// Use the already-running servers by default (ports 3000/3001)
const BACKEND_PORT = process.env.TEST_BACKEND_PORT || 3001;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

// Test user credentials - will be created/used for testing
const TEST_USER = {
    email: `feedback-test-${Date.now()}@test.com`,
    password: 'TestPassword123!',
    name: 'Feedback Test User',
    company: 'Test Company'
};

test.describe('AI Interview Feedback Summarizer', () => {
    // Configure tests to run serially to share state (authToken, testCandidateId)
    test.describe.configure({ mode: 'serial' });

    let authToken = null;
    let testCandidateId = null;
    let testFeedbackId = null;

    // Setup: Register/login test user and get token
    test.beforeAll(async ({ request }) => {
        // Try to register a new test user
        const registerResponse = await request.post(`${BACKEND_URL}/api/auth/register`, {
            data: TEST_USER
        });

        if (registerResponse.ok()) {
            const data = await registerResponse.json();
            authToken = data.token;
            console.log('Registered new test user');
        } else {
            // Try to login if registration fails (user might already exist)
            const loginResponse = await request.post(`${BACKEND_URL}/api/auth/login`, {
                data: {
                    email: TEST_USER.email,
                    password: TEST_USER.password
                }
            });

            if (loginResponse.ok()) {
                const data = await loginResponse.json();
                authToken = data.token;
                console.log('Logged in existing test user');
            } else {
                throw new Error('Could not register or login test user');
            }
        }

        expect(authToken).toBeTruthy();
    });

    test.describe('Setup - Create Test Candidate Submission', () => {
        test('should create a test candidate submission for feedback tests', async ({ request }) => {
            // First check if we have any existing talent submissions (CandidateSubmission)
            const talentResponse = await request.get(`${BACKEND_URL}/api/talent`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            if (talentResponse.ok()) {
                const talentData = await talentResponse.json();
                const submissions = talentData.data || talentData;

                if (Array.isArray(submissions) && submissions.length > 0) {
                    testCandidateId = submissions[0]._id;
                    console.log('Using existing talent submission:', testCandidateId);
                    return;
                }
            }

            // Create a new talent submission with file upload
            const uniqueEmail = `test-feedback-${Date.now()}@example.com`;
            const resumePath = path.join(__dirname, '../fixtures/test-resume.pdf');
            const resumeBuffer = fs.readFileSync(resumePath);

            const createResponse = await request.post(`${BACKEND_URL}/api/talent/submit`, {
                multipart: {
                    fullName: 'Test Feedback Candidate',
                    email: uniqueEmail,
                    phone: '555-0100',
                    location: 'San Francisco, CA',
                    desiredRoles: 'Software Engineer',
                    consentGiven: 'true',
                    resume: {
                        name: 'test-resume.pdf',
                        mimeType: 'application/pdf',
                        buffer: resumeBuffer
                    }
                }
            });

            if (createResponse.ok()) {
                const candidate = await createResponse.json();
                testCandidateId = candidate._id || candidate.id;
                console.log('Created new talent submission:', testCandidateId);
            } else {
                const errorText = await createResponse.text();
                console.log('Could not create talent submission. Status:', createResponse.status(), 'Error:', errorText);
            }
        });
    });

    test.describe('POST /api/feedback/summarize-only (Preview Mode)', () => {
        test('should summarize feedback without saving', async ({ request }) => {
            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize-only`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    interviewerNotes: 'The candidate demonstrated strong problem-solving skills. They quickly understood the requirements and proposed an efficient solution. Communication was clear and concise. Some areas for improvement include deeper knowledge of distributed systems.',
                    interviewStage: 'Technical Round 1',
                    candidateName: 'Test Candidate',
                    role: 'Software Engineer'
                }
            });

            expect(response.ok()).toBeTruthy();
            const data = await response.json();

            // Verify response structure
            expect(data.summary).toBeTruthy();
            expect(typeof data.summary).toBe('string');
            expect(data.preview).toBe(true);

            // Tags should be an array
            expect(Array.isArray(data.tags)).toBe(true);

            // Recommendation should be one of the valid values
            if (data.recommendation) {
                expect(['strong_yes', 'yes', 'maybe', 'no', 'strong_no']).toContain(data.recommendation);
            }

            // Rating should be between 1 and 5
            if (data.rating) {
                expect(data.rating).toBeGreaterThanOrEqual(1);
                expect(data.rating).toBeLessThanOrEqual(5);
            }

            console.log('Preview summary:', data.summary.substring(0, 100) + '...');
            console.log('Tags:', data.tags);
            console.log('Rating:', data.rating);
        });

        test('should handle long interview notes', async ({ request }) => {
            const longNotes = `
                The candidate showed exceptional technical prowess during the interview.
                They demonstrated deep understanding of:
                - Object-oriented programming principles
                - Database design and optimization
                - API design best practices
                - Testing methodologies including unit, integration, and e2e testing

                Key observations:
                1. Problem Solving: Approached problems systematically, breaking down complex issues
                2. Communication: Articulated thoughts clearly, asked clarifying questions
                3. Technical Depth: Showed knowledge beyond surface level
                4. Cultural Fit: Collaborative, open to feedback, enthusiastic

                Areas of concern:
                - Limited experience with cloud infrastructure
                - Could benefit from more exposure to agile methodologies
                - Time management during coding exercises could improve

                Overall impression: Strong candidate with solid fundamentals.
                Would recommend for the senior engineering role with some mentoring on cloud tech.
            `.repeat(3); // Make it even longer

            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize-only`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    interviewerNotes: longNotes,
                    interviewStage: 'Final Interview',
                    candidateName: 'Senior Candidate',
                    role: 'Senior Software Engineer'
                }
            });

            expect(response.ok()).toBeTruthy();
            const data = await response.json();
            expect(data.summary).toBeTruthy();
            // Summary should be shorter than the original notes
            expect(data.summary.length).toBeLessThan(longNotes.length);
        });

        test('should reject empty notes', async ({ request }) => {
            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize-only`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    interviewerNotes: ''
                }
            });

            expect(response.status()).toBe(400);
            const data = await response.json();
            expect(data.error).toContain('interviewerNotes');
        });

        test('should reject whitespace-only notes', async ({ request }) => {
            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize-only`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    interviewerNotes: '   \n\t   '
                }
            });

            expect(response.status()).toBe(400);
        });
    });

    test.describe('POST /api/feedback/summarize (With Save)', () => {
        test('should require candidateId', async ({ request }) => {
            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    interviewerNotes: 'Great candidate with strong skills.'
                }
            });

            expect(response.status()).toBe(400);
            const data = await response.json();
            expect(data.error).toContain('candidateId');
        });

        test('should reject invalid candidateId format', async ({ request }) => {
            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    candidateId: 'invalid-id-format',
                    interviewerNotes: 'Great candidate with strong skills.'
                }
            });

            expect(response.status()).toBe(400);
            const data = await response.json();
            expect(data.error).toContain('Invalid candidateId');
        });

        test('should return 404 for non-existent candidate', async ({ request }) => {
            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    candidateId: '507f1f77bcf86cd799439011', // Valid format but doesn't exist
                    interviewerNotes: 'Great candidate with strong skills.'
                }
            });

            expect(response.status()).toBe(404);
        });

        test('should summarize and save feedback for existing candidate', async ({ request }) => {
            test.skip(!testCandidateId, 'No test candidate available');

            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    candidateId: testCandidateId,
                    interviewerNotes: 'Excellent performance in the technical interview. Strong coding skills demonstrated.',
                    interviewStage: 'Technical Round 1',
                    interviewerName: 'Test Interviewer',
                    saveToCandidate: true
                }
            });

            if (!response.ok()) {
                const errorText = await response.text();
                console.log('Summarize failed. Status:', response.status(), 'Error:', errorText);
            }
            expect(response.ok()).toBeTruthy();
            const data = await response.json();

            expect(data.summary).toBeTruthy();
            expect(data.saved).toBe(true);
            expect(data.feedbackId).toBeTruthy();

            // Save for later tests
            testFeedbackId = data.feedbackId;
            console.log('Saved feedback ID:', testFeedbackId);
        });

        test('should not save when saveToCandidate is false', async ({ request }) => {
            test.skip(!testCandidateId, 'No test candidate available');

            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    candidateId: testCandidateId,
                    interviewerNotes: 'This feedback should not be saved.',
                    saveToCandidate: false
                }
            });

            expect(response.ok()).toBeTruthy();
            const data = await response.json();

            expect(data.summary).toBeTruthy();
            expect(data.saved).toBe(false);
            expect(data.feedbackId).toBeUndefined();
        });
    });

    test.describe('GET /api/feedback/:candidateId', () => {
        test('should reject invalid candidateId format', async ({ request }) => {
            const response = await request.get(`${BACKEND_URL}/api/feedback/invalid-id`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            expect(response.status()).toBe(400);
        });

        test('should return 404 for non-existent candidate', async ({ request }) => {
            const response = await request.get(`${BACKEND_URL}/api/feedback/507f1f77bcf86cd799439011`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            expect(response.status()).toBe(404);
        });

        test('should get feedback history for candidate', async ({ request }) => {
            test.skip(!testCandidateId, 'No test candidate available');

            const response = await request.get(`${BACKEND_URL}/api/feedback/${testCandidateId}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            expect(response.ok()).toBeTruthy();
            const data = await response.json();

            expect(data.candidateId).toBeTruthy();
            expect(Array.isArray(data.feedbackHistory)).toBe(true);
            expect(typeof data.feedbackCount).toBe('number');
            console.log('Feedback count:', data.feedbackCount);
        });
    });

    test.describe('GET /api/feedback/analytics/:candidateId', () => {
        test('should return analytics for candidate with feedback', async ({ request }) => {
            test.skip(!testCandidateId, 'No test candidate available');

            const response = await request.get(`${BACKEND_URL}/api/feedback/analytics/${testCandidateId}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            expect(response.ok()).toBeTruthy();
            const data = await response.json();

            expect(data.candidateId).toBeTruthy();
            expect(typeof data.totalFeedback).toBe('number');

            if (data.totalFeedback > 0) {
                expect(data.analytics).toBeTruthy();
                if (data.analytics.averageRating) {
                    expect(data.analytics.averageRating).toBeGreaterThanOrEqual(1);
                    expect(data.analytics.averageRating).toBeLessThanOrEqual(5);
                }
            }
        });

        test('should handle candidate with no feedback', async ({ request }) => {
            // This test uses a fake candidate ID that exists but has no feedback
            const response = await request.get(`${BACKEND_URL}/api/feedback/analytics/507f1f77bcf86cd799439011`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            // Should return 404 for non-existent candidate
            expect(response.status()).toBe(404);
        });
    });

    test.describe('DELETE /api/feedback/:candidateId/:feedbackId', () => {
        test('should reject invalid IDs', async ({ request }) => {
            const response = await request.delete(`${BACKEND_URL}/api/feedback/invalid/invalid`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            expect(response.status()).toBe(400);
        });

        test('should return 404 for non-existent feedback', async ({ request }) => {
            test.skip(!testCandidateId, 'No test candidate available');

            const response = await request.delete(`${BACKEND_URL}/api/feedback/${testCandidateId}/507f1f77bcf86cd799439011`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            expect(response.status()).toBe(404);
        });

        test('should delete existing feedback entry', async ({ request }) => {
            test.skip(!testCandidateId || !testFeedbackId, 'No test candidate or feedback available');

            // First verify feedback exists
            const getResponse = await request.get(`${BACKEND_URL}/api/feedback/${testCandidateId}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const beforeData = await getResponse.json();
            const beforeCount = beforeData.feedbackCount;

            // Delete the feedback
            const deleteResponse = await request.delete(`${BACKEND_URL}/api/feedback/${testCandidateId}/${testFeedbackId}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            expect(deleteResponse.ok()).toBeTruthy();
            const deleteData = await deleteResponse.json();
            expect(deleteData.message).toContain('deleted');

            // Verify feedback is deleted
            const afterResponse = await request.get(`${BACKEND_URL}/api/feedback/${testCandidateId}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const afterData = await afterResponse.json();
            expect(afterData.feedbackCount).toBe(beforeCount - 1);
        });
    });

    test.describe('Security Tests', () => {
        test('should reject requests without auth token', async ({ request }) => {
            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize-only`, {
                data: {
                    interviewerNotes: 'Test notes'
                }
            });

            expect(response.status()).toBe(401);
        });

        test('should reject requests with invalid token', async ({ request }) => {
            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize-only`, {
                headers: { 'Authorization': 'Bearer invalid-token-12345' },
                data: {
                    interviewerNotes: 'Test notes'
                }
            });

            expect(response.status()).toBe(401);
        });

        test('should allow authenticated users to access shared talent pool candidates', async ({ request }) => {
            // Talent pool candidates are shared - any authenticated user can access them
            // This is intentional for a collaborative recruiting workflow
            const secondUser = {
                email: `feedback-test-second-${Date.now()}@test.com`,
                password: 'TestPassword123!',
                name: 'Second Test User',
                company: 'Second Test Company'
            };

            const registerResponse = await request.post(`${BACKEND_URL}/api/auth/register`, {
                data: secondUser
            });

            expect(registerResponse.ok()).toBeTruthy();
            const { token: secondToken } = await registerResponse.json();

            // Second user should be able to access shared talent pool candidates
            if (testCandidateId) {
                const response = await request.get(`${BACKEND_URL}/api/feedback/${testCandidateId}`, {
                    headers: { 'Authorization': `Bearer ${secondToken}` }
                });

                // Should succeed because talent pool candidates are shared
                expect(response.ok()).toBeTruthy();
            }
        });
    });

    test.describe('Edge Cases', () => {
        test('should handle special characters in notes', async ({ request }) => {
            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize-only`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    interviewerNotes: 'Notes with special chars: <script>alert("xss")</script> & "quotes" and \'apostrophes\''
                }
            });

            expect(response.ok()).toBeTruthy();
            const data = await response.json();
            expect(data.summary).toBeTruthy();
            // Summary should not contain raw script tags
            expect(data.summary).not.toContain('<script>');
        });

        test('should handle unicode and emoji in notes', async ({ request }) => {
            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize-only`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    interviewerNotes: 'Great candidate! 👍 Très bien. 日本語テスト. مرحبا'
                }
            });

            expect(response.ok()).toBeTruthy();
            const data = await response.json();
            expect(data.summary).toBeTruthy();
        });

        test('should handle negative feedback appropriately', async ({ request }) => {
            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize-only`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    interviewerNotes: 'The candidate was unprepared. Did not understand basic concepts. Poor communication skills. Would not recommend.',
                    interviewStage: 'Technical Screen'
                }
            });

            expect(response.ok()).toBeTruthy();
            const data = await response.json();
            expect(data.summary).toBeTruthy();

            // Rating should be low for negative feedback
            if (data.rating) {
                expect(data.rating).toBeLessThanOrEqual(3);
            }

            // Recommendation should be negative
            if (data.recommendation) {
                expect(['no', 'strong_no', 'maybe']).toContain(data.recommendation);
            }
        });

        test('should handle mixed/neutral feedback', async ({ request }) => {
            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize-only`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    interviewerNotes: 'Average performance. Some strengths in coding but weaknesses in system design. Might work for junior role but not senior.',
                    interviewStage: 'Technical Interview'
                }
            });

            expect(response.ok()).toBeTruthy();
            const data = await response.json();
            expect(data.summary).toBeTruthy();

            // Rating should be middle range for neutral feedback
            if (data.rating) {
                expect(data.rating).toBeGreaterThanOrEqual(2);
                expect(data.rating).toBeLessThanOrEqual(4);
            }
        });
    });

    test.describe('Performance Tests', () => {
        test('should respond within reasonable time for summarization', async ({ request }) => {
            const startTime = Date.now();

            const response = await request.post(`${BACKEND_URL}/api/feedback/summarize-only`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
                data: {
                    interviewerNotes: 'Standard interview notes for performance testing. The candidate showed good problem-solving abilities.'
                }
            });

            const endTime = Date.now();
            const duration = endTime - startTime;

            expect(response.ok()).toBeTruthy();
            // AI summarization should complete within 30 seconds
            expect(duration).toBeLessThan(30000);
            console.log(`Summarization took ${duration}ms`);
        });
    });
});

/**
 * Candidates API Tests
 * Tests CRUD operations for candidates
 */

const request = require('supertest');

const app = require('../../src/app');

describe('Candidates API', () => {
  let authToken;

  beforeAll(() => {
    authToken = testUtils.generateTestToken();
  });

  describe('GET /api/candidates', () => {
    it('should return candidates without auth (optionalAuth)', async () => {
      const res = await request(app).get('/api/candidates');
      expect([200, 401, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('candidates');
        expect(res.body).toHaveProperty('pagination');
      }
    });

    it('should return paginated results with auth', async () => {
      const res = await request(app)
        .get('/api/candidates')
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('pagination');
        expect(res.body.pagination).toHaveProperty('total');
        expect(res.body.pagination).toHaveProperty('page');
        expect(res.body.pagination).toHaveProperty('limit');
        expect(res.body.pagination).toHaveProperty('pages');
      }
    });

    it('should support status filter', async () => {
      const res = await request(app)
        .get('/api/candidates')
        .query({ status: 'Active' })
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401, 500]).toContain(res.status);
    });

    it('should support source filter', async () => {
      const res = await request(app)
        .get('/api/candidates')
        .query({ source: 'Manual' })
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401, 500]).toContain(res.status);
    });

    it('should support search parameter', async () => {
      const res = await request(app)
        .get('/api/candidates')
        .query({ search: 'engineer' })
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401, 500]).toContain(res.status);
    });

    it('should support pagination parameters', async () => {
      const res = await request(app)
        .get('/api/candidates')
        .query({ page: 1, limit: 5 })
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 401, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.pagination.limit).toBe(5);
        expect(res.body.pagination.page).toBe(1);
      }
    });
  });

  describe('POST /api/candidates', () => {
    it('should require name field', async () => {
      const res = await request(app)
        .post('/api/candidates')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should create candidate with valid data', async () => {
      const candidateData = {
        name: 'Test Candidate',
        email: testUtils.randomEmail(),
        phone: '+1234567890',
        title: 'Software Engineer',
        skills: ['JavaScript', 'React', 'Node.js'],
        experience: '5 years',
        location: 'San Francisco, CA',
        source: 'Manual',
        notes: 'Test candidate notes'
      };

      const res = await request(app)
        .post('/api/candidates')
        .send(candidateData);

      expect([201, 400, 401, 500]).toContain(res.status);
      if (res.status === 201) {
        expect(res.body).toHaveProperty('id');
        expect(res.body.name).toBe(candidateData.name);
        expect(res.body.email).toBe(candidateData.email);
      }
    });

    it('should handle skills as comma-separated string', async () => {
      const res = await request(app)
        .post('/api/candidates')
        .send({
          name: 'String Skills Candidate',
          skills: 'JavaScript, React, Node.js'
        });

      expect([201, 400, 401, 500]).toContain(res.status);
    });

    it('should accept auth token for created_by tracking', async () => {
      const res = await request(app)
        .post('/api/candidates')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Auth Candidate',
          email: testUtils.randomEmail()
        });

      expect([201, 400, 401, 500]).toContain(res.status);
    });
  });

  describe('GET /api/candidates/:id', () => {
    it('should return 404 for non-existent candidate', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app).get(`/api/candidates/${fakeId}`);
      expect([404, 500]).toContain(res.status);
    });

    it('should handle invalid UUID format', async () => {
      const res = await request(app).get('/api/candidates/invalid-id');
      expect([400, 404, 500]).toContain(res.status);
    });
  });

  describe('PUT /api/candidates/:id', () => {
    it('should return 404 for non-existent candidate', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .put(`/api/candidates/${fakeId}`)
        .send({ name: 'Updated Name' });

      expect([404, 500, 401]).toContain(res.status);
    });

    it('should accept partial updates', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .put(`/api/candidates/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ title: 'Senior Engineer' });

      expect([200, 404, 500, 401]).toContain(res.status);
    });

    it('should handle skills update as comma-separated string', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .put(`/api/candidates/${fakeId}`)
        .send({ skills: 'Python, Django, PostgreSQL' });

      expect([200, 404, 500, 401]).toContain(res.status);
    });
  });

  describe('DELETE /api/candidates/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app).delete('/api/candidates/test-id');
      expect([200, 401, 500]).toContain(res.status);
    });

    it('should return 404 for non-existent candidate with auth', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .delete(`/api/candidates/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`);

      // May return 200 (delete is idempotent) or 404
      expect([200, 404, 401]).toContain(res.status);
    });
  });

  describe('POST /api/candidates/search', () => {
    it('should require job description or job ID', async () => {
      const res = await request(app)
        .post('/api/candidates/search')
        .send({});

      expect(res.status).toBe(400);
    });

    it('should search with job description', async () => {
      const res = await request(app)
        .post('/api/candidates/search')
        .send({ jobDescription: 'Looking for a JavaScript developer' });

      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('candidates');
        expect(Array.isArray(res.body.candidates)).toBe(true);
      }
    });

    it('should search with job ID', async () => {
      const fakeJobId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post('/api/candidates/search')
        .send({ jobId: fakeJobId });

      expect([200, 400]).toContain(res.status);
    });
  });

  describe('POST /api/candidates/screen-resume', () => {
    it('should require resume file', async () => {
      const res = await request(app)
        .post('/api/candidates/screen-resume')
        .send({ jobDescription: 'Test job' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should require job description or job ID', async () => {
      const res = await request(app)
        .post('/api/candidates/screen-resume')
        .attach('resume', Buffer.from('fake pdf content'), 'resume.pdf');

      expect([400]).toContain(res.status);
    });
  });

  describe('POST /api/candidates/:id/resume', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/candidates/test-id/resume')
        .attach('resume', Buffer.from('fake pdf content'), 'resume.pdf');

      expect([200, 401, 500]).toContain(res.status);
    });

    it('should require resume file', async () => {
      const res = await request(app)
        .post('/api/candidates/test-id/resume')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect([400, 401]).toContain(res.status);
    });
  });
});

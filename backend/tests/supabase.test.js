/**
 * Supabase Integration Tests
 * Tests database connectivity and basic CRUD operations
 *
 * Run with: npm test -- tests/supabase.test.js
 * Or: USE_SUPABASE=true node tests/supabase.test.js
 */

// Load environment variables first
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { supabaseAdmin } = require('../src/config/supabase');
const { v4: uuidv4 } = require('uuid');

// Test results tracker
const results = {
    passed: 0,
    failed: 0,
    tests: []
};

// Test helper
async function runTest(name, testFn) {
    try {
        await testFn();
        results.passed++;
        results.tests.push({ name, status: '✓ PASSED' });
        console.log(`✓ ${name}`);
    } catch (error) {
        results.failed++;
        results.tests.push({ name, status: '✗ FAILED', error: error.message });
        console.error(`✗ ${name}: ${error.message}`);
    }
}

// Assert helper
function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

// ============== TESTS ==============

async function testConnection() {
    // Simple query to verify connection
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .limit(1);

    assert(!error, `Connection error: ${error?.message}`);
    assert(Array.isArray(data), 'Expected array response');
}

async function testProfilesCRUD() {
    const testId = uuidv4();
    const testEmail = `test-${Date.now()}@supabase-test.com`;

    // CREATE
    const { data: created, error: createError } = await supabaseAdmin
        .from('profiles')
        .insert({
            id: testId,
            email: testEmail,
            first_name: 'Test',
            last_name: 'User',
            role: 'recruiter',
            subscription: { plan: 'free', status: 'active' },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

    assert(!createError, `Create error: ${createError?.message}`);
    assert(created.id === testId, 'Created profile ID mismatch');

    // READ
    const { data: read, error: readError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', testId)
        .single();

    assert(!readError, `Read error: ${readError?.message}`);
    assert(read.email === testEmail, 'Read email mismatch');

    // UPDATE
    const { data: updated, error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ first_name: 'Updated' })
        .eq('id', testId)
        .select()
        .single();

    assert(!updateError, `Update error: ${updateError?.message}`);
    assert(updated.first_name === 'Updated', 'Update failed');

    // DELETE
    const { error: deleteError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', testId);

    assert(!deleteError, `Delete error: ${deleteError?.message}`);

    // Verify deletion
    const { data: deleted } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', testId)
        .single();

    assert(!deleted, 'Profile should be deleted');
}

async function testJobsCRUD() {
    const testId = uuidv4();
    const recruiterId = uuidv4();

    // First create a test recruiter profile (needed for foreign key)
    await supabaseAdmin.from('profiles').insert({
        id: recruiterId,
        email: `recruiter-${Date.now()}@test.com`,
        role: 'recruiter',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });

    // CREATE job
    const { data: created, error: createError } = await supabaseAdmin
        .from('jobs')
        .insert({
            id: testId,
            title: 'Test Software Engineer',
            company: 'Test Company',
            location: 'Remote',
            type: 'Full-time',
            status: 'Open',
            description: 'Test job description',
            requirements: ['JavaScript', 'Node.js'],
            recruiter_id: recruiterId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

    assert(!createError, `Create job error: ${createError?.message}`);
    assert(created.title === 'Test Software Engineer', 'Job title mismatch');

    // READ
    const { data: read, error: readError } = await supabaseAdmin
        .from('jobs')
        .select('*')
        .eq('id', testId)
        .single();

    assert(!readError, `Read job error: ${readError?.message}`);
    assert(read.company === 'Test Company', 'Job company mismatch');

    // UPDATE
    const { error: updateError } = await supabaseAdmin
        .from('jobs')
        .update({ status: 'Closed' })
        .eq('id', testId);

    assert(!updateError, `Update job error: ${updateError?.message}`);

    // DELETE job and recruiter
    await supabaseAdmin.from('jobs').delete().eq('id', testId);
    await supabaseAdmin.from('profiles').delete().eq('id', recruiterId);
}

async function testCandidateSubmissions() {
    const testId = uuidv4();
    const testEmail = `candidate-${Date.now()}@test.com`;

    // CREATE
    const { data: created, error: createError } = await supabaseAdmin
        .from('candidate_submissions')
        .insert({
            id: testId,
            full_name: 'Test Candidate',
            email: testEmail,
            location: 'New York',
            desired_roles: 'Software Engineer',
            skills: ['Python', 'SQL'],
            domain: 'Engineering',
            consent_given: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

    assert(!createError, `Create candidate error: ${createError?.message}`);
    assert(created.full_name === 'Test Candidate', 'Candidate name mismatch');

    // Test JSONB array contains
    const { data: found, error: findError } = await supabaseAdmin
        .from('candidate_submissions')
        .select('*')
        .contains('skills', ['Python']);

    assert(!findError, `Find by skills error: ${findError?.message}`);
    assert(found.length > 0, 'Should find candidate by skill');

    // DELETE
    await supabaseAdmin.from('candidate_submissions').delete().eq('id', testId);
}

async function testNotifications() {
    const testId = uuidv4();
    const userId = uuidv4();

    // Create test user first
    await supabaseAdmin.from('profiles').insert({
        id: userId,
        email: `notif-user-${Date.now()}@test.com`,
        role: 'recruiter',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });

    // CREATE notification
    const { data: created, error: createError } = await supabaseAdmin
        .from('notifications')
        .insert({
            id: testId,
            user_id: userId,
            type: 'test',
            title: 'Test Notification',
            message: 'This is a test',
            read: false,
            created_at: new Date().toISOString()
        })
        .select()
        .single();

    assert(!createError, `Create notification error: ${createError?.message}`);

    // Mark as read
    const { error: updateError } = await supabaseAdmin
        .from('notifications')
        .update({ read: true })
        .eq('id', testId);

    assert(!updateError, `Update notification error: ${updateError?.message}`);

    // Cleanup
    await supabaseAdmin.from('notifications').delete().eq('id', testId);
    await supabaseAdmin.from('profiles').delete().eq('id', userId);
}

async function testPipelineStages() {
    const userId = uuidv4();
    const stageId = uuidv4();

    // Create test user
    await supabaseAdmin.from('profiles').insert({
        id: userId,
        email: `pipeline-user-${Date.now()}@test.com`,
        role: 'recruiter',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });

    // CREATE pipeline stage
    const { data: created, error: createError } = await supabaseAdmin
        .from('pipeline_stages')
        .insert({
            id: stageId,
            user_id: userId,
            name: 'Interview',
            order_index: 1,
            color: '#3B82F6',
            created_at: new Date().toISOString()
        })
        .select()
        .single();

    assert(!createError, `Create stage error: ${createError?.message}`);
    assert(created.name === 'Interview', 'Stage name mismatch');

    // Cleanup
    await supabaseAdmin.from('pipeline_stages').delete().eq('id', stageId);
    await supabaseAdmin.from('profiles').delete().eq('id', userId);
}

async function testSavedFilters() {
    const userId = uuidv4();
    const filterId = uuidv4();

    // Create test user
    await supabaseAdmin.from('profiles').insert({
        id: userId,
        email: `filter-user-${Date.now()}@test.com`,
        role: 'recruiter',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });

    // CREATE saved filter
    const { data: created, error: createError } = await supabaseAdmin
        .from('saved_filters')
        .insert({
            id: filterId,
            user_id: userId,
            name: 'My Filter',
            filters: { location: 'Remote', skills: ['JavaScript'] },
            is_default: false,
            created_at: new Date().toISOString()
        })
        .select()
        .single();

    assert(!createError, `Create filter error: ${createError?.message}`);
    assert(created.filters.location === 'Remote', 'Filter data mismatch');

    // Cleanup
    await supabaseAdmin.from('saved_filters').delete().eq('id', filterId);
    await supabaseAdmin.from('profiles').delete().eq('id', userId);
}

// ============== RUN TESTS ==============

async function runAllTests() {
    console.log('\n🧪 Running Supabase Integration Tests\n');
    console.log('='.repeat(50));

    await runTest('Database Connection', testConnection);
    await runTest('Profiles CRUD', testProfilesCRUD);
    await runTest('Jobs CRUD', testJobsCRUD);
    await runTest('Candidate Submissions', testCandidateSubmissions);
    await runTest('Notifications', testNotifications);
    await runTest('Pipeline Stages', testPipelineStages);
    await runTest('Saved Filters', testSavedFilters);

    console.log('\n' + '='.repeat(50));
    console.log(`\n📊 Results: ${results.passed} passed, ${results.failed} failed\n`);

    if (results.failed > 0) {
        console.log('Failed tests:');
        results.tests
            .filter(t => t.status.includes('FAILED'))
            .forEach(t => console.log(`  - ${t.name}: ${t.error}`));
        process.exit(1);
    }

    console.log('✅ All tests passed!\n');
    process.exit(0);
}

// Run tests
runAllTests().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});

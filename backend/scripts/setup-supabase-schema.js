#!/usr/bin/env node
/**
 * Supabase Schema Setup Script
 *
 * This script helps set up the database schema in Supabase.
 *
 * Usage:
 *   node scripts/setup-supabase-schema.js
 *
 * Prerequisites:
 *   1. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 *   2. Have the Supabase project ready
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables:');
    if (!SUPABASE_URL) console.error('   - SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) console.error('   - SUPABASE_SERVICE_ROLE_KEY');
    console.error('\nPlease add these to your .env file and try again.');
    process.exit(1);
}

// Read the schema file
const schemaPath = path.join(__dirname, '../supabase/migrations/002_standalone_schema.sql');

if (!fs.existsSync(schemaPath)) {
    console.error('❌ Schema file not found at:', schemaPath);
    process.exit(1);
}

const schemaSql = fs.readFileSync(schemaPath, 'utf8');

console.log(`
╔══════════════════════════════════════════════════════════════╗
║          Touchstones Supabase Schema Setup                      ║
╚══════════════════════════════════════════════════════════════╝

The Supabase JavaScript client doesn't support running raw SQL directly.
You need to run the schema manually in Supabase SQL Editor.

📋 STEPS TO CREATE YOUR DATABASE TABLES:

1. Open Supabase Dashboard:
   ${SUPABASE_URL.replace('.supabase.co', '.supabase.co/project/_/sql')}

2. Go to: SQL Editor (left sidebar)

3. Click "New Query"

4. Copy the SQL from this file:
   ${schemaPath}

5. Paste into the SQL Editor and click "Run"

6. You should see: "Schema created successfully!"

7. Then run this script again to verify, or run the tests:
   node tests/supabase.test.js

═══════════════════════════════════════════════════════════════

📝 ALTERNATIVE: If you have the Supabase CLI installed:
   supabase db push --db-url "postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres"

═══════════════════════════════════════════════════════════════
`);

// Try to verify connection and check if tables exist
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkTables() {
    console.log('🔍 Checking current database status...\n');

    const tables = [
        'profiles',
        'jobs',
        'candidates',
        'candidate_submissions',
        'notifications',
        'pipeline_stages',
        'saved_filters',
        'recruiter_candidate_statuses',
        'outreach_logs',
        'comments',
        'interview_feedback',
        'autopilot_campaigns',
        'autopilot_queue'
    ];

    let existingCount = 0;
    let missingCount = 0;

    for (const table of tables) {
        const { data, error } = await supabase
            .from(table)
            .select('id')
            .limit(1);

        if (error && error.message.includes('Could not find the table')) {
            console.log(`   ❌ ${table} - NOT FOUND`);
            missingCount++;
        } else if (error) {
            console.log(`   ⚠️  ${table} - Error: ${error.message}`);
        } else {
            console.log(`   ✅ ${table} - EXISTS`);
            existingCount++;
        }
    }

    console.log(`\n📊 Summary: ${existingCount} tables exist, ${missingCount} tables missing\n`);

    if (missingCount > 0) {
        console.log('⚠️  Some tables are missing. Please run the schema SQL in Supabase SQL Editor.');
        console.log('\n📄 Schema file location:');
        console.log(`   ${schemaPath}\n`);
    } else {
        console.log('✅ All tables exist! Your Supabase database is ready.');
        console.log('\n🧪 Run tests to verify everything works:');
        console.log('   node tests/supabase.test.js\n');
    }
}

checkTables().catch(err => {
    console.error('Error checking tables:', err);
    process.exit(1);
});

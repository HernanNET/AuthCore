import { Pool } from "pg";

const pool = new Pool({
  connectionString: "postgres://authcore:authcore_dev@localhost:5432/authcore_test",
});

const [{ users }] = await pool.query('SELECT COUNT(*)::int AS users FROM "user"').then(r => [r.rows[0]]);
const [{ accounts }] = await pool.query('SELECT COUNT(*)::int AS accounts FROM account').then(r => [r.rows[0]]);
const [{ sessions }] = await pool.query('SELECT COUNT(*)::int AS sessions FROM session').then(r => [r.rows[0]]);
const [{ verifications }] = await pool.query('SELECT COUNT(*)::int AS verifications FROM verification').then(r => [r.rows[0]]);
const [{ passkeys }] = await pool.query('SELECT COUNT(*)::int AS passkeys FROM passkey').then(r => [r.rows[0]]);
const [{ rateLimits }] = await pool.query('SELECT COUNT(*)::int AS "rateLimits" FROM "rateLimit"').then(r => [r.rows[0]]);
const [{ securityEvents }] = await pool.query('SELECT COUNT(*)::int AS "securityEvents" FROM "securityEvent"').then(r => [r.rows[0]]);

console.log(`users=${users} accounts=${accounts} sessions=${sessions} verifications=${verifications} passkeys=${passkeys} rateLimits=${rateLimits} securityEvents=${securityEvents}`);
await pool.end();

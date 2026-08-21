import { auth, pool } from "../src/lib/auth";

const email = `sanity-${Date.now()}@example.test`;
const password = "password123";

let res: unknown;
try {
  res = await auth.api.signUpEmail({
    body: { email, password, name: "Sanity User" },
  });
} catch (e) {
  console.error("signUpEmail threw:", e);
  process.exit(1);
}

console.log("signUpEmail result:", JSON.stringify(res, null, 2));

const userRows = await pool.query('SELECT id, name, email, "emailVerified" FROM "user" WHERE email = $1', [email]);
console.log("user row:", userRows.rows);

const acctRows = await pool.query(
  'SELECT id, "providerId", "accountId", issuer, "userId", password FROM account WHERE "userId" IN (SELECT id FROM "user" WHERE email = $1)',
  [email],
);
console.log("account rows:", acctRows.rows);

const acct = acctRows.rows[0] as { password?: string; providerId?: string } | undefined;
if (acct) {
  console.log("providerId:", acct.providerId);
  console.log("password is plaintext?:", acct.password === password);
  console.log("password length:", acct.password?.length, "vs plaintext:", password.length);
  console.log("password prefix:", acct.password?.slice(0, 8));
}

// cleanup
await pool.query('DELETE FROM account WHERE "userId" IN (SELECT id FROM "user" WHERE email = $1)', [email]);
await pool.query('DELETE FROM "user" WHERE email = $1', [email]);
await pool.end();
console.log("sanity cleanup done.");
